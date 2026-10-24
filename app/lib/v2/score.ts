// ============================================================================
// The system's operations judged against what staff did in OnSinch, by their values.
// ----------------------------------------------------------------------------
// The addendum's 5.1 (23 Oct): score-vs-ops passed a "create" when any order was planned and an
// "update" when any operation touched an order staff touched, never checking the shift, the count
// or the time; week-review called a write done when the runs it had were verified, not when every
// planned operation had one. This is the one comparison both scripts and the harness use.
//
// What staff did becomes the operations the system would have sent for it: an edit by its new
// value (OnSinch's timeline gives old and new), an order or a shift staff created by what it holds
// when read. Two plans are the same booking when every shift agrees on day, window, venue and the
// crew per profession and role; how staff split a crew into positions does not count.
// ============================================================================
import type { Op } from "./bot/ops";
import { utcToLondon } from "./bot/ops";

/** The fields that change what crew turn up where and when; cosmetic labels are left out. */
export function essentials(op: Op): Record<string, unknown> {
  switch (op.kind) {
    case "create_order": return { kind: op.kind, company_id: op.company_id, client_email: op.client_email, po: op.po ?? null,
      shifts: op.shifts.map((s) => ({ date: s.date, start: s.start, end: s.end, place_id: s.place_id, positions: s.positions })).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)) };
    case "set_position_times": return { kind: op.kind, order_id: op.order_id, slot_id: op.slot_id, date: op.date, start: op.start, end: op.end };
    case "set_position_size": return { kind: op.kind, order_id: op.order_id, slot_id: op.slot_id, size: op.size };
    case "set_po": return { kind: op.kind, order_id: op.order_id, po: op.po };
    case "cancel_position": return { kind: op.kind, order_id: op.order_id, slot_id: op.slot_id };
    case "add_shift": return { kind: op.kind, order_id: op.order_id, location_id: op.location_id, date: op.date, start: op.start, end: op.end, positions: op.positions };
    case "add_position": return { kind: op.kind, order_id: op.order_id, shift_id: op.shift_id, date: op.date, start: op.start, end: op.end, position: op.position };
  }
}
export const canon = (ops: Op[]) => ops.map((o) => JSON.stringify(essentials(o))).sort();
export const sameOps = (a: Op[], b: Op[]) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Every planned operation ran and verified. Fewer runs than operations is a plan cut short, never done. */
export function fullyWritten(ops: readonly unknown[], executed: unknown): boolean {
  const runs = Array.isArray(executed) ? executed : [];
  return ops.length > 0 && runs.length === ops.length && runs.every((r: any) => r?.status === "verified");
}

// --- what staff did ------------------------------------------------------------------

/** A staff booking action from OnSinch's timeline (scripts/ops-truth.mts), with its values. */
export type Act = { at: string; by: number; what: string; order_id: number; number: string; company_id: number; model?: string; model_id?: number; changes?: Record<string, { old: unknown; new: unknown }> };

const role = (r: unknown) => (Number(r) === 1 || r === "crew_chief" ? "chief" : "staff");
const crewOf = (positions: Array<{ size: unknown; profession_id: unknown; role?: unknown }>) => {
  const m = new Map<string, number>();
  for (const p of positions) { const k = `${String(p.profession_id)}|${role(p.role)}`; m.set(k, (m.get(k) ?? 0) + Number(p.size)); }
  return [...m].filter(([, n]) => n > 0).sort().map(([k, n]) => `${k}x${n}`).join(",");
};
const teams = (o: any): any[] => ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j?.SlotTeam ?? []));
const live = (t: any): any[] => ([] as any[]).concat(t?.Slot ?? []).filter((s: any) => s?.cancelled !== true && s?.beginning);
const windowOf = (s: any) => { const b = utcToLondon(s.beginning), e = utcToLondon(s.end); return `${b.date} ${b.time}-${e.time}`; };
const shiftKey = (t: any) => { const slots = live(t); return slots.length ? `${windowOf(slots[0])} @${slots[0]?.SlotLocation?.place_id ?? "?"} ${crewOf(slots)}` : null; };

/**
 * One booking change as a comparable key: what crew are where and when, never how the positions
 * are split. A create is its company and its shifts; an edit is its slot and the new value.
 */
