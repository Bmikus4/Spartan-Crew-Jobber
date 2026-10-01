// ============================================================================
// The hourly sweep books an email held for a venue-list outage once the list is back.
// ----------------------------------------------------------------------------
// The held-email fix (0327178) re-read a held thread on its next delivery, but nothing
// delivers it again: n8n claims each message once, its 72-hour catch-up included, and the
// sweep read only threads holding an order (workflow CPIRu7CpezvKjU8d, read 2026-10-01).
// So a held first enquiry waited for the client to write again.
//
// Offline.  npx tsx test/sweepRetriesHeld.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { retryHeld, MAX_RETRIES_PER_RUN, type RetryIO } from "../app/lib/engine/retryHeld";
import { OnsinchClient, __resetListCache } from "../app/lib/engine/onsinch";
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
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "16:00", size: 4, task: "load/unload" }],
};
const book = msg({ message_id: "v1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Please book 4 crew on 9 March 08:00-16:00 at 2 Savoy Place London WC2R 0BL. RedBeast Energy" });

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
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { creates++; return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const store = new InMemoryStore();
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store, metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    flagForManual: async () => {},
  };
  // The stored messages, as thread_messages holds them for rebuildThread.
  const stored = new Map([["t-v", [book]]]);
  let runs = 0, probes = 0;
  const io: RetryIO = {
    venueListReadable: async () => { probes++; try { await onsinch.allPlaces(); return true; } catch { return false; } },
    run: async (id) => { runs++; const m = stored.get(id); return m ? handleThread({ thread_id: id, messages: m }, deps) : null; },
  };
  return {
    deps, io, store, calls: () => calls, creates: () => creates, runs: () => runs, probes: () => probes,
    recover: () => { placesDown = false; __resetListCache(); },
  };
}

async function main() {
  console.log("\n[1] while the venue list is still down, a held email is not re-run (no model call)");
  __resetListCache();
  const r = rig();
  const held = await handleThread({ thread_id: "t-v", messages: [book] }, r.deps);
  ok(!!held.retry_pending && r.creates() === 0, "held first", `retry=${held.retry_pending}`);
  const calls = r.calls();
  const down = await retryHeld([held], r.io);
  ok(r.runs() === 0 && r.calls() === calls && /still held/.test(down[0]?.result ?? ""), "one venue-list read, nothing run", JSON.stringify(down));

  console.log("\n[2] once the list is back, the sweep books it, with no new email");
  r.recover();
  const back = await retryHeld([(await r.store.get("t-v"))!], r.io);
  const after = (await r.store.get("t-v"))!;
  ok(r.creates() === 1 && after.status === "ordered" && !after.retry_pending, "booked and no longer held", `${after.status} creates=${r.creates()} ${JSON.stringify(back)}`);
  const again = await retryHeld([after], r.io);
  ok(again.length === 0 && r.creates() === 1, "a booked thread is not retried again");

  console.log("\n[3] nothing held costs nothing");
  {
    const q = rig();
    const out = await retryHeld([], q.io);
    ok(out.length === 0 && q.probes() === 0, "no venue-list read when nothing is held");
  }

  console.log("\n[4] a thread that cannot be rebuilt, or throws, does not stop the others");
  {
    const q = rig(); q.recover();
    const ghost = { thread_id: "t-ghost", retry_pending: "venue-list" } as ConversationState;
    const boom: RetryIO = { ...q.io, run: async (id) => { if (id === "t-boom") throw new Error("model timeout"); return q.io.run(id); } };
    const out = await retryHeld([{ thread_id: "t-boom", retry_pending: "venue-list" } as ConversationState, ghost], boom);
    ok(/failed: model timeout/.test(out[0]?.result ?? "") && /not rebuildable/.test(out[1]?.result ?? ""), "each gets its own outcome", JSON.stringify(out));
  }

  console.log("\n[5] bounded by count and by the route's time");
  {
    const q = rig(); q.recover();
    const many = ["a", "b", "c", "d"].map((id) => ({ thread_id: id, retry_pending: "venue-list" }) as ConversationState);
    const out = await retryHeld(many, q.io);
    ok(out.length === MAX_RETRIES_PER_RUN, `at most ${MAX_RETRIES_PER_RUN} a run`, String(out.length));
    const late = await retryHeld(many, { ...q.io, hasTime: () => false });
    ok(late.every((o) => /deferred/.test(o.result)) && q.runs() === MAX_RETRIES_PER_RUN, "none started past the time budget", JSON.stringify(late));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
