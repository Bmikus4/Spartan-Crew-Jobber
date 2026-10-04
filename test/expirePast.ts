// ============================================================================
// SP-40: a needs-a-person flag on a job whose days are all over comes off.
// ----------------------------------------------------------------------------
// 189 of 232 flagged threads were older than 7 days on 10-03; the oldest was 07-29.
// expirePast clears the flags on a thread whose every requested and desired day is more
// than a day past, at most 20 a run, and the label then comes off through the normal
// flagManualIfNeeded path. An undated or still-future thread is never touched.
//
// Offline.  npx tsx test/expirePast.ts
// ============================================================================
import { expirePast, MAX_EXPIRED_PER_RUN } from "../app/lib/engine/expirePast";
import { cannotBeBooked, flagManualIfNeeded, type PipelineDeps } from "../app/lib/engine/pipeline";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const TODAY = "2026-10-05T09:00:00Z";
const flagged = (id: string, dates: string[], over: Partial<ConversationState> = {}) => ({
  thread_id: id, classification: "new-job", status: "needs-info", needs_human: true, manual_flagged: true,
  needs_label: "Order Needs Built", notes: ["no venue given"],
  facts: { requests: dates.map((date) => ({ date })) }, ...over,
}) as unknown as ConversationState;

async function main() {
  console.log("\n[1] which threads expire");
  {
    const out = expirePast([
      flagged("past", ["2026-08-01", "2026-08-02"]),
      flagged("yesterday", ["2026-10-04"]),
      flagged("mixed", ["2026-09-01", "2026-10-20"]),
      flagged("undated", []),
      flagged("held", ["2026-07-29"], { retry_pending: "venue-judge", status: "error" }),
    ], TODAY);
    ok(out.map((s) => s.thread_id).join() === "past,held", "only threads whose every day is over by more than a day",
      out.map((s) => s.thread_id).join());
    const p = out[0];
    ok(!p.needs_human && !p.pending_order && !p.retry_pending && !cannotBeBooked(p), "and they are bookable again, flags cleared");
    ok(/dates have passed/.test(p.notes[p.notes.length - 1]), "with a note saying why");
  }

  console.log("\n[2] capped per run");
  {
    const many = Array.from({ length: 50 }, (_, i) => flagged(`t${i}`, ["2026-08-01"]));
    ok(expirePast(many, TODAY).length === MAX_EXPIRED_PER_RUN, `at most ${MAX_EXPIRED_PER_RUN}`);
  }

  console.log("\n[3] the Needs label comes off through the normal path");
  {
    const tags: Array<{ label: string; state: string }> = [];
    const deps = { store: { put: async () => {}, get: async () => undefined, all: async () => [] },
      flagForManual: async (t: any) => { tags.push({ label: t.label, state: t.state }); } } as unknown as PipelineDeps;
    const [s] = expirePast([flagged("past", ["2026-08-01"])], TODAY);
    await flagManualIfNeeded(s, deps);
    ok(tags.length === 1 && tags[0].state === "cleared" && tags[0].label === "Order Needs Built", "one clear of the label it wore", JSON.stringify(tags));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
