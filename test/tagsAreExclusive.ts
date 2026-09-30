// ============================================================================
// A thread wears one of the four order labels, whichever route puts it on.
// ----------------------------------------------------------------------------
// Production tags through the n8n workflow, which adds or removes the one label it is
// sent. So "Order Updated" went on beside "Order Built", and "Order Needs Updated" beside
// "Order Built" — a thread saying the work is done and outstanding at once. Only the
// service-account route took the other three off. Ben, 2026-09-30: "are old created tags
// removed when a new one is added".
//
// Offline.  npx tsx test/tagsAreExclusive.ts
// ============================================================================
import { exclusiveTagCalls, THE_FOUR } from "../app/lib/mail/gmailWrite";
import { flagManualIfNeeded, flagBuiltIfNeeded, flagUpdatedIfNeeded, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

console.log("\n[1] putting one of the four on clears the other three first");
for (const label of THE_FOUR) {
  const calls = exclusiveTagCalls({ label, thread_id: "t1", state: label.includes("Needs") ? "manual" : "built", reason: "why" });
  const last = calls[calls.length - 1];
  const cleared = calls.slice(0, -1);
  ok(
    calls.length === 4 && last.label === label && last.state !== "cleared" &&
      cleared.every((c) => c.state === "cleared" && c.label !== label && c.thread_id === "t1") &&
      new Set(cleared.map((c) => c.label)).size === 3,
    `${label}: three clears, then the label`,
    JSON.stringify(calls.map((c) => `${c.state}:${c.label}`))
  );
}

console.log("\n[2] a clear is sent as it is");
{
  const calls = exclusiveTagCalls({ label: "Order Needs Built", thread_id: "t1", state: "cleared" });
  ok(calls.length === 1 && calls[0].state === "cleared", "one call, nothing else touched", JSON.stringify(calls));
}

console.log("\n[3] a label outside the four is left alone");
{
  const calls = exclusiveTagCalls({ label: "Check Engine Write", thread_id: "t1", state: "built" });
  ok(calls.length === 1 && calls[0].label === "Check Engine Write", "the supervision label clears nothing", JSON.stringify(calls));
}

console.log("\n[4] booked -> fails -> resolved ends wearing Order Built again");
async function sequence() {
  const posted: string[] = [];
  const tag = async (a: { label: string; state?: string }) => { posted.push(`${a.state}:${a.label}`); };
  const deps = { store: new InMemoryStore(), flagForManual: tag, flagOrderBuilt: tag, flagOrderUpdated: tag } as unknown as PipelineDeps;
  const s = { thread_id: "t9", status: "ordered", classification: "update", onsinch_order_id: 9001, needs_human: false, notes: ["booked"], order_action_log: [] } as unknown as ConversationState;
  const pass = async () => { await flagManualIfNeeded(s, deps); await flagBuiltIfNeeded(s, deps); await flagUpdatedIfNeeded(s, deps); };

  await pass();
  ok(posted.join() === "built:Order Built", "booked: Order Built", posted.join());

  posted.length = 0;
  Object.assign(s, { needs_human: true, review_only: false, notes: ["the change could not be applied"] });
  await pass();
  ok(posted.join() === "manual:Order Needs Updated", "a failure: only the Needs label goes on", posted.join());

  posted.length = 0;
  await pass();
  ok(posted.length === 0, "still failing: nothing re-posted", posted.join());

  posted.length = 0;
  Object.assign(s, { needs_human: false, notes: ["applied"] });
  await pass();
  ok(posted.join() === "cleared:Order Needs Updated,built:Order Built", "resolved: Needs off, Order Built back", posted.join());
}

sequence().then(
  () => {
    console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
    process.exitCode = fails === 0 ? 0 : 1;
  },
  (e) => { console.error(e); process.exitCode = 1; }
);
