// ============================================================================
// EVERY AMENDMENT RECORDS HOW LONG AFTER THE BOOKING IT ARRIVED.
// ----------------------------------------------------------------------------
// Ben's question, 2026-09-13: do amendments land within 30 days of the order being raised?
// It decides how long a thread has to stay reconcilable and therefore whether anything may
// ever be purged.
//
// It cannot be answered from this tenant. The longest interval on record is 14 days, and that
// is the age of the ENGINE rather than a fact about clients — a figure bounded by how long we
// have been running looks like an answer and is not one. So the fact is written down each time
// it happens and the question is answered in sixty days with data.
//
// The whole mechanism is `logAction`, and what it has to get right is narrow:
//
//   it stamps an interval when there is an origin to measure from;
//   it stamps NOTHING when there is not, rather than a zero.
//
// The second is the one that matters. An order matched out of OnSinch history was raised
// before this engine ever saw the thread, and 28 of 37 live bound orders are exactly that. A
// zero there would put the largest population in the sample at "same day" and answer "within
// 30 days?" with a confident yes it had not earned.
//
// Run: npx tsx test/amendmentArrivalRecorded.ts
// ============================================================================
import { logAction } from "../app/lib/engine/pipeline";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const DAY = 86_400_000;
const T0 = Date.parse("2026-06-01T09:00:00Z");
const at = (days: number) => T0 + days * DAY;

const stateWith = (log: ConversationState["order_action_log"]): ConversationState =>
  ({ thread_id: "T", notes: [], order_action_log: log }) as unknown as ConversationState;

const last = (s: ConversationState) => s.order_action_log[s.order_action_log.length - 1];

(async () => {
  console.log("\n[1] an amendment 45 days after the create records 45");
  {
    const s = stateWith([{ ts: T0, kind: "create", order_id: 1, ok: true }]);
    logAction(s, () => at(45), { ts: at(45), kind: "amend", order_id: 1, ok: true });
    ok(last(s).days_after_create === 45, "the interval is on the log entry", String(last(s).days_after_create));
    // Whole days, floored: a change at 45 days and 23 hours is still in the 45-day bucket
    // rather than rounded up into the next one, so no interval is ever reported longer than
    // it was.
    const s2 = stateWith([{ ts: T0, kind: "create", order_id: 1, ok: true }]);
    logAction(s2, () => at(45) + 23 * 3_600_000, { ts: at(45) + 23 * 3_600_000, kind: "amend", order_id: 1, ok: true });
    ok(last(s2).days_after_create === 45, "and it floors rather than rounds", String(last(s2).days_after_create));
  }

  console.log("\n[2] AN ORDER THAT PREDATES THE THREAD RECORDS NOTHING, NOT ZERO");
  {
    // The common case — 28 of 37 live bound orders were raised by staff, so the thread's log
    // holds no create at all. A zero here would put the largest population in the sample at
    // "same day".
    const s = stateWith([]);
    logAction(s, () => at(200), { ts: at(200), kind: "amend", order_id: 1, ok: true });
    ok(last(s).days_after_create === undefined, "no origin, no interval", JSON.stringify(last(s)));
    ok("days_after_create" in last(s) === false, "and the key is absent rather than undefined-valued");
  }

  console.log("\n[3] a FAILED create is not an origin");
  {
    // A create that threw did not raise an order, so measuring from it would time the
    // interval from an event that produced nothing.
    const s = stateWith([{ ts: T0, kind: "create", order_id: 1, ok: false, error: "422" }]);
    logAction(s, () => at(10), { ts: at(10), kind: "amend", order_id: 1, ok: true });
    ok(last(s).days_after_create === undefined, "a failed create is not measured from", JSON.stringify(last(s)));
  }

  console.log("\n[4] a REBUILD keeps measuring from the original booking");
  {
    // delete-and-repost logs `replace`, never a second `create`, so the clock keeps running
    // from the order the client thinks they placed — not from the last time we rewrote it.
    // If this inverted, a thread amended monthly would report every interval as ~30 days and
    // the long tail would vanish.
    const s = stateWith([{ ts: T0, kind: "create", order_id: 1, ok: true }]);
    logAction(s, () => at(30), { ts: at(30), kind: "replace", order_id: 2, ok: true });
    ok(last(s).days_after_create === 30, "the first change is 30 days out", String(last(s).days_after_create));
    logAction(s, () => at(95), { ts: at(95), kind: "amend", order_id: 2, ok: true });
    ok(last(s).days_after_create === 95, "and the second is 95, not 65", String(last(s).days_after_create));
  }

  console.log("\n[5] a refusal is recorded too, and does not corrupt the log");
  {
    const s = stateWith([{ ts: T0, kind: "create", order_id: 1, ok: true }]);
    logAction(s, () => at(7), { ts: at(7), kind: "amend-refused", order_id: 1, ok: false, error: "staffed" });
    ok(s.order_action_log.length === 2, "appended, never replaced", String(s.order_action_log.length));
    ok(s.order_action_log[0].kind === "create", "and the create is untouched");
    ok(last(s).days_after_create === 7, "a refusal carries its interval too — when a change could not land is also a fact");
  }

  console.log("\n[6] a change logged BEFORE the create cannot produce a negative");
  {
    // Clock skew, or a log rebuilt out of order. A negative interval would read as a change
    // arriving before the booking and would drag a median below zero.
    const s = stateWith([{ ts: at(10), kind: "create", order_id: 1, ok: true }]);
    logAction(s, () => T0, { ts: T0, kind: "amend", order_id: 1, ok: true });
    ok(last(s).days_after_create === undefined, "no interval rather than a negative one", String(last(s).days_after_create));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
