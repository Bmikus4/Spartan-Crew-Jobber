// ============================================================================
// Re-delivering a thread the engine has already read costs no model call.
// ----------------------------------------------------------------------------
// The fast path keyed on selectLatest over the raw messages; the compiler stores the id
// normalizeThread chose. Those differ on a colleague's forward (the recovered client
// message is `<id>:quoted`) and on a newest message with an empty body (dropped), so
// both shapes re-ran the model on every sweep (audit X3).
//
// Offline.  npx tsx test/redeliveryIsFree.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const FACTS: ConversationFacts = {
  company_name: "RedBeast Energy", contact_email: "pier@redbeast.co.uk", location_text: "2 Savoy Place London WC2R 0BL",
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4, task: "Stand build" }],
};

function rig() {
  let calls = 0;
  const reasoner: Reasoner = {
    async classifyAndExtract() {
      calls++;
      return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS } as ClassifyResult & { facts: ConversationFacts };
    },
    async classify(): Promise<ClassifyResult> { calls++; return { classification: "new-job", priority: "high", job_summary: "x" }; },
    async extractFacts() { calls++; return FACTS; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  const onsinch = new OnsinchClient(mockTransport);
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  };
  return { deps, calls: () => calls };
}

const ask = "Please book 4 crew on 9 March at 2 Savoy Place London WC2R 0BL. RedBeast Energy";

async function main() {
  console.log("\n[1] a colleague's forward, delivered twice");
  {
    const { deps, calls } = rig();
    const fwd = msg({
      message_id: "f1", date_iso: "2026-03-01T09:00:00Z", from: "tracy@spartancrew.co.uk", is_from_spartan: true, subject: "Fwd: Crew",
      body: `FYI\n---------- Forwarded message ---------\nFrom: Pier <pier@redbeast.co.uk>\nDate: Sun, 1 Mar 2026 at 08:00\nSubject: Crew\nTo: tracy@spartancrew.co.uk\n\n${ask}`,
    });
    const s = await handleThread({ thread_id: "t-f", messages: [fwd] }, deps);
    const after = calls();
    ok(s.last_message_id === "f1:quoted", "the forwarded client message is what was read", String(s.last_message_id));
    await handleThread({ thread_id: "t-f", messages: [fwd] }, deps);
    ok(calls() === after, "the second delivery runs no model", `${after} -> ${calls()}`);
  }

  console.log("\n[2] a newest message with an empty body, delivered twice");
  {
    const { deps, calls } = rig();
    const thread = { thread_id: "t-e", messages: [
      msg({ message_id: "e1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: ask }),
      msg({ message_id: "e2", date_iso: "2026-03-01T09:05:00Z", subject: "Re: Crew", body: "" }),
    ] };
    await handleThread(thread, deps);
    const after = calls();
    await handleThread(thread, deps);
    ok(calls() === after, "the second delivery runs no model", `${after} -> ${calls()}`);
  }

  console.log("\n[3] a genuinely new message still runs");
  {
    const { deps, calls } = rig();
    const first = msg({ message_id: "n1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: ask });
    await handleThread({ thread_id: "t-n", messages: [first] }, deps);
    const after = calls();
    await handleThread({ thread_id: "t-n", messages: [first, msg({ message_id: "n2", date_iso: "2026-03-02T09:00:00Z", subject: "Re: Crew", body: "Can we make it 5 crew?" })] }, deps);
    ok(calls() > after, "the model reads the new email", `${after} -> ${calls()}`);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
