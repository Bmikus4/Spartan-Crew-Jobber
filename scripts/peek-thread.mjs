// Read-only: everything stored for one thread - inbound payloads, engine state,
// ticket row. Run: node scripts/peek-thread.mjs <thread_id>
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";
loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const tid = process.argv[2];
if (!tid) { console.error("usage: node scripts/peek-thread.mjs <thread_id>"); process.exit(2); }

for (const r of await sql`SELECT * FROM inbound_raw WHERE thread_id=${tid} ORDER BY id`) {
  const p = r.payload || {};
  const n8n = p.n8n || {};
  console.log(`\n--- inbound_raw ${r.id} ${new Date(r.received_at).toISOString()}`);
  console.log("verdict:", typeof n8n.verdict === "string" ? n8n.verdict : JSON.stringify(n8n.verdict));
  console.log("client_information:", JSON.stringify(n8n.client_information));
  for (const m of p.messages || []) {
    console.log(`MSG from=${m.from} to=${m.to || "?"} subject=${m.subject}`);
    console.log(String(m.body || m.text || "").trim().slice(0, 2500));
  }
}
const [st] = await sql`SELECT * FROM conversation_state WHERE thread_id=${tid}`;
console.log("\n--- conversation_state\n", JSON.stringify(st?.state ?? st, null, 2)?.slice(0, 6000));
const [tk] = await sql`SELECT * FROM tickets WHERE thread_id=${tid}`;
console.log("\n--- ticket\n", JSON.stringify(tk, null, 2)?.slice(0, 3000));
