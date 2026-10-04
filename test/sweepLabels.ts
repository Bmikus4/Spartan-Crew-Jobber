// ============================================================================
// SP-08 + SP-09: every sweep outcome that needs a person puts a label on the thread.
// ----------------------------------------------------------------------------
// cannotBeBooked() returned false for any thread not classified new-job or update, so a
// confirmation-only thread whose order was deleted kept "Order Built" and got no Needs
// label: it looked booked in Gmail with no booking behind it. The two unactionable
// branches and unreconciled called no flag at all. Now the sweep raises `attention` on
// lost / unapplied / unactionable / unreconciled, which labels the thread whatever its
// classification, and holds / rebound / staff-changed settle it so the label comes off.
//
// Offline.  npx tsx test/sweepLabels.ts
// ============================================================================
import { reconcileThread, __resetApiUser } from "../app/lib/engine/sweep";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { cannotBeBooked, type PipelineDeps } from "../app/lib/engine/pipeline";
import type { ConversationState, DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const TODAY = "2026-09-14T09:00:00Z";
const DAY = "2026-09-20";
const ORDER = 15998;
const TEAM = 40988;

const desired = (): DesiredOrder =>
  ({
    company_id: 42, pricelist_category_id: 197,
    slot_teams: [{ name: "General", size: 4, profession_id: 1, place_id: 16689, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00` }],
  }) as unknown as DesiredOrder;

const bound = (over: Partial<ConversationState> = {}): ConversationState =>
  ({
    thread_id: "T-labels", subject: "Re: Crew for the 20th", status: "ordered", needs_human: false, notes: [],
    order_action_log: [{ ts: 0, kind: "create", order_id: ORDER, ok: true }],
    company_id: 42, place_id: 16689, onsinch_order_id: ORDER, onsinch_order_number: "10998", onsinch_job_id: 16055,
    desired_order: desired(), last_ordered_teams: desired().slot_teams, last_ordered_team_ids: [TEAM],
    facts: { requests: [{ date: DAY, start_time: "09:30", end_time: "14:00", size: 4 }], location_text: "HQ" },
    built_flagged: true,
    ...over,
  }) as unknown as ConversationState;

const LIVE_ORDER = {
  id: ORDER, number: "10998", happening: `${DAY}T09:30:00+00:00`,
  Job: [{ id: 16055, min_beginning: `${DAY}T09:30:00+00:00`, max_end: `${DAY}T14:00:00+00:00` }],
};
const HELD = { size: 4, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00`, slotlocation_id: 16689, profession_id: 1 };

type Tag = { label: string; state: string };
function rig(opts: { orders: any[]; slot?: typeof HELD }) {
  __resetApiUser();
  const onsinch = new OnsinchClient(async (method, path) => {
    const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/users/profile")) return { status: 200 as const, data: { data: { id: 2257 } } };
    if (path.startsWith("/orders")) {
      const m = /[?&]id(?:\[eq\])?=(\d+)/.exec(path);
      return page(m ? opts.orders.filter((o) => Number(o.id) === Number(m[1])) : opts.orders);
    }
    if (path.startsWith("/attendance")) {
      if (!opts.slot) return page([]);
      return page([{ Slot: [{ slotteam_id: TEAM, ...opts.slot, name: "" }], SlotTeam: [{ id: TEAM, name: "General" }] }]);
    }
    return page([]);
  });
  const manual: Tag[] = [];
  const built: Tag[] = [];
  const deps = {
    onsinch, now: () => 1,
    store: { get: async () => undefined, put: async () => {}, all: async () => [] },
    executor: { async patchOrder() { return []; }, async amendOrderInPlace() { return { declined: "no block could be paired" }; } },
    flagForManual: async (t: any) => { manual.push({ label: t.label, state: t.state }); },
    flagOrderBuilt: async (t: any) => { built.push({ label: t.label, state: t.state }); },
  } as unknown as PipelineDeps;
  return { deps, manual, built };
}

(async () => {
  console.log("\n[1] SP-08: a confirmation-only thread whose order is gone");
  {
    const other = { id: 16011, number: "11011", happening: "2026-12-01T09:30:00+00:00", name: "Elsewhere", Job: [{ id: 16071 }] };
    const r = rig({ orders: [other] });
    const s = bound({ classification: "confirmation-only" as any });
    const out = await reconcileThread(s, r.deps, { todayISO: TODAY });
    ok(out.action === "lost", "reported as lost", out.action);
    ok(r.manual.length === 1 && r.manual[0].label === "Order Needs Built" && r.manual[0].state === "manual",
      "one Order Needs Built goes on", JSON.stringify(r.manual));
    ok(r.built.length === 1 && r.built[0].state === "cleared", "one Order Built comes off", JSON.stringify(r.built));
    ok(s.built_flagged === false && s.manual_flagged === true, "and the markers say so",
      `built=${s.built_flagged} manual=${s.manual_flagged}`);
    ok(s.attention?.kind === "lost" && cannotBeBooked(s), "the thread now cannot be booked, whatever its classification");
  }

  console.log("\n[2] SP-09: each needs-a-person outcome posts exactly one label");
  {
    // unactionable, no lever: a window difference and no record of which blocks are ours.
    const NARROW = { ...LIVE_ORDER, Job: [{ id: 16055, min_beginning: `${DAY}T09:30:00+00:00`, max_end: `${DAY}T11:00:00+00:00` }] };
    const a = rig({ orders: [NARROW] });
    const sa = bound({ classification: "confirmation-only" as any, last_ordered_teams: undefined, last_ordered_team_ids: undefined });
    const oa = await reconcileThread(sa, a.deps, { todayISO: TODAY });
    ok(oa.action === "unactionable" && a.manual.length === 1 && a.manual[0].label === "Order Needs Updated",
      "unactionable (no lever): one Order Needs Updated", `${oa.action} ${JSON.stringify(a.manual)}`);

    // unactionable, the amendment declined every block and no field was sent.
    const b = rig({ orders: [LIVE_ORDER], slot: { ...HELD, size: 2 } });
    const sb = bound({ classification: "confirmation-only" as any });
    const ob = await reconcileThread(sb, b.deps, { todayISO: TODAY });
    ok(ob.action === "unactionable" && b.manual.length === 1, "unactionable (nothing sent): one label", `${ob.action} ${JSON.stringify(b.manual)}`);

    // unreconciled: past the ceiling.
    const c = rig({ orders: [LIVE_ORDER], slot: { ...HELD, size: 2 } });
    (c.deps as any).executor.amendOrderInPlace = async (p: any) => ({ amended: { order_id: p.order_id, patched: 1, added: [], job_id: 16055 } });
    const sc = bound({ classification: "confirmation-only" as any });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) seen.push((await reconcileThread(sc, c.deps, { todayISO: TODAY })).action);
    ok(seen[3] === "unreconciled" && c.manual.length === 1, "unreconciled: one label, on the pass that gives up",
      `${seen.join(",")} ${JSON.stringify(c.manual)}`);
  }

  console.log("\n[3] the order holds again: the label comes off and needs_human is given back");
  {
    const NARROW = { ...LIVE_ORDER, Job: [{ id: 16055, min_beginning: `${DAY}T09:30:00+00:00`, max_end: `${DAY}T11:00:00+00:00` }] };
    const a = rig({ orders: [NARROW] });
    const s = bound({ classification: "confirmation-only" as any, last_ordered_teams: undefined, last_ordered_team_ids: undefined });
    await reconcileThread(s, a.deps, { todayISO: TODAY });
    ok(s.manual_flagged === true && s.needs_human === true, "raised first");
    const h = rig({ orders: [LIVE_ORDER], slot: HELD });
    const out = await reconcileThread(s, h.deps, { todayISO: TODAY });
    ok(out.action === "holds", "then the order holds", out.action);
    ok(h.manual.length === 1 && h.manual[0].state === "cleared", "and the Needs label is cleared", JSON.stringify(h.manual));
    ok(s.attention === undefined && s.needs_human === false && !cannotBeBooked(s), "the thread is bookable again",
      `attention=${JSON.stringify(s.attention)} needs_human=${s.needs_human}`);
  }

  console.log("\n[4] a thread that needed a person before the sweep keeps needing one");
  {
    const NARROW = { ...LIVE_ORDER, Job: [{ id: 16055, min_beginning: `${DAY}T09:30:00+00:00`, max_end: `${DAY}T11:00:00+00:00` }] };
    const a = rig({ orders: [NARROW] });
    const s = bound({ classification: "update" as any, needs_human: true, last_ordered_teams: undefined, last_ordered_team_ids: undefined });
    await reconcileThread(s, a.deps, { todayISO: TODAY });
    await reconcileThread(s, rig({ orders: [LIVE_ORDER], slot: HELD }).deps, { todayISO: TODAY });
    ok(s.attention === undefined && s.needs_human === true, "settling restores needs_human as it was, not false");
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
