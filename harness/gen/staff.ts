// ============================================================================
// Simulated staff: what a person does in OnSinch, applied to the fake (harness/sim/onsinch.ts) and logged as
// OnSinch logs it, under the person's user id: an order's create row by its id with its number and path, a
// part's create row with its path, a change by the part with old and new values, a cancel flagged automated
// (as OnSinch flags staff's own cancels, 175 of 207 to 31 Oct), a delete that takes the create row with it and
// logs nothing. The TV's truth is these rows (done.ts), so they are the whole of what staff "did".
// ============================================================================
import { shiftWindow } from "../../app/lib/v2/bot/ops";
import { store, audit, pathOf, deleteOrder } from "../sim/onsinch";
import { clock } from "../sim/pg";
import { ids, orderOf, positionsOf, type Client } from "./world";
import type { Call } from "./grammar";

/** Staff user ids seen on the live timeline. */
export const STAFF = [2850, 2826, 2633, 110, 413, 102];

const teams = (o: any): any[] => ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => [].concat(j.SlotTeam ?? []));

export function createOrder(client: Client, calls: Call[], by: number, po: string | null = null, number?: string): any {
  const o = orderOf(client, calls, { created: clock.iso(), creator: by, po, number });
  store.orders.set(Number(o.id), o);
  audit("order_create", "Order", o.id, null, { creator: by, data: { number: o.number, path: pathOf(o.id) } });
  for (const t of teams(o)) {
    audit("common_create", "SlotTeam", t.id, null, { creator: by, data: { path: pathOf(o.id, { team: t.id }) } });
    for (const s of t.Slot) audit("common_create", "Slot", s.id, null, { creator: by, data: { path: pathOf(o.id, { team: t.id, slot: s.id }) } });
  }
  return o;
}

/** A call added to an order. */
export function addCall(o: any, call: Call, by: number): void {
  const w = shiftWindow(call.date, call.start, call.end);
  const team = { id: ++ids.team, name: "Crew", created: clock.iso(), creator: by, cancelled: false,
    Slot: positionsOf(call).map((p) => ({ id: ++ids.slot, ...p, beginning: w.beginning, end: w.end, cancelled: false, created: clock.iso(), creator: by, SlotLocation: { id: ++ids.location, place_id: call.place.id } })) };
  o.Job[0].SlotTeam.push(team);
  audit("common_create", "SlotTeam", team.id, null, { creator: by, data: { path: pathOf(o.id, { team: team.id }) } });
  for (const s of team.Slot) audit("common_create", "Slot", s.id, null, { creator: by, data: { path: pathOf(o.id, { team: team.id, slot: s.id }) } });
}

/** The plain-crew position of call k set to `size`. */
export function setCrew(o: any, k: number, size: number, by: number): void {
  const s = teams(o)[k]?.Slot.find((x: any) => x.role === 0) ?? teams(o)[k]?.Slot[0];
  if (!s) return;
  audit("common_change", "Slot", s.id, { Slot: { size: { old: s.size, new: size } } }, { creator: by });
  s.size = size;
}

/** Every position of call k moved to new times, on its day or another. */
export function setTimes(o: any, k: number, date: string, start: string, end: string, by: number): void {
  const w = shiftWindow(date, start, end);
  for (const s of teams(o)[k]?.Slot ?? []) {
    audit("common_change", "Slot", s.id, { Slot: { beginning: { old: s.beginning, new: w.beginning }, end: { old: s.end, new: w.end } } }, { creator: by });
    s.beginning = w.beginning; s.end = w.end;
  }
}

/** Call k cancelled, position by position. */
export function cancelCall(o: any, k: number, by: number): void {
  for (const s of teams(o)[k]?.Slot ?? []) {
    audit("common_change", "Slot", s.id, { Slot: { cancelled: { old: false, new: true } } }, { creator: by });
    s.cancelled = true;
  }
}

export function cancelOrder(o: any, by: number): void {
  audit("order_cancel", "Order", o.number, null, { creator: by, data: { automated: true } });
  o.status = -1;
  for (const t of teams(o)) for (const s of t.Slot) s.cancelled = true;
}

export function setPo(o: any, po: string, by: number): void {
  audit("common_change", "Order", o.number, { Order: { intern_name: { old: o.intern_name, new: po } } }, { creator: by });
  o.intern_name = po;
}

export const remove = (o: any): void => deleteOrder(Number(o.id));
