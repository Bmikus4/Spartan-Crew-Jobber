// ============================================================================
// SP-15: an email the engine threw on is read again by the hourly sweep.
// ----------------------------------------------------------------------------
// n8n sends each message once. A throw inside handleThread was reported and the email
// was then lost until the client wrote again. The route now holds the thread with
// retry_pending "engine-threw", the sweep's retryHeld re-runs it, and a thread that keeps
// throwing stops at MAX_ATTEMPTS, still held and labelled.
//
// Offline.  npx tsx test/engineThrewRetry.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleInbound, type InboundIO } from "../app/lib/n8nInbound";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { retryHeld, markThrew, MAX_ATTEMPTS } from "../app/lib/engine/retryHeld";
import { OnsinchClient, __resetListCache } from "../app/lib/engine/onsinch";
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
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "16:00", size: 4, task: "load/unload" }],
};
const book = msg({ message_id: "v1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Please book 4 crew on 9 March 08:00-16:00 at 2 Savoy Place London WC2R 0BL. RedBeast Energy" });

function pipeline(store: InMemoryStore) {
  let creates = 0;
  const reasoner: Reasoner = {
    async classifyAndExtract() { return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS } as ClassifyResult & { facts: ConversationFacts }; },
    async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "high", job_summary: "x" }; },
    async extractFacts() { return FACTS; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  const onsinch = new OnsinchClient(mockTransport);
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { creates++; return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store, metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    flagForManual: async () => {},
  };
  return { deps, creates: () => creates };
}

const post = (body: unknown) => new Request("http://localhost/api/n8n-inbound", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

async function main() {
  const prior = process.env.INTAKE_PATH;
  delete process.env.INTAKE_PATH;
  try {
    console.log("\n[1] the engine throws once: the route holds the thread");
    __resetListCache();
    const store = new InMemoryStore();
    const io: InboundIO = {
      capture: (async () => ({ ok: true, captured: true, dedup_key: "k", thread_id: "t-x", message_id: "v1", messages_stored: 1, new_message_ids: ["v1"] })) as InboundIO["capture"],
      report: (async () => false) as InboundIO["report"],
      decide: (async () => { throw new Error("v2 must not run here"); }) as InboundIO["decide"],
      buildDeps: (async () => ({ settings: {} })) as unknown as InboundIO["buildDeps"],
      handleThread: (async () => { throw new Error("model returned no JSON"); }) as unknown as InboundIO["handleThread"],
      upsertTicket: async () => {},
      onThrew: async (thread, err) => { await markThrew(store, { thread_id: thread.thread_id, subject: thread.messages[0]?.subject }, err); },
    };
    const res = await handleInbound(post({ thread_id: "t-x", messages: [book] }), io);
    const held = await store.get("t-x");
    ok(res.status === 500, "the route still answers 500", String(res.status));
    ok(held?.retry_pending === "engine-threw" && held.retry_attempts === 1 && held.needs_human === true,
      "and the thread is held for the sweep", JSON.stringify({ r: held?.retry_pending, a: held?.retry_attempts }));

    console.log("\n[2] the next sweep re-runs it and it books");
    const p = pipeline(store);
    const out = await retryHeld([held!], { listsReadable: async () => true, run: (id) => handleThread({ thread_id: id, messages: [book] }, p.deps) });
    const after = await store.get("t-x");
    ok(p.creates() === 1 && Number(after?.onsinch_order_id) > 0, "an order exists", `${JSON.stringify(out)} creates=${p.creates()}`);
    ok(!after?.retry_pending, "and the thread is no longer held");

    console.log("\n[3] a thread that keeps throwing stops at MAX_ATTEMPTS, still held");
    const s2 = new InMemoryStore();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await markThrew(s2, { thread_id: "t-y" }, new Error("boom"));
    const stuck = (await s2.get("t-y"))!;
    let reran = 0;
    const out2 = await retryHeld([stuck], { listsReadable: async () => true, run: async () => { reran++; return null; } });
    ok(stuck.retry_attempts === MAX_ATTEMPTS && out2.length === 0 && reran === 0, "not re-run again",
      `attempts=${stuck.retry_attempts} outcomes=${out2.length}`);
    ok(stuck.retry_pending === "engine-threw" && stuck.needs_human === true, "and still held for a person");
  } finally {
    if (prior === undefined) delete process.env.INTAKE_PATH; else process.env.INTAKE_PATH = prior;
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
