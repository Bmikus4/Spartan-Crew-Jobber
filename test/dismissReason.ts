// ============================================================================
// A dismissed thread must record WHY it was dismissed.
// ----------------------------------------------------------------------------
// The board now has a Dismissed lane, so the engine's rejections can be audited
// instead of vanishing. That is only worth having if each row says why: on live
// data 18 of 25 dismissed tickets had gate_reason NULL, so the lane would have
// read "not a job" 18 times and told nobody anything.
//
// The reason already exists. The classifier returns job_summary, and for a
// rejection that summary IS the explanation ("N/A - Acknowledgment/confirmation
// only, no changes requested"). It was being used as the order specification for
// real jobs and discarded for everything else.
//
// Run: npx tsx test/dismissReason.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { Reasoner } from "../app/lib/engine/reason";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const onsinch = new OnsinchClient(mockTransport);
const deps = { reasoner: mockReasoner, onsinch, now: () => 1, repliesEnabled: false };

/** A reasoner that rejects, the way the live one does, with its reason in job_summary. */
function rejecting(summary: string): Reasoner {
  return {
    ...mockReasoner,
    async classify() {
      return { classification: "not-a-job" as const, priority: "low" as const, job_summary: summary };
    },
  };
}

async function main() {
  console.log("\n[1] a rejection carries the classifier's own explanation");
  {
    const summary = "N/A - Acknowledgment/confirmation only, no changes requested";
    const { state } = await compile(
      { thread_id: "t-dismiss", messages: [msg({ message_id: "m1", body: "Sounds good, thanks!" })] },
      undefined,
      { ...deps, reasoner: rejecting(summary) }
    );
    console.log(`      notes: ${JSON.stringify(state.notes)}`);
    ok(state.classification === "not-a-job", "classified not-a-job", state.classification);
    ok(state.notes.length > 0, "a reason was recorded at all");
    ok(state.notes.some((n) => /acknowledgment|confirmation/i.test(n)),
      "the reason explains the dismissal", JSON.stringify(state.notes));
    ok(!state.notes.some((n) => /^N\/A\s*-/.test(n)),
      "the machine-readable 'N/A -' prefix is stripped for a human reader");
  }

  console.log("\n[2] machine mail keeps its own, more specific reason");
  {
    const { state } = await compile(
      { thread_id: "t-machine", messages: [msg({ message_id: "m1", from: "no-reply@sinch.cz", body: "Client created new order" })] },
      undefined,
      { ...deps, reasoner: rejecting("N/A - notification") }
    );
    ok(state.classification === "not-a-job", "not-a-job");
    ok(state.notes.some((n) => /machine mail/i.test(n)),
      "machine-mail note wins — it names the sender", JSON.stringify(state.notes));
  }

  console.log("\n[3] a real job is unaffected: the summary is still the spec, not a note");
  {
    const { state } = await compile(
      { thread_id: "t-job", messages: [msg({ message_id: "m1", body: "RedBeast Energy Ltd need 6 crew on 12 August at ExCeL London, 08:00-18:00." })] },
      undefined,
      deps
    );
    ok(state.classification === "new-job", "new-job", state.classification);
    const spec = state.desired_order?.specification ?? state.pending_order?.desired.specification;
    ok(!!spec, "the summary is still carried as the order specification", String(spec).slice(0, 40));
  }

  console.log("\n[4] an empty summary does not fabricate a reason");
  {
    const { state } = await compile(
      { thread_id: "t-blank", messages: [msg({ message_id: "m1", body: "hello" })] },
      undefined,
      { ...deps, reasoner: rejecting("   ") }
    );
    ok(!state.notes.some((n) => n.trim() === ""), "no empty note pushed", JSON.stringify(state.notes));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
