// ============================================================================
// Retire the state that machine mail produced before the engine could tell.
// ----------------------------------------------------------------------------
// Two live threads are notifications from OnSinch's own notifier that the engine
// read as enquiries and turned into STAGED order patches. They sit on the Jobs
// Board with a Confirm button; clicking one would rewrite a correct OnSinch
// order with the notification's subject and guessed hours. The code fix stops
// new ones, this clears the ones already stored.
//
// Deterministic: no model, no OnSinch call. A thread qualifies only when every
// message in it is machine mail. Order linkage is kept - it is real, and the
// board should still show the thread against its order.
//
//   npx tsx scripts/clear-machine-threads.ts          # report only
//   npx tsx scripts/clear-machine-threads.ts --apply
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";
import { coerceThread } from "../app/lib/engine/intake";
import { isMachineMessage, selectLatest } from "../app/lib/engine/normalize";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");

async function main() {
const raw = await sql`SELECT thread_id, payload FROM inbound_raw ORDER BY id`;
const byThread = new Map<string, any[]>();
for (const r of raw as any[]) {
  const t = coerceThread(r.payload);
  if (!t) continue;
  byThread.set(t.thread_id, [...(byThread.get(t.thread_id) ?? []), ...t.messages]);
}

const states = (await sql`SELECT thread_id, state FROM conversation_state`) as any[];
let hits = 0;

for (const row of states) {
  const msgs = byThread.get(row.thread_id);
  if (!msgs?.length) continue;
  const client = msgs.filter((m) => !m.is_from_spartan);
  if (!client.length || !client.every(isMachineMessage)) continue;
  hits++;
  const s = row.state;
  const latest = selectLatest(msgs)!.latest;
  console.log(
    `\n${row.thread_id}  ${latest.from}  "${latest.subject}"` +
      `\n   was: status=${s.status} classification=${s.classification} ` +
      `pending=${s.pending_order ? s.pending_order.kind + " #" + (s.pending_order.order_id ?? "new") : "-"} ` +
      `order=${s.onsinch_order_id ?? "-"}`,
  );
  if (!APPLY) continue;
  const next = {
    ...s,
    classification: "not-a-job",
    status: "ignored",
    needs_human: false,
    desired_order: null,
    pending_order: undefined,
    notes: [`machine mail from ${latest.from} — not a client enquiry`],
  };
  await sql`UPDATE conversation_state SET state=${JSON.stringify(next)}::jsonb, updated_at=now() WHERE thread_id=${row.thread_id}`;
  console.log(`   now: status=ignored, staged order withdrawn`);
}

console.log(`\n${hits} machine-only thread(s)${APPLY ? " updated" : " — run with --apply to update"}`);
}

main();
