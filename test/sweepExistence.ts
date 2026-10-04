// ============================================================================
// SP-07: every future-dated bound thread gets its existence read.
// ----------------------------------------------------------------------------
// "no desired shape on the thread" and "already unreconciled" returned before the order
// was read, so a deleted order on such a thread was never found: it stayed claimed and
// wore "Order Built". 8 such threads were found by hand on 10-03. They now get the
// existence read and its positive control, and stop before any correction. Past-dated
// threads stay free.
//
// Offline.  npx tsx test/sweepExistence.ts
// ============================================================================
import { reconcileThread, sweepAll, __resetApiUser } from "../app/lib/engine/sweep";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { PipelineDeps } from "../app/lib/engine/pipeline";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const TODAY = "2026-09-14T09:00:00Z";
const DAY = "2026-09-20";
const ORDER = 15998;
const OTHER = { id: 16011, number: "11011", happening: "2026-12-01T09:30:00+00:00", name: "Elsewhere", Job: [{ id: 16071 }] };
const LIVE = { id: ORDER, number: "10998", happening: `${DAY}T09:30:00+00:00`, Job: [{ id: 16055 }] };
const TEAM = { name: "General", size: 4, profession_id: 1, place_id: 16689, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00` };

const bound = (over: Partial<ConversationState> = {}): ConversationState =>
  ({
    thread_id: "T-exist", subject: "Re: Crew", status: "ordered", classification: "update", needs_human: false, notes: [],
    order_action_log: [{ ts: 0, kind: "create", order_id: ORDER, ok: true }],
    company_id: 42, place_id: 16689, onsinch_order_id: ORDER, onsinch_order_number: "10998", built_flagged: true,
    facts: { requests: [{ date: DAY, start_time: "09:30", end_time: "14:00", size: 4 }], location_text: "HQ" },
    ...over,
  }) as unknown as ConversationState;

function rig(orders: any[]) {
  __resetApiUser();
  let reads = 0;
  const onsinch = new OnsinchClient(async (method, path) => {
    reads++;
    const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/users/profile")) return { status: 200 as const, data: { data: { id: 2257 } } };
    if (path.startsWith("/orders")) {
      const m = /[?&]id(?:\[eq\])?=(\d+)/.exec(path);
      return page(m ? orders.filter((o) => Number(o.id) === Number(m[1])) : orders);
    }
    return page([]);
  });
  const deps = {
    onsinch, now: () => 1,
    store: { get: async () => undefined, put: async () => {}, all: async () => [] },
    executor: {
      async patchOrder() { throw new Error("no correction may run on an existence-only thread"); },
      async amendOrderInPlace() { throw new Error("no correction may run on an existence-only thread"); },
    },
    flagForManual: async () => {}, flagOrderBuilt: async () => {},
  } as unknown as PipelineDeps;
  return { deps, reads: () => reads };
}

(async () => {
  console.log("\n[1] no desired shape, order gone, client list populated: lost");
  {
    const r = rig([OTHER]);
    const s = bound();
    const out = await reconcileThread(s, r.deps, { todayISO: TODAY });
    ok(out.action === "lost", "found and declared lost", `${out.action} ${out.detail ?? ""}`);
    ok(s.onsinch_order_id === undefined, "the thread stops claiming it");
  }

  console.log("\n[2] past the re-assert ceiling, order gone: lost");
  {
    const r = rig([OTHER]);
    const s = bound({ desired_order: { company_id: 42, slot_teams: [TEAM] } as any, reconcile: { order_id: ORDER, key: "k", attempts: 4, first_ts: 0 } as any });
    const out = await reconcileThread(s, r.deps, { todayISO: TODAY });
    ok(out.action === "lost", "found and declared lost", `${out.action} ${out.detail ?? ""}`);
  }

  console.log("\n[3] existence-only and the order is there: no correction, and it counts against the limit");
  {
    const r = rig([LIVE, OTHER]);
    const s = bound({ desired_order: { company_id: 42, slot_teams: [TEAM] } as any, reconcile: { order_id: ORDER, key: "k", attempts: 4, first_ts: 0 } as any });
    const out = await reconcileThread(s, r.deps, { todayISO: TODAY });
    ok(out.action === "exists", "reported as existing, nothing re-asserted", `${out.action} ${out.detail ?? ""}`);
    const swept = await sweepAll([bound(), bound({ thread_id: "T-2" })], rig([LIVE, OTHER]).deps, { todayISO: TODAY, limit: 1 });
    ok(swept.swept === 1 && swept.outcomes.length === 1, "an existence read spends the limit like any other read",
      `swept=${swept.swept} outcomes=${swept.outcomes.length}`);
  }

  console.log("\n[4] a past-dated thread is still skipped without a read");
  {
    const r = rig([OTHER]);
    const s = bound({ facts: { requests: [{ date: "2026-08-01", start_time: "09:30", end_time: "14:00", size: 4 }] } as any });
    const out = await reconcileThread(s, r.deps, { todayISO: TODAY });
    ok(out.action === "skipped" && /past/.test(out.detail ?? "") && r.reads() === 0, "skipped, zero OnSinch calls",
      `${out.action} ${out.detail} reads=${r.reads()}`);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
