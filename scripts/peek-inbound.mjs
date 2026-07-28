// Read-only: how much has actually arrived from n8n, and the shape of the last
// few payloads. Run: node scripts/peek-inbound.mjs
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";
loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`;
console.log("tables:", tables.map((t) => t.table_name).join(", ") || "(none)");

for (const t of ["inbound_raw", "tickets", "conversation_state"]) {
  if (!tables.some((x) => x.table_name === t)) { console.log(`\n${t}: does not exist`); continue; }
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM ${t}`);
  console.log(`\n${t}: ${n} rows`);
}
if (tables.some((x) => x.table_name === "inbound_raw")) {
  const rows = await sql`SELECT * FROM inbound_raw ORDER BY received_at DESC LIMIT 3`;
  for (const r of rows) console.log("\n", JSON.stringify(r).slice(0, 800));
}
