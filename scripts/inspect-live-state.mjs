// Read-only: what the engine actually decided on real mail, and the exact
// payload n8n handed it. This is the honest read on classification quality -
// nothing here writes.
//
//   node scripts/inspect-live-state.mjs
//   node scripts/inspect-live-state.mjs --payload <inbound_raw id>
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";
loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const argv = process.argv.slice(2);
const PAYLOAD_ID = argv.indexOf("--payload") !== -1 ? argv[argv.indexOf("--payload") + 1] : null;

if (PAYLOAD_ID) {
  const [row] = await sql`SELECT id, thread_id, payload FROM inbound_raw WHERE id = ${Number(PAYLOAD_ID)}`;
  if (!row) { console.error("no such inbound_raw id"); process.exit(1); }
  console.log(JSON.stringify(row.payload, null, 2));
  process.exit(0);
}

console.log("=== conversation_state ===");
for (const r of await sql`SELECT thread_id, status, needs_human, onsinch_order_id, state, updated_at FROM conversation_state ORDER BY updated_at DESC`) {
  const s = r.state;
  console.log(`\n${r.thread_id}  status=${r.status} needs_human=${r.needs_human} order=${r.onsinch_order_id}  ${r.updated_at}`);
  console.log(`  subject      ${s.subject || "(blank)"}`);
  console.log(`  participants ${(s.participants || []).join(", ") || "(blank)"}`);
  console.log(`  class        ${s.classification}`);
  console.log(`  facts        ${JSON.stringify(s.facts ?? {}).slice(0, 400)}`);
  console.log(`  desired      ${JSON.stringify(s.desired_order ?? null).slice(0, 300)}`);
  console.log(`  notes        ${(s.notes || []).join(" | ")}`);
  console.log(`  actions      ${JSON.stringify(s.order_action_log ?? [])}`);
}

console.log("\n\n=== inbound_raw: what n8n sent, and what the engine could see ===");
for (const r of await sql`SELECT id, thread_id, payload, received_at FROM inbound_raw ORDER BY id DESC LIMIT 8`) {
  const p = r.payload || {};
  const msgs = Array.isArray(p.messages) ? p.messages : [];
  const verdict = p.n8n?.verdict?.content || "";
  const isJob = /is_job:\s*(\w+)/.exec(verdict)?.[1];
  const typeJob = /type_job:\s*(\w+)/.exec(verdict)?.[1];
  console.log(`\n#${r.id} thread=${r.thread_id} ${r.received_at}`);
  console.log(`  n8n verdict     is_job=${isJob} type_job=${typeJob}`);
  console.log(`  messages[]      ${msgs.length}`);
  for (const m of msgs.slice(0, 3)) {
    console.log(`    id=${m.message_id ?? "-"} from=${JSON.stringify(m.from ?? null)} subject=${JSON.stringify(m.subject ?? null)}`);
    console.log(`      to=${JSON.stringify(m.to ?? null)} date=${m.date ?? m.received_at ?? "-"}  keys=${Object.keys(m).join(",")}`);
    console.log(`      body(${String(m.body ?? "").length}) ${JSON.stringify(String(m.body ?? "").slice(0, 200))}`);
  }
}

console.log("\n\n=== ticket_events ===");
for (const r of await sql`SELECT thread_id, kind, meta FROM ticket_events ORDER BY id DESC LIMIT 10`)
  console.log(`  ${r.thread_id}  ${r.kind}  ${JSON.stringify(r.meta)}`);
console.log();
