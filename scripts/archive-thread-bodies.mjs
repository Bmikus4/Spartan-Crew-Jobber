// Moves message bodies older than the retention window out of Postgres and into a JSONL
// file on disk, leaving the headers behind.
//
// WHY 90 DAYS. Ben's choice. Nothing in the live data was older than 30 days when this was
// written, so 90 is three times any replay anyone has needed; it costs roughly 12 MB more
// than a 30-day window and buys a wider window for a slow-moving dispute.
//
// WHY A LOCAL SCRIPT AND NOT A CRON. Vercel functions have no persistent disk. At 90 days
// the table stabilises around 20 MB whether this runs weekly or monthly, so an unattended
// job is not worth a Blob store yet. If that changes, the destination is the only thing
// that has to change.
//
// The file is written BEFORE the column is cleared. The reverse order would lose a body to
// a crash between the two statements.
//
//   node scripts/archive-thread-bodies.mjs                    # dry run
//   node scripts/archive-thread-bodies.mjs --apply
//   node scripts/archive-thread-bodies.mjs --apply --days 30
//   node scripts/archive-thread-bodies.mjs --apply --out path.jsonl
import { neon } from "@neondatabase/serverless";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const APPLY = process.argv.includes("--apply");
const DAYS = Number(arg("days", 90));
const OUT = arg("out", `data/archive/${new Date().toISOString().slice(0, 7)}.jsonl`);

const rows = await sql`
  SELECT message_id, thread_id, from_address, to_addresses, date_iso, subject, body,
         is_from_spartan, first_seen_at
  FROM thread_messages
  WHERE body IS NOT NULL AND first_seen_at < now() - (${String(DAYS)} || ' days')::interval
  ORDER BY first_seen_at`;

const bytes = rows.reduce((a, r) => a + (r.body?.length ?? 0), 0);
console.log(`${rows.length} body/bodies older than ${DAYS} days${APPLY ? "" : "  (DRY RUN — pass --apply)"}`);
console.log(`that is ${(bytes / 1048576).toFixed(1)} MB of body text`);
if (!APPLY || !rows.length) process.exit(0);

mkdirSync(dirname(OUT), { recursive: true });
let freed = 0;
for (const r of rows) {
  appendFileSync(OUT, JSON.stringify(r) + "\n", "utf8");
  await sql`UPDATE thread_messages SET body = NULL, archived_at = now() WHERE message_id = ${r.message_id}`;
  freed += r.body?.length ?? 0;
}
console.log(`archived ${rows.length} to ${OUT}, freed ${(freed / 1048576).toFixed(1)} MB`);
console.log("run VACUUM to return the space: npm run db:reclaim -- --apply");
