// ============================================================================
// A thread the engine has IGNORED must never appear as confirmable.
// ----------------------------------------------------------------------------
// clear-machine-threads.ts repaired the OnSinch-notifier threads by writing the
// state JSONB directly:
//     UPDATE conversation_state SET state = $1 WHERE thread_id = $2
// It did not touch the indexed `status` column, and it did not re-project the
// `tickets` row that the Jobs Board actually reads. So live thread
// 19fb8b3d094fa9a1 - machine mail from no-reply@sinch.cz, correctly ignored in
// the state JSONB - still had status='proposed' in its column and still showed on
// the board as new-job / proposed, i.e. with a Confirm button, which is the exact
// thing that fix existed to remove.
//
// Two invariants here:
//  1. the confirm queue is derived from the state JSONB, the single source of
//     truth, and requires an actual pending_order - "proposed" with nothing
//     staged is unconfirmable and must not be offered
//  2. the ticket the board reads agrees with the state
//
// Runs against the real database with clearly-tagged rows, and removes them.
//
// Run: npx tsx test/confirmQueue.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { NeonStateStore } from "../app/lib/stateDb";
import { upsertTicketFromState } from "../app/lib/ticketsDb";
import type { ConversationState } from "../app/lib/engine/types";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `cqtest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const ignoredMachineThread = (id: string): ConversationState => ({
  thread_id: id,
  subject: "Client created new order",
  participants: ["no-reply@sinch.cz"],
  last_message_id: `${id}-m1`,
  last_processed_epoch: Date.now(),
  classification: "not-a-job",
  facts: { requests: [] },
  company_id: 401,
  onsinch_order_id: 99913642, // deliberately not a real order id - the tickets unique index is live
  desired_order: null,
  priority: "low",
  needs_human: false,
  status: "ignored",
  notes: ["machine mail from no-reply@sinch.cz — not a client enquiry"],
  order_action_log: [],
});

async function main() {
  const store = new NeonStateStore();
  const drifted = `${TAG}-drifted`;

  // Reproduce the live drift exactly: JSONB says ignored, column says proposed.
  const s = ignoredMachineThread(drifted);
  await store.put(s);
  await sql`UPDATE conversation_state SET status='proposed' WHERE thread_id=${drifted}`;

  const col = await sql`SELECT status, state->>'status' AS json_status FROM conversation_state WHERE thread_id=${drifted}`;
  console.log(`\n[0] reproduced the drift`);
  ok((col[0] as any).status === "proposed", "column says proposed", (col[0] as any).status);
  ok((col[0] as any).json_status === "ignored", "state JSONB says ignored", (col[0] as any).json_status);

  console.log(`\n[1] the confirm queue must not offer it`);
  const queue = await store.listProposed();
  const offered = queue.some((q) => q.thread_id === drifted);
  console.log(`      queue returned ${queue.length} row(s)`);
  ok(!offered, "an IGNORED thread is not in the confirm queue");

  console.log(`\n[2] nor a 'proposed' thread with nothing actually staged`);
  const empty = `${TAG}-nopending`;
  await store.put({ ...ignoredMachineThread(empty), status: "proposed", classification: "new-job" });
  const q2 = await store.listProposed();
  ok(!q2.some((r) => r.thread_id === empty),
    "status=proposed with no pending_order is not confirmable, so not offered");

  console.log(`\n[3] a genuinely staged thread IS offered`);
  const real = `${TAG}-staged`;
  await store.put({
    ...ignoredMachineThread(real),
    classification: "update",
    status: "proposed",
    pending_order: {
      kind: "patch", order_id: 99913632,
      desired: {
        name: "Mini Title Limited @ The Factory Project", company_id: 813, user_id: 1,
        request_approval: true, pricelist_category_id: 342,
        job_name: "2 at The Factory Project on 2026-08-04",
        slot_teams: [{ name: "Crew", profession_id: 1, beginning: "2026-08-04T08:00:00+01:00", end: "2026-08-04T11:00:00+01:00", size: 2, place_id: 304 }],
      },
    },
  });
  const q3 = await store.listProposed();
  ok(q3.some((r) => r.thread_id === real), "a real staged patch is still offered");

  console.log(`\n[4] the ticket the board reads agrees with the state`);
  await upsertTicketFromState(s); // the ignored machine thread
  const t = await sql`SELECT status, classification FROM tickets WHERE thread_id=${drifted}`;
  console.log(`      ticket: ${JSON.stringify(t[0] ?? null)}`);
  ok((t[0] as any)?.status === "ignored", "ticket status matches the state", (t[0] as any)?.status);
  ok((t[0] as any)?.classification === "not-a-job", "ticket classification matches", (t[0] as any)?.classification);

  // cleanup
  const a = await sql`DELETE FROM conversation_state WHERE thread_id LIKE ${TAG + "%"} RETURNING thread_id`;
  const b = await sql`DELETE FROM tickets WHERE thread_id LIKE ${TAG + "%"} RETURNING thread_id`;
  const c = await sql`DELETE FROM ticket_events WHERE thread_id LIKE ${TAG + "%"} RETURNING id`;
  console.log(`\ncleanup: state=${a.length} tickets=${b.length} events=${c.length}`);

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
