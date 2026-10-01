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

console.log("\n[9] Ben's review of the shadow disagreements (2026-10-01)");
{
  // r2: two Solotech threads, both on the "No Location" placeholder (6922): no venue is
  // not the same venue.
  const placeholder: JobView[] = [{ job_key: "job:S", company_id: 279, days: ["2026-08-30", "2026-08-31", "2026-09-01"], place_ids: [6922], order_numbers: ["13605"] }];
  const o = resolveMessage(m({ company_id: 279, days: ["2026-08-31", "2026-09-01"], place_id: 6922, asks_for_crew: true, at: "2026-08-25T09:00:00Z" }), placeholder);
  ok(o.kind !== "CONTINUE", "two threads on the placeholder venue are not merged", o.kind);

  // r7: Drumsheds 9-14 Sep and 14-19 Sep share only the boundary day.
  const run: JobView[] = [{ job_key: "job:D", company_id: 900, days: ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"], place_ids: [555], order_numbers: ["15872"] }];
  const d = resolveMessage(m({ company_id: 900, days: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"], place_id: 555, asks_for_crew: true, at: "2026-09-08T09:00:00Z" }), run);
  ok(d.kind !== "CONTINUE", "two six-day runs touching on one day are not one job", d.kind);

  // r4: Eclipse warehouse crew on the 10th, inside the PO's 10-14 Aug: the same job.
  const po: JobView[] = [{ job_key: "job:E", company_id: 77, days: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"], place_ids: [321], order_numbers: ["13675"] }];
  ok(is(resolveMessage(m({ company_id: 77, days: ["2026-08-10"], place_id: 321, asks_for_crew: true, at: "2026-08-05T09:00:00Z" }), po), "CONTINUE", "job:E"),
    "a one-day request inside a five-day job still continues it");
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
