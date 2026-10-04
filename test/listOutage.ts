// ============================================================================
// SP-04: a list OnSinch could not serve holds the email; it is never read as empty.
// ----------------------------------------------------------------------------
// With the company list short a page, a known client reads as new and is created
// again; with the client's order list short a page, a live booking reads as absent and
// a second order is created for it. Both reads now hold with retry_pending, nothing is
// written, and the hourly sweep reads the thread again (retryHeld.ts).
//
// Offline.  npx tsx test/listOutage.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
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

function rig(fail: (method: string, path: string) => boolean) {
  let creates = 0;
  const reasoner: Reasoner = {
    async classifyAndExtract() { return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS } as ClassifyResult & { facts: ConversationFacts }; },
    async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "high", job_summary: "x" }; },
    async extractFacts() { return FACTS; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  // OnSinch's transport answers a failure with its status; it does not throw.
  const t: Transport = async (method, path, body) =>
    fail(method, path) ? { status: 500, data: { message: "Server Error" } } : mockTransport(method, path, body);
  const onsinch = new OnsinchClient(t);
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
    flagForManual: async () => {},
  };
  return { deps, creates: () => creates };
}

async function main() {
  console.log("\n[1] the company list fails: held, nothing created");
  {
    __resetListCache();
    const r = rig((m, p) => m === "GET" && p.startsWith("/companies"));
    const s = await handleThread({ thread_id: "t-co", messages: [book] }, r.deps);
    ok(s.retry_pending === "company-list", "held for the company list", String(s.retry_pending));
    ok(r.creates() === 0, "no order created", String(r.creates()));
    ok(s.notes.some((n) => /company list could not be read/.test(n)), "and the note says why");
  }

  console.log("\n[2] the client's order list fails: held, no second order");
  {
    __resetListCache();
    const r = rig((m, p) => m === "GET" && p.startsWith("/orders") && /company_id=/.test(p));
    const s = await handleThread({ thread_id: "t-or", messages: [book] }, r.deps);
    ok(s.retry_pending === "order-list", "held for the order list", String(s.retry_pending));
    ok(r.creates() === 0, "no order created", String(r.creates()));
  }

  console.log("\n[3] control: with every list readable the same email books");
  {
    __resetListCache();
    const r = rig(() => false);
    const s = await handleThread({ thread_id: "t-ok", messages: [book] }, r.deps);
    ok(r.creates() === 1 && !s.retry_pending, "booked", `creates=${r.creates()} retry=${s.retry_pending}`);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
