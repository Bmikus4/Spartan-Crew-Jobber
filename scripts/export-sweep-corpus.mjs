// Streams sweep_threads to data/corpus/sweep-threads.jsonl, verifies the file against the
// table, and only then offers to empty the payload column.
//
// The corpus is a research dataset — see the header of app/lib/sweepDb.ts. It is 72 MB of a
// 106 MB production database and no deployed route reads its payload: /api/sweep-ingest
// writes it and counts header columns, and that is all. On disk it costs nothing, and
// rnd-disproofs gets to scan a file instead of running ILIKE over 55 MB of JSONB.
//
// The HEADER columns stay in Postgres. sweep_labels, pull-labelled-corpus, study-corpus and
// test/sweepIsolation all join on them and must keep working untouched.
//
//   node scripts/export-sweep-corpus.mjs             # export + verify, changes no table
//   node scripts/export-sweep-corpus.mjs --reclaim   # ...then empty payload and VACUUM
import { neon } from "@neondatabase/serverless";
import { createWriteStream, mkdirSync } from "node:fs";
import { loadEnv, requireEnv } from "./_env.mjs";
import { corpusPath, readCorpus } from "./_corpus.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const RECLAIM = process.argv.includes("--reclaim");
const OUT = corpusPath();

const [{ n, bytes }] = await sql`
  SELECT count(*)::int n, pg_size_pretty(pg_total_relation_size('sweep_threads')) bytes
  FROM sweep_threads`;
console.log(`exporting ${n} thread(s); table is ${bytes}`);

mkdirSync(new URL("../data/corpus/", import.meta.url), { recursive: true });
const out = createWriteStream(OUT, { encoding: "utf8" });
// Paged, and small pages: a page of 200 swept threads is a few MB and the Neon HTTP driver
// refuses any single response over 64 MB.
const PAGE = 100;
let written = 0;
for (let offset = 0; ; offset += PAGE) {
  const rows = await sql`
    SELECT thread_id, mailbox, message_count, first_date, last_date, subject, participants, payload
    FROM sweep_threads ORDER BY thread_id LIMIT ${PAGE} OFFSET ${offset}`;
  if (!rows.length) break;
  for (const r of rows) {
    if (!out.write(JSON.stringify(r) + "\n")) await new Promise((res) => out.once("drain", res));
    written++;
  }
  process.stdout.write(`\r  ${written}/${n}`);
}
await new Promise((res) => out.end(res));
console.log(`\nwrote ${written} line(s) to ${OUT}`);

// Verify the file against the table before anything is cleared.
// Read back through the SAME reader the corpus scripts use, so the verification proves the
// file is readable the way they will read it, not merely that it was written.
let lines = 0, msgMismatch = 0, noPayload = 0;
const ids = new Set();
for await (const r of readCorpus()) {
  lines++;
  ids.add(r.thread_id);
  if (!r.payload) noPayload++;
  const held = Array.isArray(r.payload?.messages) ? r.payload.messages.length : 0;
  if (held !== r.message_count) msgMismatch++;
}
console.log(`verify: ${lines} line(s), ${ids.size} distinct thread_id(s), ${noPayload} with no payload, ${msgMismatch} message_count mismatch(es)`);

if (lines !== n || ids.size !== n) {
  console.error("file does not match the table — refusing to reclaim");
  process.exit(1);
}
// message_count mismatches are expected on some rows: the first sweep stored headers n8n
// left empty. Reported, not fatal — the payload on disk is still whatever the table held.
if (!RECLAIM) { console.log("\nexport verified. Re-run with --reclaim to empty the column."); process.exit(0); }

await sql`ALTER TABLE sweep_threads ALTER COLUMN payload DROP NOT NULL`;
await sql`UPDATE sweep_threads SET payload = NULL`;
await sql`VACUUM FULL sweep_threads`;
await sql`VACUUM ANALYZE sweep_threads`;
const [{ after }] = await sql`SELECT pg_size_pretty(pg_total_relation_size('sweep_threads')) after`;
console.log(`payload cleared; table is now ${after}`);
