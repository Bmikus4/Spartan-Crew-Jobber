// ============================================================================
// A client's change that never reached OnSinch is tagged by the nightly sweep.
// ----------------------------------------------------------------------------
// Audit S8: a thread asking for 9 crew on an order holding 6, every write silently
// discarded, and the sweep reported `holds` — its attendance read cannot see an unstaffed
// block. Ben, 2026-10-01: tag it in Gmail from the block read, "if it wasn't updated
// already in OnSinch". Measured on 44 future orders: 13 differ from their thread, 12 of
// them because ops changed the blocks by hand (OnSinch records who: 102, 110, 413, ...).
// So a difference is only the engine's to report when no person has edited a block; it
// is compared as total crew per time window, so a chief inside the shift and a chief in
// its own block read the same.
//
// Offline.  npx tsx test/unappliedChangeIsTagged.ts
// ============================================================================
import { reconcileThread, unappliedDifference } from "../app/lib/engine/sweep";
import { nestedShape } from "../app/lib/engine/reconcile";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { PipelineDeps } from "../app/lib/engine/pipeline";
import type { ConversationState, DesiredSlotTeam } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const API = 2257, OPS = 413, ORDER = 16326, DAY = "2026-11-04", TODAY = "2026-10-01";
const want = (size: number, b = "07:30", e = "11:30"): DesiredSlotTeam =>
  ({ name: "Power runs", size, profession_id: 1, place_id: 1643, beginning: `${DAY}T${b}:00+00:00`, end: `${DAY}T${e}:00+00:00` }) as DesiredSlotTeam;
const liveOrder = (size: number, modifier: number, b = "07:30", e = "11:30") => ({
  id: ORDER, company_id: 146, happening: `${DAY}T${b}:00+00:00`,
  Job: [{ id: 5326, min_beginning: `${DAY}T${b}:00+00:00`, max_end: `${DAY}T${e}:00+00:00`, SlotTeam: [{ id: 41761, name: "Power runs", modifier, Slot: [
    { id: 1, size, role: 0, cancelled: false, profession_id: 1, beginning: `${DAY}T${b}:00+00:00`, end: `${DAY}T${e}:00+00:00` },
  ] }] }],
});

function rig(order: any) {
  const tags: Array<{ label: string; state: string }> = [];
  const onsinch = new OnsinchClient(async (method, path) => {
    const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/users/profile")) return { status: 200, data: { data: { id: API } } };
    if (path.startsWith("/orders")) return page([order]);
    return page([]);
  });
  const saved: any[] = [];
  const deps = {
    onsinch, now: () => 1,
    store: { get: async () => undefined, put: async (s: any) => { saved.push(structuredClone(s)); }, all: async () => [] },
    executor: { async patchOrder() { return []; }, async amendOrderInPlace() { return { declined: "test" }; } },
    flagForManual: async (t: any) => { tags.push({ label: t.label, state: t.state }); },
  } as unknown as PipelineDeps;
  return { deps, tags, saved };
}
const state = (size: number) => ({
  thread_id: "t-s8", status: "ordered", classification: "update", needs_human: false, notes: [], order_action_log: [],
  onsinch_order_id: ORDER, place_id: 1643,
  desired_order: { company_id: 146, place_id: 1643, slot_teams: [want(size)] },
}) as unknown as ConversationState;

async function main() {
  console.log("\n[1] the rule");
  {
    const n = (size: number, mod: number) => nestedShape(liveOrder(size, mod));
    ok(!!unappliedDifference([want(9)], n(6, API), API), "the client asked 9, OnSinch holds 6, nobody edited it: report");
    ok(unappliedDifference([want(9)], n(6, OPS), API) === null, "a person edited the block: theirs to own, not reported");
    ok(unappliedDifference([want(6)], n(6, API), API) === null, "OnSinch already holds it: nothing to report");
    ok(unappliedDifference([want(9)], n(6, API), null) === null, "no idea who the engine is: never report");
    ok(unappliedDifference([want(3, "07:30", "11:30"), { ...want(1), name: "Crew Chief" }], n(4, API), API) === null,
      "a chief in its own block and a chief inside the shift are the same 4 crew");
  }

  console.log("\n[2] the nightly sweep tags it");
  {
    const r = rig(liveOrder(6, API));
    const out = await reconcileThread(state(9), r.deps, { todayISO: TODAY });
    ok(out.action === "unapplied", "not reported as holding", `${out.action}: ${out.detail ?? ""}`);
    ok(r.tags.some((t) => t.label === "Order Needs Updated" && t.state === "manual"), "and the thread is tagged Order Needs Updated", JSON.stringify(r.tags));
  }

  console.log("\n[3] ops changed it by hand: the sweep leaves it");
  {
    const r = rig(liveOrder(6, OPS));
    const out = await reconcileThread(state(9), r.deps, { todayISO: TODAY });
    ok(out.action !== "unapplied" && !r.tags.some((t) => t.state === "manual"), "no tag", `${out.action} ${JSON.stringify(r.tags)}`);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
