// ============================================================================
// The resolver follows design §9.2 branch by branch.
// ----------------------------------------------------------------------------
// Each case is one rule of the procedure. The ones that matter most are the refusals:
// it never continues a job on the company alone, and a veto beats any positive.
//
// Offline.  npx tsx test/resolver.ts
// ============================================================================
import { resolveMessage, type JobView, type MessageView } from "../app/lib/engine/resolver";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const EXCEL = 88, OLYMPIA = 99;
const jobs: JobView[] = [
  { job_key: "job:A", company_id: 42, days: ["2026-11-12"], place_ids: [EXCEL], order_numbers: ["10500"] },
  { job_key: "job:B", company_id: 42, days: ["2026-11-20"], place_ids: [OLYMPIA], order_numbers: ["10510"] },
  { job_key: "job:X", company_id: 7, days: ["2026-11-12"], place_ids: [EXCEL], order_numbers: ["10600"] },
  { job_key: "job:old", company_id: 42, days: ["2026-06-01"], place_ids: [EXCEL], order_numbers: ["9000"] },
];
const m = (over: Partial<MessageView>): MessageView => ({
  thread_id: "t", company_id: 42, own_text: "", days: [], asks_for_crew: false, at: "2026-11-01T09:00:00Z", ...over,
});
const is = (o: ReturnType<typeof resolveMessage>, kind: string, job?: string) =>
  o.kind === kind && (!job || (o.kind === "CONTINUE" && o.job === job));

console.log("\n[1] hard reference: an R number of this client");
ok(is(resolveMessage(m({ own_text: "Re R10510 can we add two" }), jobs), "CONTINUE", "job:B"), "continues the job it names");
{
  const o = resolveMessage(m({ own_text: "about R10600" }), jobs);
  ok(o.kind === "UNCERTAIN" && o.evidence.some((e) => e.kind === "veto"), "another client's R number is a veto, not a match", o.kind);
}
ok(is(resolveMessage(m({ own_text: "Same crew as R9000 but for another event", days: ["2026-12-05"], asks_for_crew: true }), jobs), "NEW"),
  "an old job cited for a new engagement on other days is a new job");

console.log("\n[2] thread continuity");
ok(is(resolveMessage(m({ own_text: "thanks" }), jobs, "job:A"), "CONTINUE", "job:A"), "same thread, nothing against it");
ok(is(resolveMessage(m({ own_text: "can you do the 14th", days: ["2026-11-14"] }), jobs, "job:A"), "UNCERTAIN"),
  "other days within 7, no change language: abstain (the 45-pair zone)");
ok(is(resolveMessage(m({ own_text: "please move it to the 14th instead", days: ["2026-11-14"] }), jobs, "job:A"), "CONTINUE", "job:A"),
  "the same days moved, in change language, continue");
ok(is(resolveMessage(m({ own_text: "crew for January", days: ["2027-01-20"], asks_for_crew: true }), jobs, "job:A"), "NEW"),
  "far-off days on the same thread are a new job");
ok(is(resolveMessage(m({ own_text: "need crew again", asks_for_crew: true, at: "2026-07-01T09:00:00Z" }), jobs, "job:old"), "NEW"),
  "a closed job plus a crew request is a new job");

console.log("\n[3] cross-thread, among the client's open jobs");
ok(is(resolveMessage(m({ days: ["2026-11-12"], place_id: EXCEL, asks_for_crew: true }), jobs), "CONTINUE", "job:A"), "same day and venue continue");
ok(is(resolveMessage(m({ days: ["2026-11-12"], place_id: OLYMPIA, asks_for_crew: true }), jobs), "NEW"), "same day, another known venue: a parallel job");
ok(is(resolveMessage(m({ days: ["2026-11-12"], asks_for_crew: true }), jobs), "UNCERTAIN"), "same day, venue unknown: abstain");
ok(is(resolveMessage(m({ days: ["2026-11-27"], place_id: EXCEL, asks_for_crew: true }), jobs), "NEW"), "no shared day: new");
{
  // One agency, one venue, one day, two brands at different hours (19 Sep 2026).
  const timed = jobs.map((j) => (j.job_key === "job:A" ? { ...j, slots: [{ day: "2026-11-12", start: "09:30", end: "13:30" }] } : j));
  const evening = m({ days: ["2026-11-12"], place_id: EXCEL, asks_for_crew: true, slots: [{ day: "2026-11-12", start: "18:30", end: "20:30" }] });
  ok(is(resolveMessage(evening, timed), "UNCERTAIN"), "same day and venue at hours that never overlap: abstain, never continue");
  const overlap = m({ days: ["2026-11-12"], place_id: EXCEL, asks_for_crew: true, slots: [{ day: "2026-11-12", start: "12:00", end: "16:00" }] });
  ok(is(resolveMessage(overlap, timed), "CONTINUE", "job:A"), "overlapping hours still continue");
  const unknown = m({ days: ["2026-11-12"], place_id: EXCEL, asks_for_crew: true });
  ok(is(resolveMessage(unknown, timed), "CONTINUE", "job:A"), "unknown hours are no evidence against it");
}

console.log("\n[4] never on the company alone");
ok(is(resolveMessage(m({ own_text: "can we get crew?", asks_for_crew: true }), jobs), "UNCERTAIN"), "an undated crew request with open jobs abstains");
{
  const o = resolveMessage(m({ own_text: "any news?" }), jobs.filter((j) => j.job_key === "job:A"));
  ok(o.kind === "UNCERTAIN" && o.probable === "job:A", "one open job and no date: probable, not continued", o.kind);
}
ok(is(resolveMessage(m({ company_id: undefined, asks_for_crew: true }), jobs), "NEW"), "an unknown company asking for crew is a new client");

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
