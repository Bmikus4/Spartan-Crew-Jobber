// ============================================================================
// The job migration plans one job per booking, from rows alone.
// ----------------------------------------------------------------------------
// Design §27 / §30 step 4: threads that share any order are one job; a thread that
// asked for work and never held an order is a job with no link; everything else is not
// a job. Pure, and a dry run — nothing is written.
//
// Offline.  npx tsx test/jobMigration.ts
// ============================================================================
import { planJobMigration } from "../app/lib/engine/jobMigration";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const records = [
  { order_id: 101, thread_id: "A", id_source: "api_response", company_id: 42 },
  { order_id: 101, thread_id: "B", id_source: "matched", company_id: 42 },
  { order_id: 201, thread_id: "C", id_source: "api_response", company_id: 7 },
  { order_id: 301, thread_id: "Z", id_source: "matched", company_id: 9 }, // no state row
];
const states = [
  { thread_id: "A", classification: "new-job", company_id: 42, onsinch_order_id: 101, order_action_log: [{ kind: "create", order_id: 101, ok: true }] },
  { thread_id: "B", classification: "update", company_id: 42, onsinch_order_id: 101 },
  // C's order was deleted and re-posted: the log names both, the state only the second.
  { thread_id: "C", classification: "update", company_id: 7, onsinch_order_id: 202,
    order_action_log: [{ kind: "create", order_id: 201, ok: true }, { kind: "replace", order_id: 202, ok: true }, { kind: "create", order_id: 999, ok: false }] },
  { thread_id: "D", classification: "new-job", company_id: 7 },
  { thread_id: "E", classification: "not-a-job" },
];

const { jobs, report } = planJobMigration(records, states);
const jobOf = (t: string) => jobs.find((j) => j.threads.includes(t));

console.log("\n[1] threads that share an order are one job");
ok(jobOf("A") === jobOf("B") && jobOf("A")!.threads.length === 2, "A and B merge on order 101", JSON.stringify(jobOf("A")?.threads));
ok(jobOf("A")!.links.find((l) => l.thread_id === "B")?.source === "matched", "B's link is a match");
ok(jobOf("A")!.links.find((l) => l.thread_id === "A")?.source === "created", "A's link is a create");

console.log("\n[2] a job keeps every order it ever had");
{
  const c = jobOf("C")!;
  ok(JSON.stringify(c.links.map((l) => l.onsinch_order_id)) === "[201,202]", "the deleted order and its replacement", JSON.stringify(c.links.map((l) => l.onsinch_order_id)));
  ok(!c.links.some((l) => l.onsinch_order_id === 999), "a write that failed is not a link");
  ok(c.links.find((l) => l.onsinch_order_id === 202)?.seen_in.includes("order_records") === false, "a link the durable table lacks is marked so");
}

console.log("\n[3] asking for work without an order is a job; anything else is not");
ok(!!jobOf("D") && jobOf("D")!.links.length === 0, "D is a job with no link");
ok(!jobOf("E"), "E is not a job");

console.log("\n[4] the report counts what a human must look at");
ok(report.jobs === 4 && report.jobs_linked === 3 && report.jobs_unlinked === 1, "4 jobs: 3 linked, 1 not", JSON.stringify(report));
ok(report.jobs_merging_threads === 1 && report.jobs_with_several_orders === 1, "one merge, one multi-order job");
ok(report.records_without_state === 1 && report.links_missing_from_order_records === 1, "the gaps between the two tables");
ok(report.threads_not_jobs === 1, "one thread that is not a job");

console.log("\n[5] the plan is deterministic");
ok(JSON.stringify(planJobMigration(records, [...states].reverse())) === JSON.stringify({ jobs, report }), "same keys whatever the row order");

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
