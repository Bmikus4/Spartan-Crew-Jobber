// Pull every labelled thread and its label to .tmp-data/labelled-corpus.json so the
// matching study runs offline and free. One read of Neon; every later pass reads the
// file. No model is called here.
//
// Run: npx tsx scripts/pull-labelled-corpus.ts [--refresh]
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { corpusByThreadId } from "./_corpus.mjs";
import { loadEnv } from "./_env.mjs";

loadEnv();
const OUT = ".tmp-data/labelled-corpus.json";
if (existsSync(OUT) && !process.argv.includes("--refresh")) {
  console.log(`${OUT} already holds ${JSON.parse(readFileSync(OUT, "utf8")).length} threads — pass --refresh`);
  process.exit(0);
}

const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
if (!url) throw new Error("no DATABASE_URL in the environment");
const sql = neon(url);

async function main() {
// The label join and the header columns stay in SQL; the mail comes from the on-disk
// corpus. Selecting t.payload here would now write "payload": null into every record —
// a file that looks complete and is empty. See scripts/export-sweep-corpus.mjs.
const labelRows = await sql`
  SELECT t.thread_id, t.subject, t.message_count, t.first_date, t.last_date,
         l.model, l.classification, l.is_cancellation, l.company_name, l.location_text,
         l.first_start, l.last_end, l.blocks, l.error
  FROM sweep_labels l
  JOIN sweep_threads t ON t.thread_id = l.thread_id
  ORDER BY t.last_date DESC NULLS LAST`;
const corpus = await corpusByThreadId();
const rows = (labelRows as Array<Record<string, unknown>>).map((r) => ({
  ...r,
  payload: (corpus.get(r.thread_id as string) as { payload?: unknown } | undefined)?.payload ?? null,
}));
const missing = rows.filter((r) => r.payload === null).length;
if (missing) console.warn(`WARNING: ${missing} of ${rows.length} labelled threads have no mail in the corpus file`);

mkdirSync(".tmp-data", { recursive: true });
writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(`${rows.length} labelled threads -> ${OUT}`);
}
main();
