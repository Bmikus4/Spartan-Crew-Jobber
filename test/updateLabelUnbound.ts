// ============================================================================
// A change to an existing booking the engine did not bind is "Needs Updated", not "Built".
// ----------------------------------------------------------------------------
// 2026-10-04, live: four of seven "Order needs created" threads on the TV were changes to
// bookings that exist (a moved shift on R11029, a date move, a PO, a new site contact).
// None was bound to its order, so needsLabelFor said Needs Built, which tells ops to make
// a booking that is already there. An update thread's booking is gone only when the sweep
// saw the thread's own order deleted (attention "lost"); then Needs Built stays true.
//
// Offline.  npx tsx test/updateLabelUnbound.ts
// ============================================================================
import { needsLabelFor, flagManualIfNeeded, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const st = (o: Partial<ConversationState>): ConversationState =>
  ({ thread_id: "t1", status: "needs-info", classification: "update", notes: ["nothing bookable: no crew size"], ...o }) as ConversationState;

console.log("\n[1] which label");
ok(needsLabelFor(st({ classification: "update" })) === "Order Needs Updated", "update, no bound order: Needs Updated");
ok(needsLabelFor(st({ classification: "new-job" })) === "Order Needs Built", "new job, no order: Needs Built");
ok(needsLabelFor(st({ classification: "confirmation-only" })) === "Order Needs Built", "confirmation, no order: Needs Built (unchanged)");
ok(needsLabelFor(st({ classification: "new-job", onsinch_order_id: 16021 })) === "Order Needs Updated", "any thread holding an order: Needs Updated (unchanged)");
ok(
  needsLabelFor(st({ classification: "update", attention: { kind: "lost", order_id: 16021, at: 1, was_needs_human: false } })) === "Order Needs Built",
  "update whose own order was deleted: Needs Built"
);
ok(
  needsLabelFor(st({ classification: "update", attention: { kind: "unapplied", order_id: 16021, at: 1, was_needs_human: false } })) === "Order Needs Updated",
  "update with another attention kind: Needs Updated"
);

console.log("\n[2] the label posted to Gmail follows it");
(async () => {
  const posted: string[] = [];
  const deps = { store: new InMemoryStore(), flagForManual: async (a: { label: string; state: string }) => { posted.push(`${a.state}:${a.label}`); } } as unknown as PipelineDeps;
  const s = st({ classification: "update" });
  await flagManualIfNeeded(s, deps);
  ok(posted.join() === "manual:Order Needs Updated", "an unbound update needing a person posts Needs Updated", posted.join());
})().then(
  () => {
    console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
    process.exitCode = fails === 0 ? 0 : 1;
  },
  (e) => { console.error(e); process.exitCode = 1; }
);
