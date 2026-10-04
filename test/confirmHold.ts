// ============================================================================
// SP-14: confirming a staged order respects the hold that staged it.
// ----------------------------------------------------------------------------
// confirmOrder ran the executor on any pending order, so a cancellation hold, which the
// engine must never write, was written by one click on the confirm queue, and a write that
// failed during a confirm reported nothing. Offline: in-memory store, fake executor.
//
// Offline.  npx tsx test/confirmHold.ts
// ============================================================================
import { confirmOrder, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { DEFAULT_SETTINGS, type ConversationState, type DesiredOrder } from "../app/lib/engine/types";
import { mockTransport } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const desired = (size: number) => ({
  name: "RedBeast @ Savoy Place", company_id: 42, place_id: 88, pricelist_category_id: 197,
  slot_teams: [{ name: "Crew", profession_id: 1, place_id: 88, size, beginning: "2026-03-09T08:00:00+00:00", end: "2026-03-09T16:00:00+00:00" }],
}) as unknown as DesiredOrder;

function rig(state: ConversationState, executor: Partial<Executor>) {
  const store = new InMemoryStore();
  const calls: string[] = [];
  const reports: string[] = [];
  const full: Executor = {
    async createReplyDraft() { return "d"; },
    async createOrder() { calls.push("create"); throw new Error("not expected"); },
    async patchOrder() { calls.push("patch"); return []; },
    ...executor,
  } as Executor;
  const deps = {
    store, metrics: new InMemoryMetrics(), executor: full, onsinch: new OnsinchClient(mockTransport), now: () => 1,
    settings: { ...DEFAULT_SETTINGS }, hashOrder: (o: unknown) => JSON.stringify(o).length.toString(),
    report: async (a: { route: string }) => { reports.push(a.route); return false; },
  } as unknown as PipelineDeps;
  return { deps, store, calls, reports, ready: () => store.put(state) };
}

async function main() {
  console.log("\n[1] a cancellation hold is refused, nothing written");
  {
    const s = { thread_id: "t-c", status: "proposed", cancellation: true, notes: [], order_action_log: [],
      onsinch_order_id: 9001, pending_order: { kind: "patch", desired: desired(4), order_id: 9001 } } as unknown as ConversationState;
    const r = rig(s, { async createOrder() { r.calls.push("create"); return { id: 1 } as any; } });
    await r.ready();
    const out = await confirmOrder("t-c", r.deps);
    ok(r.calls.length === 0, "the executor was never called", r.calls.join(","));
    ok((out?.notes ?? []).some((n) => /confirm refused: the client is cancelling/.test(n)), "and the reason is on the thread");
  }

  console.log("\n[2] an empty staged order is refused");
  {
    const s = { thread_id: "t-e", status: "proposed", notes: [], order_action_log: [], pending_order: { kind: "create", desired: desired(0) } } as unknown as ConversationState;
    const r = rig(s, {});
    await r.ready();
    await confirmOrder("t-e", r.deps);
    ok(r.calls.length === 0, "nothing written", r.calls.join(","));
  }

  console.log("\n[3] a confirm whose write fails reports it once");
  {
    const s = { thread_id: "t-f", status: "proposed", notes: [], order_action_log: [], company_id: 42, place_id: 88,
      pending_order: { kind: "create", desired: desired(4) } } as unknown as ConversationState;
    const r = rig(s, { async createOrder() { r.calls.push("create"); throw new Error("createOrder 500: Server Error"); } });
    await r.ready();
    await confirmOrder("t-f", r.deps);
    ok(r.calls.includes("create"), "the write was attempted", r.calls.join(","));
    ok(r.reports.filter((x) => x === "booking-lost").length === 1, "and exactly one booking-lost report", r.reports.join(","));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
