// ============================================================================
// SP-03 residual: a Gmail label that did not land is reported, not only logged.
// ----------------------------------------------------------------------------
// From 10-02 every label post failed on the expired Gmail credential, and each failure
// went to console.error, which nobody reads. Now each label kind reports on the
// "label-failed" route (one fingerprint per kind, so one email per kind per window),
// and the marker stays unset so the next pass tries again.
//
// Offline.  npx tsx test/labelFailureReports.ts
// ============================================================================
import { flagManualIfNeeded, flagBuiltIfNeeded, type PipelineDeps } from "../app/lib/engine/pipeline";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// What deps.postTag throws when n8n answers 200 with an empty body (a rejected secret,
// a dead credential): the label did not land.
const n8nEmpty = async () => { throw new Error("Manual Tag answered 200 with an empty body"); };

function rig() {
  const reports: Array<{ route: string; where: string }> = [];
  const deps = {
    store: { get: async () => undefined, put: async () => {}, all: async () => [] },
    flagForManual: n8nEmpty, flagOrderBuilt: n8nEmpty,
    report: async (a: { route: string; where: string }) => { reports.push({ route: a.route, where: a.where }); return false; },
  } as unknown as PipelineDeps;
  return { deps, reports };
}

(async () => {
  console.log("\n[1] a Needs label that fails is reported, and left to retry");
  {
    const r = rig();
    const s = { thread_id: "t-l1", classification: "new-job", status: "needs-info", needs_human: true, notes: ["no venue given"] } as unknown as ConversationState;
    await flagManualIfNeeded(s, r.deps);
    ok(r.reports.length === 1 && r.reports[0].route === "label-failed", "one label-failed report", JSON.stringify(r.reports));
    ok(s.manual_flagged !== true, "and the marker is not set, so the next pass posts it again");
  }

  console.log("\n[2] each label kind is its own fingerprint; repeats of one kind share it");
  {
    const r = rig();
    const a = { thread_id: "t-a", classification: "new-job", status: "needs-info", needs_human: true, notes: ["x"] } as unknown as ConversationState;
    const b = { thread_id: "t-b", classification: "new-job", status: "needs-info", needs_human: true, notes: ["y"] } as unknown as ConversationState;
    const c = { thread_id: "t-c", classification: "new-job", status: "ordered", onsinch_order_id: 9001, notes: [] } as unknown as ConversationState;
    await flagManualIfNeeded(a, r.deps);
    await flagManualIfNeeded(b, r.deps);
    await flagBuiltIfNeeded(c, r.deps);
    const wheres = r.reports.map((x) => x.where);
    ok(wheres[0] === wheres[1], "two Needs failures share one place, so they collapse to one email", wheres.join(" | "));
    ok(wheres[2] !== wheres[0] && /Order Built/.test(wheres[2] ?? ""), "an Order Built failure is a different one", wheres.join(" | "));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
