// Returns emptied space to Neon and reports the result. A plain UPDATE leaves dead tuples
// claimed; VACUUM FULL rewrites the table, which is the only thing that shrinks the bill.
//
//   node scripts/db-reclaim.mjs           # report only
//   node scripts/db-reclaim.mjs --apply
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");
const TABLES = ["inbound_raw", "sweep_threads", "thread_messages"];

const report = async (when) => {
  const [{ d }] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) d`;
  console.log(`\n${when}: database is ${d}`);
  for (const t of TABLES) {
    const [{ s }] = await sql`SELECT pg_size_pretty(pg_total_relation_size(${t})) s`;
    console.log(`  ${t.padEnd(18)} ${s}`);
  }
};

await report("before");
if (!APPLY) { console.log("\nDRY RUN — pass --apply\n"); process.exit(0); }

// inbound_raw.payload only. Everything it held is still IN the database: the messages are
// rows in thread_messages and the n8n wrapper is the envelope column. Nothing leaves.
const [{ n }] = await sql`SELECT count(*)::int n FROM inbound_raw WHERE payload IS NOT NULL`;
await sql`UPDATE inbound_raw SET payload = NULL WHERE payload IS NOT NULL`;
console.log(`\ncleared payload on ${n} inbound_raw row(s)`);

for (const t of TABLES) {
  await sql(`VACUUM FULL ${t}`);
  await sql(`VACUUM ANALYZE ${t}`);
  console.log(`  vacuumed ${t}`);
}
await report("after");
