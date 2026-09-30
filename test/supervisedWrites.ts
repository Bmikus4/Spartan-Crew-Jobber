// ============================================================================
// While supervised, every OnSinch write the engine makes is tagged in Gmail.
// ----------------------------------------------------------------------------
// Ben, 2026-09-29: the automation restarts with a supervised first week, a Gmail tag
// on every write (ops rarely open the dashboard). "Order Built" marks the first booking
// and "Order Updated" is posted once per thread, so a second change, or a sweep
// re-assert, reached nobody. The supervised tag is re-applied on EVERY write, for ops to
// remove once checked, and it is read off order_action_log, so a write route added
// later is covered without anyone remembering to tag it.
//
// Offline.  npx tsx test/supervisedWrites.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps, type ThreadTag } from "../app/lib/engine/pipeline";
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
  company_name: "RedBeast Energy",
  contact_email: "pier@redbeast.co.uk",
  location_text: "2 Savoy Place London WC2R 0BL",
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4, task: "Stand build" }],
};
const reasoner: Reasoner = {
  async classifyAndExtract(latest) {
    const po = /PO (\d+)/.exec(latest.body)?.[1];
    const thanks = /^thanks/i.test(latest.body.trim());
    return {
      classification: thanks ? "confirmation-only" : po ? "update" : "new-job", priority: "medium", job_summary: "crew request",
      facts: { ...FACTS, ...(po ? { customer_reference: po } : {}) },
    } as ClassifyResult & { facts: ConversationFacts };
  },
  async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "medium", job_summary: "x" }; },
  async extractFacts() { return FACTS; },
  async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
};

function rig() {
  const onsinch = new OnsinchClient(mockTransport);
  const tags: ThreadTag[] = [];
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return ["intern_name"]; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(),
    now: () => ++clock, settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    flagSupervised: async (t) => { tags.push(t); },
  };
  return { deps, tags };
}

const m1 = msg({ message_id: "w1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Please book 4 crew on 9 March at 2 Savoy Place London WC2R 0BL. RedBeast Energy" });
const m2 = msg({ message_id: "w2", date_iso: "2026-03-02T09:00:00Z", subject: "Re: Crew", body: "Thanks, see you then" });
const m3 = msg({ message_id: "w3", date_iso: "2026-03-03T09:00:00Z", subject: "Re: Crew", body: "Our PO 5521 for this one." });

async function main() {
  process.env.SPARTAN_SUPERVISED = "1";
  const { deps, tags } = rig();

  console.log("\n[1] the create is tagged");
  await handleThread({ thread_id: "t-sup", messages: [m1] }, deps);
  ok(tags.length === 1, "one tag", JSON.stringify(tags.map((t) => t.reason)));
  ok(tags[0]?.label === "Check Engine Write" && /created/.test(tags[0]?.reason ?? ""), "naming the write", tags[0]?.reason);

  console.log("\n[2] an email that writes nothing is not");
  await handleThread({ thread_id: "t-sup", messages: [m1, m2] }, deps);
  ok(tags.length === 1, "still one tag", String(tags.length));

  console.log("\n[3] the next write is tagged again, not just the first");
  await handleThread({ thread_id: "t-sup", messages: [m1, m2, m3] }, deps);
  ok(tags.length === 2, "a second tag", JSON.stringify(tags.map((t) => t.reason)));
  ok(/changed/.test(tags[1]?.reason ?? ""), "naming the change", tags[1]?.reason);

  console.log("\n[4] with supervision off, nothing is tagged");
  delete process.env.SPARTAN_SUPERVISED;
  const off = rig();
  await handleThread({ thread_id: "t-unsup", messages: [m1] }, off.deps);
  ok(off.tags.length === 0, "no tag", String(off.tags.length));

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
