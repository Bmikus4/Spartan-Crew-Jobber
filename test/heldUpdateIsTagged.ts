// ============================================================================
// An update the engine will not make is tagged in Gmail.
// ----------------------------------------------------------------------------
// Ben, 2026-09-29: "if an update can't be made, it gets tagged in GMAIL, that's it" —
// ops rarely open the dashboard. A client cancelling reached nobody: the engine never
// cancels (correctly), but the cancellation hold returned before the tag step with
// status `proposed`, and a cancellation that composed an unchanged order read as
// `ordered`. Either way the Gmail label never went on. Found when audit scenario A4 was
// run without the always-true review flag that had been covering for it.
//
// Offline.  npx tsx test/heldUpdateIsTagged.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, cannotBeBooked, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts, type ConversationState } from "../app/lib/engine/types";
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
const reasoner: Reasoner = {
  async classifyAndExtract(latest) {
    const cancel = /cancel/i.test(latest.body);
    const fewer = /only 2/i.test(latest.body);
    return {
      classification: cancel || fewer ? "update" : "new-job", priority: "high", job_summary: "crew",
      ...(cancel ? { cancellation: true } : {}),
      facts: fewer ? { ...FACTS, requests: [{ ...FACTS.requests[0], size: 2 }] } : FACTS,
    } as ClassifyResult & { facts: ConversationFacts };
  },
  async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "high", job_summary: "x" }; },
  async extractFacts() { return FACTS; },
  async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
};

function rig() {
  const onsinch = new OnsinchClient(mockTransport);
  const tags: Array<{ label: string; state: string; reason: string }> = [];
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
    flagForManual: async (t: any) => { tags.push({ label: t.label, state: t.state, reason: t.reason }); },
  };
  return { deps, tags };
}
const book = msg({ message_id: "h1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Please book 4 crew on 9 March at 2 Savoy Place London WC2R 0BL. RedBeast Energy" });

async function main() {
  console.log("\n[1] a cancellation that composes the same order is tagged");
  {
    const { deps, tags } = rig();
    await handleThread({ thread_id: "t-c1", messages: [book] }, deps);
    const before = tags.length;
    const s = await handleThread({ thread_id: "t-c1", messages: [book, msg({ message_id: "h2", date_iso: "2026-03-02T09:00:00Z", subject: "Re: Crew", body: "Sorry, we have to cancel this one." })] }, deps);
    const t = tags.slice(before).find((x) => x.state === "manual");
    ok(s.cancellation === true, "read as a cancellation");
    ok(!!t, "a Needs tag is posted", JSON.stringify(tags));
  }

  console.log("\n[2] a held amendment is tagged");
  {
    const { deps, tags } = rig();
    await handleThread({ thread_id: "t-c2", messages: [book] }, deps);
    const before = tags.length;
    const s = await handleThread({ thread_id: "t-c2", messages: [book, msg({ message_id: "h3", date_iso: "2026-03-02T09:00:00Z", subject: "Re: Crew", body: "Please cancel, we only 2 now" })] }, deps);
    ok(s.status === "proposed", "the write is held", s.status);
    ok(tags.slice(before).some((x) => x.state === "manual"), "and a Needs tag is posted", JSON.stringify(tags.slice(before)));
  }

  console.log("\n[3] an ordinary booking is not");
  {
    const { deps, tags } = rig();
    await handleThread({ thread_id: "t-c3", messages: [book] }, deps);
    ok(!tags.some((x) => x.state === "manual"), "no Needs tag on a clean booking", JSON.stringify(tags));
  }

  console.log("\n[4] the rule itself");
  {
    const base = { classification: "update", status: "ordered", needs_human: false } as unknown as ConversationState;
    ok(cannotBeBooked({ ...base, cancellation: true, onsinch_order_id: 9001 }) === true, "cancelling a booking always needs a person");
    ok(cannotBeBooked({ ...base, cancellation: true }) === false, "an enquiry called off before any order has nothing to undo");
    ok(cannotBeBooked({ ...base, status: "proposed", pending_order: { kind: "patch" } as never }) === true, "a held write needs a person");
    ok(cannotBeBooked(base) === false, "a booked thread does not");
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
