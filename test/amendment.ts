// ============================================================================
// May an amendment shrink an order? Yes — except to zero.
//
// Growth-only was the alternative and it is the more expensive rule: a client who
// says "make it 4 instead of 6" and gets 6 is billed for two people they told us not
// to send, every time. What guards the shrink is the one shape more likely to be a
// misread than a request — emptying the order, which is a cancellation, and the
// engine has no cancellation class to recognise one with.
//
// Run: npx tsx test/amendment.ts
// ============================================================================
import { assessAmendment } from "../app/lib/engine/amendment";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** An order of `sizes`, one slot team each. Only the headcount matters here. */
const order = (...sizes: number[]): DesiredOrder =>
  ({ slot_teams: sizes.map((size, i) => ({ name: `t${i}`, profession_id: 1, beginning: "", end: "", size, place_id: 1 })) }) as DesiredOrder;

console.log("\n[1] a shrink is applied");
{
  const v = assessAmendment(order(6), order(4));
  ok(v.action === "apply", "6 -> 4 is written", v.action);
  ok(v.before === 6 && v.after === 4, "and counted", `${v.before}->${v.after}`);
  ok(!!v.note && /reduced from 6 to 4/.test(v.note), "with the change on the ticket", v.note ?? "(none)");
}

console.log("\n[2] growth is never remarked on");
{
  const v = assessAmendment(order(4), order(6));
  ok(v.action === "apply", "4 -> 6 is written");
  ok(v.note === null, "and says nothing — a bigger order the client asked for has no failure mode", String(v.note));
  ok(assessAmendment(order(4), order(4)).note === null, "nor does an unchanged headcount");
}

console.log("\n[3] emptying an order HOLDS — a cancellation wearing an update's clothes");
{
  const v = assessAmendment(order(6), order());
  ok(v.action === "hold", "6 -> 0 is not written", v.action);
  ok(!!v.note && /cancellation/.test(v.note), "and the ticket says why", v.note ?? "(none)");
  ok(assessAmendment(order(6), null).action === "hold", "a null order is the same thing");
}

console.log("\n[4] a deep cut is applied, but never quietly");
{
  const v = assessAmendment(order(20), order(4));
  ok(v.action === "apply", "20 -> 4 is still the client's latest word", v.action);
  ok(!!v.note && /more than half/.test(v.note), "and it is said loudly", v.note ?? "(none)");
  const shallow = assessAmendment(order(20), order(19));
  ok(!!shallow.note && !/more than half/.test(shallow.note), "a small cut is not dressed up as one");
  // Exactly half is deep: half the crew going is the case worth reading twice.
  ok(/more than half/.test(assessAmendment(order(10), order(5)).note ?? ""), "exactly half counts as deep");
}

console.log("\n[5] a first order is not an amendment");
{
  const v = assessAmendment(null, order(6));
  ok(v.action === "apply" && v.note === null, "nothing existed to shrink", `${v.action}/${v.note}`);
  ok(assessAmendment(order(), order(6)).note === null, "an empty prior is the same");
  // The dangerous shape: no prior AND no crew. It must not read as a cancellation of
  // something that never existed.
  ok(assessAmendment(null, order()).action === "apply", "and an empty first order does not 'cancel' anything");
}

console.log("\n[6] chiefs are counted, because they are people on the order");
{
  // 6 composes as 5 crew + 1 chief. Comparing crew alone would read that as a cut.
  const v = assessAmendment(order(6), order(5, 1));
  ok(v.after === 6 && v.note === null, "5 + 1 chief is still six people", `${v.after}/${v.note}`);
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
