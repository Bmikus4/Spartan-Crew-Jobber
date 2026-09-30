// ============================================================================
// A thread's booking is what OnSinch holds, not what the latest email composed.
// ----------------------------------------------------------------------------
// [1] status was derived from whether THIS email composed an order, so "Thanks, see
//     you then" on a booked thread read `drafted` (audit #8, scenario S3).
// [2] a thread whose order staff deleted, with no successor found, created a fresh
//     order the next time the client restated the job (scenario S4). Staff delete our
//     orders mostly to re-type them by hand (47 of 86, 2026-09-29), so a re-create is a
//     second booking of a job that is already booked. The design rule (§9.5): a job
//     that has ever had an order never falls back to create. It gets a Gmail tag.
//
// Offline.  npx tsx test/bookedThreadStaysBooked.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationState } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const BOOKING = msg({ message_id: "b1", date_iso: "2026-02-12T10:00:00Z", body: "Please book 4 crew on 9 March. RedBeast Energy" });
const base = (over: Partial<ConversationState>) => ({
  thread_id: "t-booked", subject: "Crew", participants: [], last_message_id: "b1", last_processed_epoch: 1,
  classification: "new-job", facts: { requests: [] }, priority: "medium", needs_human: false,
  status: "ordered", notes: [], order_action_log: [], company_id: 42, ...over,
}) as unknown as ConversationState;
const run = (prior: ConversationState, body: string) =>
  compile({ thread_id: "t-booked", messages: [BOOKING, msg({ message_id: "b2", date_iso: "2026-02-13T10:00:00Z", body })] }, prior, {
    reasoner: mockReasoner, onsinch: new OnsinchClient(mockTransport), now: () => 2, repliesEnabled: false, seededRateCard: async () => 197,
  });

async function main() {
  console.log("\n[1] an acknowledgement on a booked thread leaves it booked");
  {
    // 9001 is readable by id in the mock tenant, so the binding holds.
    const { state } = await run(base({ onsinch_order_id: 9001 }), "Thanks, see you then!");
    ok(state.classification === "confirmation-only", "read as an acknowledgement", state.classification);
    ok(Number(state.onsinch_order_id) === 9001, "still bound", String(state.onsinch_order_id));
    ok(state.status === "ordered", "and still reads as booked", state.status);
  }

  console.log("\n[2] a thread whose order was deleted does not book the job again");
  {
    const lost = base({
      onsinch_order_id: undefined,
      order_action_log: [{ ts: 1, kind: "create", order_id: 7777, ok: true }] as never,
    });
    const { state, actions } = await run(lost, "Any update? Still need 4 crew on 9 March");
    ok(!actions.createOrder, "no second order is created", JSON.stringify(Object.keys(actions)));
    ok(state.needs_human === true, "the thread is tagged for a person");
    ok(state.notes.some((n) => /had an order before/.test(n)), "and says why", state.notes.find((n) => /before/.test(n)) ?? "(none)");
  }

  console.log("\n[3] the same email on a thread that never had an order still books it");
  {
    // The control for [2]: without it, a rule that never created anything would pass.
    const { actions } = await run(base({ onsinch_order_id: undefined }), "Any update? Still need 4 crew on 9 March");
    ok(!!actions.createOrder, "an order is created", JSON.stringify(Object.keys(actions)));
  }

  console.log("\n[4] a replace interrupted after its delete still re-posts");
  {
    const resuming = base({
      onsinch_order_id: undefined,
      order_action_log: [{ ts: 1, kind: "create", order_id: 7777, ok: true }] as never,
      order_replace: { old_order_id: 7777, deleted: true } as never,
    });
    const { actions } = await run(resuming, "Any update? Still need 4 crew on 9 March");
    ok(!!actions.createOrder, "the snapshot's re-post is not blocked", JSON.stringify(Object.keys(actions)));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
