// ============================================================================
// "Order Built" — the thread carries the fact that a booking exists.
// ----------------------------------------------------------------------------
// Ben, 2026-08-29: an Order Built tag, added to the thread via n8n.
//
// The mirror of the Manual tag and deliberately independent of it. They answer
// different questions and a thread can honestly need both:
//
//   Order Built   there is an order in OnSinch for this conversation
//   Manual        somebody has to do something about this conversation
//
// A job booked on an assumed rate card is both — the order exists AND the price
// wants a human. Making one suppress the other would hide whichever ops needed.
//
// NO n8n CHANGE WAS REQUIRED. The tag workflow already reads the label from the
// payload (`label: b.label || 'Manual'`) and finds-or-creates it by name, so a new
// label is a new string rather than a new workflow — which matters, because editing
// the live n8n is the recurring way this system breaks.
//
// Run: npx tsx test/orderBuiltTag.ts
// ============================================================================
import { flagBuiltIfNeeded, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const st = (o: Partial<ConversationState>): ConversationState => ({
  thread_id: "T1", subject: "Crew for the Museum", participants: [],
  last_message_id: "m1", last_processed_epoch: 1, classification: "new-job",
  facts: { requests: [] }, desired_order: null, priority: "medium",
  needs_human: false, status: "ordered", notes: [], order_action_log: [],
  ...o,
} as ConversationState);

function rig(opts: { fail?: boolean } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const deps = {
    store: new InMemoryStore(),
    flagOrderBuilt: async (a: Record<string, unknown>) => {
      sent.push(a);
      if (opts.fail) throw new Error("n8n said 200 with an empty body");
    },
  } as unknown as PipelineDeps;
  return { deps, sent };
}

(async () => {
  console.log("\n[1] an order exists, so the thread is tagged — once");
  {
    const { deps, sent } = rig();
    const s = st({ onsinch_order_id: 15696, onsinch_order_number: "10756" });
    await flagBuiltIfNeeded(s, deps);
    ok(sent.length === 1, "one post", String(sent.length));
    ok(sent[0].label === "Order Built", "the label ops will see", String(sent[0].label));
    ok(sent[0].state === "built", "state built", String(sent[0].state));
    ok(String(sent[0].reason).includes("10756"), "and it names the R number a human searches on", String(sent[0].reason));
    ok(s.built_flagged === true, "the marker is written so the next email does not re-post");

    await flagBuiltIfNeeded(s, deps);
    ok(sent.length === 1, "a re-read of the same thread posts nothing", String(sent.length));
  }

  console.log("\n[2] no order, no tag");
  {
    const { deps, sent } = rig();
    await flagBuiltIfNeeded(st({ status: "needs-info" }), deps);
    ok(sent.length === 0, "a thread with no order is not tagged", String(sent.length));
  }

  console.log("\n[3] it comes OFF if the order stops existing");
  {
    /**
     * Order 15572 is the case: the client asked for a change, the engine went to amend
     * and found the order had been deleted in OnSinch by someone else. A thread still
     * wearing "Order Built" then tells ops a booking exists when none does, which is
     * the one lie this tag must never tell.
     */
    const { deps, sent } = rig();
    const s = st({ onsinch_order_id: 15696, built_flagged: true });
    s.onsinch_order_id = undefined;
    await flagBuiltIfNeeded(s, deps);
    ok(sent.length === 1 && sent[0].state === "cleared", "cleared when the order is gone", JSON.stringify(sent[0]?.state));
    ok(s.built_flagged === false, "and the marker with it");
  }

  console.log("\n[4] it is independent of the Manual tag");
  {
    // A booking on an assumed rate card is both: the order exists, and the price
    // wants a human. Neither tag may suppress the other.
    const { deps, sent } = rig();
    const s = st({ onsinch_order_id: 15696, needs_human: true });
    await flagBuiltIfNeeded(s, deps);
    ok(sent.length === 1, "still tagged built while a human is also wanted", String(sent.length));
  }

  console.log("\n[5] a failed post is retried, never recorded as done");
  {
    const { deps } = rig({ fail: true });
    const s = st({ onsinch_order_id: 15696 });
    await flagBuiltIfNeeded(s, deps);
    ok(s.built_flagged !== true,
      "the marker is not set, so the next message tries again rather than believing a tag that was never applied");
  }

  console.log("\n[6] no webhook configured means no tagging, and no error");
  {
    const deps = { store: new InMemoryStore() } as unknown as PipelineDeps;
    const s = st({ onsinch_order_id: 15696 });
    await flagBuiltIfNeeded(s, deps);
    ok(s.built_flagged === undefined, "a preview deploy does not write labels into the live mailbox");
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
