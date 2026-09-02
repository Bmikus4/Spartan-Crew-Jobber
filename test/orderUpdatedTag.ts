// ============================================================================
// "Order Updated" — a booking this thread already had has been changed.
// ----------------------------------------------------------------------------
// Ben, 2026-09-02: "when orders are appended the thread should get a blue 'Order
// Updated' tag in Gmail."
//
// It is NOT the mirror of "Order Built", and the difference is the reason it never
// clears. "Order Built" is a standing statement about now — a booking exists, and
// it comes off when the order stops existing. This one is a statement about the
// past: somebody's booking moved after they had been told about it, and that stays
// true even after the order is deleted.
//
// WHAT COUNTS AS A CHANGE is read off `order_action_log`, not passed down from the
// amend path. Three routes change a standing order — a PATCH in place, a block
// appended, and the delete-and-repost rebuild — and each already writes its own
// line to that log, so a fourth route added later is tagged without anybody
// remembering to tag it. `create` is excluded: the first booking is what "Order
// Built" says, and a thread wearing both on its first order makes blue meaningless.
//
// Run: npx tsx test/orderUpdatedTag.ts
// ============================================================================
import { flagUpdatedIfNeeded, TAG_BLUE, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

type Action = ConversationState["order_action_log"][number];
const act = (kind: Action["kind"], ok_: boolean, order_id = 15696): Action =>
  ({ ts: 1, kind, order_id, ok: ok_ });

const st = (o: Partial<ConversationState>): ConversationState => ({
  thread_id: "T1", subject: "Crew for the Museum", participants: [],
  last_message_id: "m1", last_processed_epoch: 1, classification: "update",
  facts: { requests: [] }, desired_order: null, priority: "medium",
  needs_human: false, status: "ordered", notes: [], order_action_log: [],
  onsinch_order_id: 15696, onsinch_order_number: "10756",
  ...o,
} as ConversationState);

function rig(opts: { fail?: boolean } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const deps = {
    store: new InMemoryStore(),
    flagOrderUpdated: async (a: Record<string, unknown>) => {
      sent.push(a);
      if (opts.fail) throw new Error("n8n said 200 with an empty body");
    },
  } as unknown as PipelineDeps;
  return { deps, sent };
}

(async () => {
  console.log("\n[1] a block appended to a standing order tags the thread, blue, once");
  {
    const { deps, sent } = rig();
    const s = st({ order_action_log: [act("create", true), act("amend", true)] });
    await flagUpdatedIfNeeded(s, deps);
    ok(sent.length === 1, "one post", String(sent.length));
    ok(sent[0].label === "Order Updated", "the label ops will see", String(sent[0].label));
    ok(sent[0].state === "built", "it is added, not removed", String(sent[0].state));
    ok(JSON.stringify(sent[0].color) === JSON.stringify(TAG_BLUE), "and it carries Gmail's blue", JSON.stringify(sent[0].color));
    ok(String(sent[0].reason).includes("R10756"), "the reason names the R number ops search on", String(sent[0].reason));
    ok(s.updated_flagged === true, "the flag is recorded");

    // The thread is re-read on every new message. Without the flag it would re-post
    // on every reply for the rest of the conversation's life.
    await flagUpdatedIfNeeded(s, deps);
    ok(sent.length === 1, "a second pass posts nothing", String(sent.length));
  }

  console.log("\n[2] the first booking is NOT an update");
  {
    const { deps, sent } = rig();
    const s = st({ order_action_log: [act("create", true)] });
    await flagUpdatedIfNeeded(s, deps);
    ok(sent.length === 0, "a create alone never tags blue", String(sent.length));
    ok(s.updated_flagged !== true, "and nothing is recorded");
  }

  console.log("\n[3] all three routes that change a standing order count");
  for (const kind of ["amend", "patch", "replace"] as Action["kind"][]) {
    const { deps, sent } = rig();
    await flagUpdatedIfNeeded(st({ order_action_log: [act("create", true), act(kind, true)] }), deps);
    ok(sent.length === 1, `${kind} tags`, String(sent.length));
  }

  console.log("\n[4] a change that did not happen does not tag");
  {
    const { deps, sent } = rig();
    await flagUpdatedIfNeeded(st({ order_action_log: [act("create", true), act("amend", false)] }), deps);
    ok(sent.length === 0, "a failed amend is not an update", String(sent.length));
    const r2 = rig();
    await flagUpdatedIfNeeded(st({ order_action_log: [act("amend-refused", true), act("replace-refused", true)] }), r2.deps);
    ok(r2.sent.length === 0, "and neither is a refusal", String(r2.sent.length));
  }

  console.log("\n[5] a webhook that throws leaves the flag unset, so the next email retries");
  {
    const { deps, sent } = rig({ fail: true });
    const s = st({ order_action_log: [act("amend", true)] });
    await flagUpdatedIfNeeded(s, deps);
    ok(sent.length === 1, "it was attempted", String(sent.length));
    ok(s.updated_flagged !== true, "and NOT recorded — a marker for a tag that never landed would stop it retrying");
  }

  console.log("\n[6] no webhook wired means no tag, silently");
  {
    const s = st({ order_action_log: [act("amend", true)] });
    await flagUpdatedIfNeeded(s, { store: new InMemoryStore() } as unknown as PipelineDeps);
    ok(s.updated_flagged !== true, "a local run has no business writing labels into the live mailbox");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