export function bookingKeys(op: Op): string[] {
  switch (op.kind) {
    case "create_order": return [`create ${op.company_id}: ` + op.shifts.map((s) => `${s.date} ${s.start}-${s.end} @${s.place_id} ${crewOf(s.positions)}`).sort().join(" | ")];
    case "set_position_size": return [`size ${op.order_id}/${op.slot_id}=${op.size}`];
    case "set_position_times": return [`times ${op.order_id}/${op.slot_id}=${op.date} ${op.start}-${op.end}`];
    case "cancel_position": return [`cancel ${op.order_id}/${op.slot_id}`];
    case "set_po": return [`po ${op.order_id}=${op.po}`];
    case "add_shift": return [`shift ${op.order_id}: ${op.date} ${op.start}-${op.end} ${crewOf(op.positions)}`];
    case "add_position": return [`position ${op.order_id}/${op.shift_id}: ${op.date} ${op.start}-${op.end} ${crewOf([op.position])}`];
  }
}

/** What staff did after an email, as booking keys; `other` is what no system operation can express. */
export function truthKeys(acts: Act[], orderById: (id: number) => any | undefined): { keys: string[]; other: string[] } {
  const keys = new Set<string>(), other: string[] = [];
  for (const a of acts) {
    const o = orderById(a.order_id);
    if (a.what === "create order") {
      const shifts = teams(o).map(shiftKey).filter((k): k is string => !!k).sort();
      if (shifts.length) keys.add(`create ${a.company_id}: ` + shifts.join(" | "));
      else other.push(`created R${a.number}, now empty`);
      continue;
    }
    if (a.what === "cancel order") { other.push(`cancelled R${a.number}`); continue; }
    if (a.what === "add shift" && a.model_id) {
      const t = teams(o).find((x) => Number(x.id) === a.model_id), slots = live(t);
      if (slots.length) keys.add(`shift ${a.order_id}: ${windowOf(slots[0])} ${crewOf(slots)}`); else other.push(`added a shift to R${a.number}, now gone`);
      continue;
    }
    if (a.what === "add position" && a.model_id) {
      const t = teams(o).find((x) => live(x).some((s: any) => Number(s.id) === a.model_id)), s = live(t).find((x: any) => Number(x.id) === a.model_id);
      if (s) keys.add(`position ${a.order_id}/${t.id}: ${windowOf(s)} ${crewOf([s])}`); else other.push(`added a position to R${a.number}, now gone`);
      continue;
    }
    const ch = a.changes ?? {};
    if (a.model === "Slot" && a.model_id) {
      const slot = teams(o).flatMap((t) => ([] as any[]).concat(t?.Slot ?? [])).find((s: any) => Number(s.id) === a.model_id);
      if (ch.size) keys.add(`size ${a.order_id}/${a.model_id}=${Number(ch.size.new)}`);
      if (ch.cancelled && (ch.cancelled.new === true || ch.cancelled.new === "1" || ch.cancelled.new === 1)) keys.add(`cancel ${a.order_id}/${a.model_id}`);
      if (ch.beginning || ch.end) {
        const b = String(ch.beginning?.new ?? slot?.beginning ?? ""), e = String(ch.end?.new ?? slot?.end ?? "");
        if (b && e) keys.add(`times ${a.order_id}/${a.model_id}=${windowOf({ beginning: b, end: e })}`); else other.push(`retimed a position on R${a.number}`);
      }
      for (const f of Object.keys(ch).filter((f) => !["size", "cancelled", "beginning", "end"].includes(f))) other.push(`changed ${f} on R${a.number}`);
      continue;
    }
    if (a.model === "Order" && ch.intern_name) { keys.add(`po ${a.order_id}=${String(ch.intern_name.new ?? "")}`); continue; }
    other.push(`${a.what} on R${a.number}`);
  }
  return { keys: [...keys].sort(), other };
}

export type Verdict = "completed" | "partial" | "wrong" | "missed" | "nothing to do";

/**
 * The plan against what staff did. Wrong: an operation staff did not do (an extra one, or the
 * right slot with another value). Partial: every operation right, some of staff's work not in
 * the plan. Missed: staff booked something and the plan held nothing.
 */
export function judge(planned: Op[], truth: { keys: string[]; other: string[] }): { verdict: Verdict; extra: string[]; lacking: string[] } {
  const p = new Set(planned.flatMap(bookingKeys)), t = new Set(truth.keys);
  const extra = [...p].filter((k) => !t.has(k)), lacking = [...[...t].filter((k) => !p.has(k)), ...truth.other];
  if (!p.size) return { verdict: t.size || truth.other.length ? "missed" : "nothing to do", extra, lacking };
  if (extra.length) return { verdict: "wrong", extra, lacking };
  return { verdict: lacking.length ? "partial" : "completed", extra, lacking };
}
