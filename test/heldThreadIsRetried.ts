// ============================================================================
// A thread held because the venue list could not be read is read again on its next
// delivery; an order the sweep finds deleted is tagged.
// ----------------------------------------------------------------------------
// Verified 2026-10-01 against the release note "held and tagged until the list can be
// read": nothing retried. The same email delivered again after the list recovered was
// skipped as already read (the idempotency fast path), so only the client's NEXT email
// could book it. And an order the nightly sweep found deleted got a note but no Gmail
// tag, although ops work from the labels.
//
// Offline.  npx tsx test/heldThreadIsRetried.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { reconcileThread } from "../app/lib/engine/sweep";
import { OnsinchClient, __resetListCache } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts, type ConversationState, type DesiredOrder } from "../app/lib/engine/types";
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

function rig() {
  let calls = 0, creates = 0, placesDown = true;
  const reasoner: Reasoner = {
    async classifyAndExtract() { calls++; return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS } as ClassifyResult & { facts: ConversationFacts }; },
    async classify(): Promise<ClassifyResult> { calls++; return { classification: "new-job", priority: "high", job_summary: "x" }; },
    async extractFacts() { calls++; return FACTS; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  const onsinch = new OnsinchClient(async (method, path, body) => {
    if (placesDown && method === "GET" && path.startsWith("/places")) throw new Error("places read timed out");
    return mockTransport(method, path, body);
  });
  const tags: Array<{ label: string; state: string }> = [];
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { creates++; return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    flagForManual: async (t: any) => { tags.push({ label: t.label, state: t.state }); },
  };
  return { deps, tags, calls: () => calls, creates: () => creates, recover: () => { placesDown = false; __resetListCache(); } };
}
const book = msg({ message_id: "v1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Please book 4 crew on 9 March 08:00-16:00 at 2 Savoy Place London WC2R 0BL. RedBeast Energy" });

async function main() {
  console.log("\n[1] held while the venue list is down, booked when the same email comes again");
  {
    __resetListCache();
    const r = rig();
    const s1 = await handleThread({ thread_id: "t-v", messages: [book] }, r.deps);
    ok(r.creates() === 0 && !!s1.retry_pending && r.tags.some((t) => t.state === "manual"), "held, tagged, and marked to be read again", `${s1.status} retry=${s1.retry_pending}`);
    r.recover();
    const s2 = await handleThread({ thread_id: "t-v", messages: [book] }, r.deps);
    ok(r.creates() === 1 && s2.status === "ordered" && !s2.retry_pending, "the redelivered email is booked", `${s2.status} creates=${r.creates()} retry=${s2.retry_pending}`);
    const calls = r.calls();
    await handleThread({ thread_id: "t-v", messages: [book] }, r.deps);
    ok(r.calls() === calls && r.creates() === 1, "and once booked it is read once, not again and again", `${calls} -> ${r.calls()}`);
  }

  console.log("\n[2] an order the sweep finds deleted is tagged Order Needs Built");
  {
    const tags: Array<{ label: string; state: string }> = [];
    const other = { id: 16011, number: "11011", happening: "2026-12-01T09:30:00+00:00", company_id: 42, Job: [{ id: 16071 }] };
    const onsinch = new OnsinchClient(async (method, path) => {
      const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
      if (method !== "GET") return { status: 204, data: null };
      if (path.startsWith("/orders")) { const m = /[?&]id(?:\[eq\])?=(\d+)/.exec(path); return page(m ? [other].filter((o) => o.id === Number(m[1])) : [other]); }
      return page([]);
    });
    const deps = {
      onsinch, now: () => 1, store: { get: async () => undefined, put: async () => {}, all: async () => [] },
      executor: { async patchOrder() { return []; } },
      flagForManual: async (t: any) => { tags.push({ label: t.label, state: t.state }); },
    } as unknown as PipelineDeps;
    const desired = { company_id: 42, pricelist_category_id: 197, slot_teams: [{ name: "General", size: 4, profession_id: 1, place_id: 16689, beginning: "2026-09-20T09:30:00+00:00", end: "2026-09-20T14:00:00+00:00" }] } as unknown as DesiredOrder;
    const s = { thread_id: "T-gone", subject: "Crew", classification: "update", status: "ordered", needs_human: false, notes: [], order_action_log: [], company_id: 42, place_id: 16689, onsinch_order_id: 15998, onsinch_order_number: "10998", desired_order: desired, last_ordered_teams: desired.slot_teams } as unknown as ConversationState;
    const out = await reconcileThread(s, deps, { todayISO: "2026-09-14T09:00:00Z" });
    ok(out.action === "lost" && tags.some((t) => t.label === "Order Needs Built" && t.state === "manual"), "lost, and tagged", `${out.action} ${JSON.stringify(tags)}`);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
