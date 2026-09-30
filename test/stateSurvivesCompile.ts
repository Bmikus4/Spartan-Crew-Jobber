// ============================================================================
// What the pipeline records on a thread survives the next email.
// ----------------------------------------------------------------------------
// compile() built its state from an explicit field list, and the store writes
// `state = EXCLUDED.state`, so every field the pipeline or the sweep had set and the
// list did not name was erased by the next inbound email. Six were: built_flagged,
// manual_flagged, needs_label, updated_flagged, reconcile, pending_order (audit #2,
// scenarios S3/S4/S6; 173 of 638 threads get a further message after booking).
//
// What that did: "Order Built" was re-posted on every message, because the thread
// never remembered it was tagged; and when staff deleted the order the tag was never
// taken off, because there was no "was tagged" to change from. The reconcile give-up
// counter went back to 1 on any ordinary email.
//
// Offline.  npx tsx test/stateSurvivesCompile.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationState } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// Written by the pipeline and the sweep AFTER compile returns; compile never sets them.
const CARRIED = {
  built_flagged: true,
  manual_flagged: true,
  needs_label: true,
  updated_flagged: true,
  reconcile: { attempts: 3 },
  pending_order: { kind: "create", desired: { name: "held" } },
} as unknown as Partial<ConversationState>;

async function main() {
  console.log("\n[1] a thanks-only email keeps what the pipeline recorded");
  const prior = {
    thread_id: "t-carry", subject: "Crew", participants: [], last_message_id: "c1", last_processed_epoch: 1,
    classification: "new-job", facts: { requests: [] }, priority: "medium", needs_human: false,
    status: "ordered", notes: [], order_action_log: [], onsinch_order_id: 9001, company_id: 42,
    ...CARRIED,
  } as unknown as ConversationState;
  const thread = {
    thread_id: "t-carry",
    messages: [
      msg({ message_id: "c1", date_iso: "2026-02-12T10:00:00Z", body: "Please book 4 crew on 9 March. RedBeast Energy" }),
      msg({ message_id: "c2", date_iso: "2026-02-13T10:00:00Z", body: "Thanks!" }),
    ],
  };
  const { state } = await compile(thread, prior, {
    reasoner: mockReasoner, onsinch: new OnsinchClient(mockTransport), now: () => 2, repliesEnabled: false,
  });
  for (const k of Object.keys(CARRIED) as (keyof ConversationState)[]) {
    ok(JSON.stringify(state[k]) === JSON.stringify(CARRIED[k]), `${String(k)} survives`, JSON.stringify(state[k]));
  }

  console.log("\n[2] compile carries every field it does not itself recompute");
  {
    // Pinned in source so the next field the pipeline adds is carried without anyone
    // having to remember this file: the state literal starts from prior.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../app/lib/engine/compiler.ts", import.meta.url), "utf8");
    const at = src.indexOf("const state: ConversationState = {");
    ok(at > 0 && /^\s*(?:\/\/[^\n]*\n\s*)*\.\.\.\(prior \?\? \{\}\),/.test(src.slice(at + "const state: ConversationState = {".length)),
      "the final state literal opens with ...(prior ?? {})");
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
