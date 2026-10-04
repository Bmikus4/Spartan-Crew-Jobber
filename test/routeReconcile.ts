// ============================================================================
// SP-50: the /api/reconcile handler, dry and live, against an in-memory store.
// ----------------------------------------------------------------------------
// The sweep engine had tests; the route that drives it (ticketing, stamping, the held
// retry, expiry, and the dry run's promise to write nothing) had none. Same fixture both
// ways: a bound thread whose order has been deleted.
//
// Offline.  npx tsx test/routeReconcile.ts
// ============================================================================
import { runReconcile, type ReconcileIO, type SweepStore } from "../app/lib/routes/reconcile";
import { __resetApiUser } from "../app/lib/engine/sweep";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { PipelineDeps } from "../app/lib/engine/pipeline";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NOW = Date.parse("2026-09-14T09:00:00Z");
const DAY = "2026-09-20";
const bound = (): ConversationState => ({
  thread_id: "T-route", subject: "Re: Crew", status: "ordered", classification: "update", needs_human: false, notes: [],
  order_action_log: [{ ts: 0, kind: "create", order_id: 15998, ok: true }],
  company_id: 42, place_id: 16689, onsinch_order_id: 15998, onsinch_order_number: "10998", built_flagged: true,
  desired_order: { company_id: 42, slot_teams: [{ name: "General", size: 4, profession_id: 1, place_id: 16689, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00` }] },
  facts: { requests: [{ date: DAY, start_time: "09:30", end_time: "14:00", size: 4 }], location_text: "HQ" },
}) as unknown as ConversationState;

function rig() {
  __resetApiUser();
  const writes: string[] = [];
  const rows = new Map<string, ConversationState>([["T-route", bound()]]);
  const store: SweepStore = {
    async get(id) { return rows.get(id); },
    async put(s) { writes.push(`put ${s.thread_id}`); rows.set(s.thread_id, s); },
    async all() { return [...rows.values()]; },
    async forSweep() { return [...rows.values()].filter((s) => Number(s.onsinch_order_id) > 0).map((s) => structuredClone(s)); },
    async markSwept(ids) { writes.push(`markSwept ${ids.join(",")}`); },
    async heldForRetry() { return []; },
    async flaggedOldestFirst() { return []; },
    async sweepStats() { return { bound: 1, never_swept: 0 }; },
  };
  const other = { id: 16011, number: "11011", happening: "2026-12-01T09:30:00+00:00", name: "Elsewhere", Job: [{ id: 16071 }] };
  const onsinch = new OnsinchClient(async (method, path) => {
    if (method !== "GET") { writes.push(`onsinch ${method}`); return { status: 204, data: null }; }
    const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
    if (path.startsWith("/users/profile")) return { status: 200 as const, data: { data: { id: 2257 } } };
    if (path.startsWith("/orders")) return page(/[?&]id(?:\[eq\])?=\d+/.test(path) ? [] : [other]);
    return page([]);
  });
  const deps = {
    onsinch, now: () => NOW, store,
    executor: { async patchOrder() { writes.push("patch"); return []; } },
    flagForManual: async (t: any) => { writes.push(`label ${t.label} ${t.state}`); },
    flagOrderBuilt: async (t: any) => { writes.push(`label ${t.label} ${t.state}`); },
  } as unknown as PipelineDeps;
  const io: ReconcileIO = {
    store: () => store,
    buildDeps: async () => deps,
    rebuildThread: async () => null,
    upsertTicket: async (s) => { writes.push(`ticket ${s.thread_id}`); },
    report: (async () => false) as ReconcileIO["report"],
    now: () => NOW,
  };
  return { io, writes };
}

async function main() {
  console.log("\n[1] dry: reports what a live run would do, writes nothing anywhere");
  {
    const r = rig();
    const res = await runReconcile(new Request("http://x/api/reconcile?dry=1", { method: "POST" }), true, r.io);
    const body = await res.json() as any;
    ok(body.ok === true && body.dry === true && body.tally?.lost === 1, "the deleted order is reported lost", JSON.stringify(body.tally));
    ok(r.writes.length === 0, "and nothing was written: no store, no label, no ticket, no stamp", r.writes.join(" | "));
  }

  console.log("\n[2] live: the same thread is labelled, ticketed and stamped");
  {
    const r = rig();
    const res = await runReconcile(new Request("http://x/api/reconcile", { method: "POST" }), false, r.io);
    const body = await res.json() as any;
    ok(body.tally?.lost === 1, "lost", JSON.stringify(body.tally));
    ok(r.writes.includes("label Order Needs Built manual") && r.writes.includes("label Order Built cleared"), "labels moved", r.writes.join(" | "));
    ok(r.writes.filter((w) => w === "ticket T-route").length === 1, "one ticket upsert", r.writes.join(" | "));
    ok(r.writes.includes("markSwept T-route"), "and the thread stamped as swept");
    ok(!r.writes.some((w) => w.startsWith("onsinch")), "with no OnSinch write");
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
