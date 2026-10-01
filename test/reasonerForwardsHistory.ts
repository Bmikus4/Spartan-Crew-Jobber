// ============================================================================
// Every layer between the compiler and the model passes the conversation history on.
// ----------------------------------------------------------------------------
// The incremental call has taken the history since 2026-08-10 ("the classifier reads the
// whole labelled conversation, not the newest email"), but the spend guard and the tier
// wrapper kept four parameters, so on Vercel every email was classified on its own while
// each thread's note said "read the whole conversation" (found 2026-10-01). The same
// shape of bug as the dropped ReplyContext: a hand-written wrapper is a place an argument
// can silently vanish.
//
// Offline.  npx tsx test/reasonerForwardsHistory.ts
// ============================================================================
import { guardReasoner } from "../app/lib/engine/spend";
import { tieredReasoner } from "../app/lib/engine/tiered";
import type { Reasoner } from "../app/lib/engine/reason";
import { msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

function recorder() {
  const seen: any[][] = [];
  const r: Reasoner = {
    async classifyAndExtractIncremental(...a: any[]) { seen.push(a); return { classification: "update", priority: "low", job_summary: "x", facts: { requests: [] } } as any; },
    async classifyAndExtract(...a: any[]) { seen.push(a); return { classification: "update", priority: "low", job_summary: "x", facts: { requests: [] } } as any; },
    async classify() { return { classification: "update", priority: "low", job_summary: "x" } as any; },
    async extractFacts() { return { requests: [] } as any; },
    async composeReply() { return { subject: "s", html: "h", priority: "low" } as any; },
  };
  return { r, seen };
}

const latest = msg({ message_id: "m3", date_iso: "2026-10-01T09:00:00Z", subject: "Re: Crew", body: "it won't be needed" });
const history = [
  msg({ message_id: "m1", date_iso: "2026-09-29T09:00:00Z", subject: "Crew", body: "4 crew on the 30th please" }),
  msg({ message_id: "m2", date_iso: "2026-09-29T10:00:00Z", subject: "Re: Crew", body: "We can do Thursday instead" }),
];

async function main() {
  console.log("\n[1] the spend guard (production's wrapper)");
  {
    const { r, seen } = recorder();
    await guardReasoner(r, { model: "anthropic/claude-opus-4.6", limit: 10 }).classifyAndExtractIncremental!(latest, { requests: [] }, "update", true, history);
    ok(seen[0]?.[4]?.length === 2, "the model is shown the two earlier messages", `history=${seen[0]?.[4]?.length}`);
  }

  console.log("\n[2] the tier wrapper, cheap model and escalation alike");
  {
    const cheap = recorder(), strong = recorder();
    await tieredReasoner(cheap.r, strong.r).classifyAndExtractIncremental!(latest, { requests: [] }, "update", true, history);
    ok(cheap.seen[0]?.[4]?.length === 2, "the cheap model sees it", `history=${cheap.seen[0]?.[4]?.length}`);
  }

  console.log("\n[3] both layers stacked, as deps.ts builds them when a cheap model is set");
  {
    const cheap = recorder(), strong = recorder();
    await guardReasoner(tieredReasoner(cheap.r, strong.r), { model: "x", limit: 10 }).classifyAndExtractIncremental!(latest, { requests: [] }, "update", true, history);
    ok(cheap.seen[0]?.[4]?.length === 2, "still there at the bottom", `history=${cheap.seen[0]?.[4]?.length}`);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
