// ============================================================================
// The simulated browser bot: app/lib/v2/bot/run.ts's runOp, applied to the fake OnSinch.
// ----------------------------------------------------------------------------
// It stands in for the real module in the require cache (run.mts), so process.ts calls this
// runOp with the operations the real planner made. Each operation lands as the browser's save
// lands: on the order, and on the timeline under user 2257. The real bot's ledger rule holds:
// a key once seen is never run again. What it cannot simulate is the browser itself (a form
// that changed, a save that timed out); the Vercel run (scripts/vercel-bot-100.mts) covers that.
// ============================================================================
import { createHash } from "node:crypto";
import { shiftWindow, type Op, type PositionSpec } from "../../app/lib/v2/bot/ops";
import { store, audit } from "./onsinch";
import { clock } from "./pg";

export type RunResult = { op_key: string; status: "verified" | "refused" | "seen" | "busy" | "blocked" | "mismatch" | "unknown"; reasons: string[]; detail?: Record<string, unknown> };
const seen = new Map<string, RunResult>();
export const ran: Array<{ at: string; source: string; op: Op; result: RunResult }> = [];

const key = (source: string, op: Op) => createHash("sha256").update(`${source}\n${op.kind}\n${JSON.stringify(op, Object.keys(op).sort())}`).digest("hex").slice(0, 32);
const slotsOf = (o: any): any[] => ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => [].concat(j.SlotTeam ?? [])).flatMap((t: any) => [].concat(t.Slot ?? []));

function slot(p: PositionSpec, w: { beginning: string; end: string }, place: number | null) {
  return { id: ++store.nextSlot, size: p.size, profession_id: Number(p.profession_id), role: p.role === "crew_chief" ? 1 : 0, beginning: w.beginning, end: w.end, cancelled: false, concept: false, SlotLocation: place ? { place_id: place } : null, created: clock.iso(), creator: 2257 };
}

function placeId(spec: string): number | null {
  if (spec.startsWith("new:")) { const p = { id: 9_000_000 + store.places.length, name: spec.slice(4), address: "" }; store.places.push(p); return p.id; }
  return Number(spec) || null;
}

function apply(op: Op): RunResult["detail"] | string {
  if (op.kind === "create_order") {
    const id = ++store.nextOrder, number = String(++store.nextNumber);
    const order: any = { id, number, company_id: Number(String(op.company_id).replace(/^new:.*/, "0")) || 0, creator: 2257, created: clock.iso(), status: 0, request_approval: 1, name: op.job_name, intern_name: op.po ?? "", specification: op.specification ?? "",
      Job: [{ id: ++store.nextJob, name: op.job_name, SlotTeam: op.shifts.map((s) => { const w = shiftWindow(s.date, s.start, s.end); const place = placeId(s.place_id); return { id: ++store.nextTeam, name: s.name, Slot: s.positions.map((p) => slot(p, w, place)) }; }) }] };
    store.orders.set(id, order);
    audit("order_created_via_api", "Order", number, null);
    for (const s of slotsOf(order).slice(1)) audit("common_create", "Slot", s.id, null);
    return { order_id: id, number };
  }
  const o = store.orders.get(Number((op as any).order_id));
  if (!o || store.deleted.has(Number(o.id))) return `order ${(op as any).order_id} not found`;
  if (op.kind === "set_po") { audit("common_change", "Order", o.number, { Order: { intern_name: { old: o.intern_name, new: op.po } } }); o.intern_name = op.po; return { order_id: o.id, number: o.number }; }
  if (op.kind === "add_shift") {
    const w = shiftWindow(op.date, op.start, op.end);
    const loc = slotsOf(o).find((s) => Number(s.slotlocation_id) === op.location_id)?.SlotLocation?.place_id ?? slotsOf(o)[0]?.SlotLocation?.place_id ?? null;
    const team = { id: ++store.nextTeam, name: op.name, Slot: op.positions.map((p) => slot(p, w, loc)) };
    o.Job[0].SlotTeam = [...([] as any[]).concat(o.Job[0].SlotTeam ?? []), team];
    audit("common_create", "SlotTeam", team.id, null);
    return { order_id: o.id, number: o.number };
  }
  if (op.kind === "add_position") {
    const team = ([] as any[]).concat(o.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? [])).find((t: any) => Number(t.id) === op.shift_id);
    if (!team) return `shift ${op.shift_id} not on the order`;
    const s = slot(op.position, shiftWindow(op.date, op.start, op.end), team.Slot?.[0]?.SlotLocation?.place_id ?? null);
    team.Slot = [...([] as any[]).concat(team.Slot ?? []), s];
    audit("common_create", "Slot", s.id, null);
    return { order_id: o.id, number: o.number };
  }
  const s = slotsOf(o).find((x) => Number(x.id) === (op as any).slot_id);
  if (!s) return `position ${(op as any).slot_id} not on the order`;
  if (op.kind === "set_position_size") { audit("common_change", "Slot", s.id, { Slot: { size: { old: s.size, new: op.size } } }); s.size = op.size; }
  else if (op.kind === "set_position_times") { const w = shiftWindow(op.date, op.start, op.end); audit("common_change", "Slot", s.id, { Slot: { beginning: { old: s.beginning, new: w.beginning }, end: { old: s.end, new: w.end } } }); s.beginning = w.beginning; s.end = w.end; }
  else if (op.kind === "cancel_position") { audit("common_change", "Slot", s.id, { Slot: { cancelled: { old: false, new: true } } }); s.cancelled = true; }
  return { order_id: o.id, number: o.number };
}

export async function runOp(source: string, op: Op, _opts: { testOnly: boolean } = { testOnly: false }): Promise<RunResult> {
  const k = key(source, op);
  const was = seen.get(k);
  if (was) return { op_key: k, status: "seen", reasons: [`already ${was.status}`], detail: was.detail };
  let result: RunResult;
  try {
    const d = apply(op);
    result = typeof d === "string" ? { op_key: k, status: "refused", reasons: [d] } : { op_key: k, status: "verified", reasons: [], detail: d };
  } catch (e) {
    result = { op_key: k, status: "refused", reasons: [String((e as Error)?.message ?? e)] };
  }
  seen.set(k, result);
  ran.push({ at: clock.iso(), source, op, result });
  return result;
}

// Everything else run.ts exports, so a module that imports one of them still loads.
export const ON_POSITION = new Set([0, 1, 3]);
export const staffedRefusal = () => [];
export const attendingOn = async () => 0;
export const teamsOf = (o: any) => ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => [].concat(j.SlotTeam ?? [])).map((t: any) => ({ id: Number(t.id), slots: [].concat(t.Slot ?? []).filter((s: any) => s.cancelled !== true) }));
export const auditCursor = async () => null;
