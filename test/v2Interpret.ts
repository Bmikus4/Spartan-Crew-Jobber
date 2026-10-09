// ============================================================================
// Grounding a model's extraction: values the email does not contain, or that the quote does
// not parse to, never reach a request. Fixtures are hand-built extractions over paraphrased
// emails, so no model is called.
//
// Offline.  npx tsx test/v2Interpret.ts
// ============================================================================
import { ground } from "../app/lib/v2/interpret/interpret";
import type { Extraction, RawRequest } from "../app/lib/v2/interpret/extract";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};
const g = <T>(value: T, quote: string) => ({ value, quote });
const req = (r: Partial<RawRequest>): RawRequest => ({ action: "new_shift", date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, venue: null, crew_chief: null, trade: null, target: null, ...r });
const ex = (requests: RawRequest[], extra: Partial<Extraction> = {}): Extraction => ({ intent: "booking", po: null, requests, note: "", ...extra });

const sent = "2026-09-16T10:00:00Z";
const newest = "Hi, would you be able to help with this?\n17th September\n9.30am   3 x Crew ( 3hr call) @ the warehouse - truck tip.\nPO 48963";

console.log("a well-grounded booking");
{
  const i = ground(ex([req({ date: g("2026-09-17", "17th September"), start: g("09:30", "9.30am"), duration_minutes: g(180, "3hr call"), crew: g(3, "3 x Crew") })], { po: g("48963", "PO 48963") }), newest, sent);
  const r = i.requests[0];
  ok(r.problems.length === 0, "no problems", JSON.stringify(r.problems));
  ok(r.date === "2026-09-17" && r.start === "09:30" && r.end === "12:30" && r.crew === 3, "day, start, end from the call length, crew", JSON.stringify(r));
  ok(i.po === "48963", "the PO is kept");
}

console.log("values the email does not support");
{
  const i = ground(ex([req({ date: g("2026-09-17", "17th September"), start: g("09:30", "9.30am"), duration_minutes: g(180, "3hr call"), crew: g(4, "3 x Crew") })]), newest, sent);
  ok(i.requests[0].crew === undefined && i.requests[0].problems.some((p) => p.includes("crew")), "a crew count the quote does not say is dropped", JSON.stringify(i.requests[0].problems));
}
{
  const i = ground(ex([req({ date: g("2026-09-17", "17th September"), start: g("10:00", "10am"), duration_minutes: g(180, "3hr call"), crew: g(3, "3 x Crew") })]), newest, sent);
  ok(i.requests[0].problems.some((p) => p.includes("not in the email")), "a quote that is not in the email is dropped");
}
{
  const i = ground(ex([req({ date: g("2026-09-18", "17th September"), start: g("09:30", "9.30am"), duration_minutes: g(180, "3hr call"), crew: g(3, "3 x Crew") })]), newest, sent);
  ok(i.requests[0].date === undefined, "a day one off from its quote is dropped (the Legal Geek shape)");
}
{
  const vague = "Can we bump it up a couple for Friday?";
  const i = ground(ex([req({ action: "change_crew", date: g("2026-09-18", "Friday"), crew: g(2, "a couple") })], { intent: "change" }), vague, sent);
  ok(i.requests[0].crew === undefined && i.requests[0].problems.length > 0, "'bump it up a couple' produces no crew count (Ben, 10-06)", JSON.stringify(i.requests[0].problems));
}
{
  const i = ground(ex([req({ date: g("2026-09-17", "17th September"), start: g("09:30", "9.30am"), duration_minutes: g(180, "3hr call"), crew: g(3, "3 x Crew"), trade: g("AV technician", "17th September") })]), newest, sent);
  ok(i.requests[0].problems.some((p) => p.includes("trade")), "an unbenched trade goes to ops");
}

console.log("crew increases");
{
  const mail = "Could you add 2 crew to Steve's 4 on Friday 9th please?";
  const i = ground(ex([req({ action: "change_crew", date: g("2026-10-09", "Friday 9th"), crew_add: g(2, "add 2 crew") })], { intent: "change" }), mail, "2026-10-07T09:00:00Z");
  ok(i.requests[0].problems.length === 0 && i.requests[0].crew_add === 2 && i.requests[0].crew === undefined, "'add 2 crew' is an increase of 2, not a total (R11425)", JSON.stringify(i.requests[0]));
  const j = ground(ex([req({ action: "change_crew", date: g("2026-10-09", "Friday 9th"), crew_add: g(2, "2 crew") })], { intent: "change" }), "We need 2 crew on Friday 9th", "2026-10-07T09:00:00Z");
  ok(j.requests[0].crew_add === undefined, "a bare count is not an increase");
}

console.log("changes");
{
  const mail = "Could we please change the derig shift to 22:00-02:00 on the 30th?";
  const i = ground(ex([req({ action: "change_times", start: g("22:00", "22:00"), end: g("02:00", "02:00"), target: { quote: "the derig shift", date: g("2026-09-30", "the 30th"), start: null } })], { intent: "change" }), mail, "2026-09-25T09:00:00Z");
  const r = i.requests[0];
  ok(r.problems.length === 0 && r.target?.date === "2026-09-30" && r.start === "22:00" && r.end === "02:00", "a time change with its target shift", JSON.stringify(r));
}
{
  const i = ground(ex([req({ action: "other" })], { intent: "info_only" }), "Thanks, all paid now.", sent);
  ok(i.requests[0].problems.some((p) => p.includes("not an operation")), "an 'other' request is never an operation");
}
{
  const i = ground(ex([], { po: g("Legal Geek", "Legal Geek") }), "RE: PO - Legal Geek - 12/10/26", sent);
  ok(i.po === undefined, "a PO with no digit is refused (Legal Geek, #13709)");
}
{
  // EMS 10-09: the job number leads the subject with no PO label. The booking stands; the PO is left off.
  const text = "J46250 - 13/10/26 @ The Carter Building\nNo. of crew:  3";
  const i = ground(ex([req({ date: g("2026-10-13", "13/10/26"), start: g("09:00", "09:00"), duration_minutes: g(240, "4 hours"), crew: g(3, "No. of crew:  3") })], { po: g("J46250", "J46250") }), text + "\n09:00 for 4 hours", "2026-10-09T10:13:37Z");
  ok(i.po === undefined && i.problems.length === 0 && i.requests[0].problems.length === 0, "an unlabelled PO is left off and blocks nothing", JSON.stringify(i.problems));
  ok((i.notes ?? []).some((n) => n.includes("J46250")), "and the decision says so", JSON.stringify(i.notes));
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
