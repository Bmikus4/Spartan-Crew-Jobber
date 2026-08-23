// Read-only: everything stored for one thread - what each delivery carried, the mail
// itself, engine state, ticket row. Run: node scripts/peek-thread.mjs <thread_id>
//
// The mail is printed ONCE, not once per delivery. n8n POSTs the full hydrated thread every
// time, so a thread of 28 messages delivered 21 times used to print the same bodies over
// and over; since the restructure it would rebuild the whole thread on every row and print
// 379 message blocks for 28 messages. Each delivery now reports only which message_ids it
// brought, which is the thing that actually differs between them.
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";
import { messagesFor } from "./_thread.mjs";
loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const tid = process.argv[2];
if (!tid) { console.error("usage: node scripts/peek-thread.mjs <thread_id>"); process.exit(2); }

const rows = await sql`SELECT id, received_at, envelope, message_ids FROM inbound_raw WHERE thread_id=${tid} ORDER BY id`;
console.log(`=== ${rows.length} delivery/deliveries ===`);
for (const r of rows) {
  const n8n = r.envelope?.n8n || {};
  console.log(`\n--- inbound_raw ${r.id} ${new Date(r.received_at).toISOString()}`);
  console.log("carried:", (r.message_ids || []).length, "message(s)", JSON.stringify(r.message_ids || []).slice(0, 200));
  console.log("verdict:", typeof n8n.verdict === "string" ? n8n.verdict : JSON.stringify(n8n.verdict));
  console.log("client_information:", JSON.stringify(n8n.client_information));
}

const msgs = await messagesFor(sql, tid);
console.log(`\n\n=== ${msgs.length} message(s), each stored once ===`);
for (const m of msgs) {
  console.log(`\nMSG ${m.message_id}  from=${m.from} to=${m.to?.join(", ") || "?"} date=${m.date_iso}`);
  console.log(`    subject=${m.subject}`);
  console.log(String(m.body || "").trim().slice(0, 2500));
}

const [st] = await sql`SELECT * FROM conversation_state WHERE thread_id=${tid}`;
console.log("\n--- conversation_state\n", JSON.stringify(st?.state ?? st, null, 2)?.slice(0, 6000));
const [tk] = await sql`SELECT * FROM tickets WHERE thread_id=${tid}`;
console.log("\n--- ticket\n", JSON.stringify(tk, null, 2)?.slice(0, 3000));
