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
import { payloadFor } from "./_thread.mjs";
import { coerceThread } from "../app/lib/engine/intake";
import { isMachineMessage, selectLatest } from "../app/lib/engine/normalize";
import { NeonStateStore } from "../app/lib/stateDb";
import { upsertTicketFromState } from "../app/lib/ticketsDb";
import type { ConversationState } from "../app/lib/engine/types";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");

async function main() {
  const store = new NeonStateStore();
const raw = await sql`SELECT thread_id, payload, envelope FROM inbound_raw ORDER BY id`;
const byThread = new Map<string, any[]>();
for (const r of raw as any[]) {
  // payload is null after the restructure; see scripts/_thread.mjs.
  const t = coerceThread(await payloadFor(sql, r.thread_id, r.payload, r.envelope));
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
  // Write through the real writers, NOT a direct UPDATE of `state`.
  //
  // The first version of this script did `UPDATE conversation_state SET state=...`
  // and nothing else. That left two things stale behind it: the denormalised
  // `status` column (so the confirm queue still offered these threads) and the
  // `tickets` row the Jobs Board actually reads (so the board still showed them
  // as new-job / proposed, with a Confirm button). The repair was invisible
  // everywhere it mattered.
  await store.put(next as ConversationState);
  await upsertTicketFromState(next as ConversationState);
  console.log(`   now: status=ignored, staged order withdrawn, ticket re-projected`);
}

console.log(`\n${hits} machine-only thread(s)${APPLY ? " updated" : " — run with --apply to update"}`);
}

main();
