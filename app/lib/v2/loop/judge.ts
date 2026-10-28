// ============================================================================
// The loop's judge: one email's plan against what staff did in OnSinch, matched by day and venue (ADDENDUM §12.2).
// ----------------------------------------------------------------------------
// The owner's standard (DECISIONS O6): what staff do in OnSinch is the only truth; no model label and no resolver.
// The Part 1 audit judged a plan against every staff act on the client's orders in the window and called 26 of
// 40 two-week plans wrong; matched by day, 13 of the 29 where staff made one order were right and the extra
// orders were other jobs (§12.1). So the orders compared are the client's orders staff touched in the window
// that hold a day the plan (or the email) names, at the plan's venue when one holds it; the plan's own orders
// always. Each order is read as it stood when the window closed: the order now, with every later timeline change
// undone. A part deleted after the window cannot be put back, so that order is "can't tell", never guessed.
// Pure: the caller reads the rows, the orders and the email; app/lib/v2/score.ts compares the keys.
// ============================================================================
import type { Op } from "../bot/ops";
import { utcToLondon } from "../bot/ops";
import { bookingKeys, judge, truthKeys, type Act } from "../score";

export const BOT = 2257;
const HOUR = 3600e3;
const T = (s: unknown) => Date.parse(String(s ?? "")) || 0;
const BOOKING = /^Slot\.(size|beginning|end|profession_id|cancelled|role)$|^Order\.intern_name$/;
const PART: Record<string, string> = { SlotTeam: "shift", Slot: "position", Job: "job" };

/** One stored timeline row (onsinch_timeline). */
export type Row = { id: number; action: string; creator: number | null; created: string; model: string | null; model_id: string | null; order_id: number | null; data: any };
export type OrderInfo = { number: string; company_id: number };

/**
 * Booking acts from stored rows, as harness/real/writes.ts actsOf reads the gold copy: an order's own rows by its
 * number, a delete as an act on the part deleted, OnSinch's automated cancels left out. A row whose order is not
 * known is counted, not dropped silently.
 */
export function actsOf(rows: Row[], info: (orderId: number) => OrderInfo | undefined, creator: "staff" | "bot" = "staff"): { acts: Array<Act & { row_id: number }>; unowned: number } {
  const acts: Array<Act & { row_id: number }> = [];
  let unowned = 0;
  for (const r of rows) {
    if ((Number(r.creator) === BOT) !== (creator === "bot")) continue;
    const d = r.data ?? {};
    let what = "", model = String(d.model ?? ""), model_id = Number(d.id) || undefined;
    let changes: Act["changes"];
    if (r.action === "order_create" || r.action === "order_create_by_copy") what = "create order";
    else if (r.action === "order_cancel") { if (d.data?.automated) continue; what = "cancel order"; }
    else if (r.action === "order_confirm_provisional") what = "confirm order";
    else if (r.action === "common_create" && PART[d.model]) { what = `add ${PART[d.model]}`; }
    else if (r.action === "common_delete" && PART[d.data?.model]) { what = `delete ${PART[d.data.model]}`; model = String(d.data.model); model_id = Number(d.data.id) || undefined; }
    else if (r.action === "common_change") {
      const fields = Object.entries(d.diffChanges ?? {}).flatMap(([m, f]) => Object.keys(f as object).map((k) => `${m}.${k}`)).filter((f) => BOOKING.test(f));
      if (!fields.length) continue;
      what = `edit ${[...new Set(fields)].sort().join("+")}`;
      changes = Object.fromEntries(fields.filter((f) => f.startsWith(`${d.model}.`)).map((f) => [f.split(".")[1], d.diffChanges[d.model][f.split(".")[1]]]));
    } else continue;
    const who = r.order_id ? info(Number(r.order_id)) : undefined;
    if (!who) { unowned++; continue; }
    acts.push({ row_id: r.id, at: r.created, by: Number(r.creator), what, order_id: Number(r.order_id), number: who.number, company_id: who.company_id, model, model_id, ...(changes ? { changes } : {}) });
  }
  return { acts, unowned };
}

function coerce(field: string, old: unknown, cur: unknown): unknown {
  if (old === null || old === undefined) return null;
  if ((field === "beginning" || field === "end") && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(String(old))) return String(old).replace(" ", "T") + "+00:00";
  if (typeof cur === "number") return old === "" ? null : Number(old);
  if (typeof cur === "boolean") return old === true || old === 1 || old === "1";
  return old;
}

/**
 * The order as it stood at `at`, from the order read now and its timeline rows: parts made after `at` removed,
 * every later field change undone newest first, a later cancel reopened. `deletedAfter` counts parts deleted
 * after `at`, whose content is gone with them.
 */
export function orderAt(order: any, at: number, rows: Row[]): { order: any; deletedAfter: number } {
  const x = structuredClone(order);
  const keep = (e: any) => !e?.created || T(e.created) <= at;
  x.Job = ([].concat(x.Job ?? []) as any[]).filter(keep).map((j) => ({ ...j, SlotTeam: ([].concat(j.SlotTeam ?? []) as any[]).filter(keep).map((t) => ({ ...t, Slot: ([].concat(t.Slot ?? []) as any[]).filter(keep) })) }));
  const parts = new Map<string, any>([[`Order:${x.number}`, x]]);
  for (const j of x.Job) { parts.set(`Job:${j.id}`, j); for (const t of j.SlotTeam) { parts.set(`SlotTeam:${t.id}`, t); for (const s of t.Slot) parts.set(`Slot:${s.id}`, s); } }
  const later = rows.filter((r) => T(r.created) > at).sort((a, b) => T(b.created) - T(a.created) || b.id - a.id);
  let deletedAfter = 0;
  for (const r of later) {
    const d = r.data ?? {};
    if (r.action === "common_change") {
      const e = parts.get(`${d.model}:${d.id}`);
      if (e) for (const [f, v] of Object.entries((d.diffChanges ?? {})[d.model] ?? {})) if (v && typeof v === "object" && "old" in (v as object)) e[f] = coerce(f, (v as any).old, e[f]);
    } else if (r.action === "order_cancel" && Number(x.status) === -1) x.status = 0;
    else if (r.action === "common_delete") deletedAfter++;
  }
  return { order: x, deletedAfter };
}

const slotsOf = (o: any): any[] => ([].concat(o?.Job ?? []) as any[]).flatMap((j) => [].concat(j.SlotTeam ?? []) as any[]).flatMap((t) => ([].concat(t.Slot ?? []) as any[]).map((s) => ({ ...s, team: Number(t.id) })));
const dayOf = (iso: unknown) => utcToLondon(String(iso)).date;
const placeOf = (s: any) => Number(s?.SlotLocation?.place_id) || 0;

/**
 * An email's window: 1 h before it to the first of 96 h after it or the thread's next client email that cuts
 * (one that got a card): the next email's work is that email's (harness/real/writes.ts windowFor).
 */
export function windowFor(sentAt: number, laterClientEmails: Array<{ message_id: string; at: number; cuts: boolean }>): { from: number; to: number; cut_by: string | null } {
  const next = laterClientEmails.filter((m) => m.cuts && m.at > sentAt).sort((a, b) => a.at - b.at)[0];
  const cap = sentAt + 96 * HOUR, nextAt = next ? next.at : Infinity;
  return { from: sentAt - HOUR, to: Math.min(cap, nextAt), cut_by: nextAt < cap ? next!.message_id : null };
}

/** The days, venues and orders a plan is about; a slot's day and venue are read from its order. */
export function planScope(ops: Op[], order: (id: number) => any | undefined): { days: string[]; venues: number[]; orders: number[] } {
  const days = new Set<string>(), venues = new Set<number>(), orders = new Set<number>();
  const slot = (oid: number, sid: number) => slotsOf(order(oid)).find((s) => Number(s.id) === sid);
  for (const op of ops) {
    if ("order_id" in op && op.order_id) orders.add(Number(op.order_id));
    if (op.kind === "create_order") for (const s of op.shifts) { days.add(s.date); if (s.place_id) venues.add(Number(s.place_id)); }
    else if (op.kind === "add_shift") { days.add(op.date); if (op.location_id) venues.add(Number(op.location_id)); }
    else if (op.kind === "add_position") { days.add(op.date); const t = slotsOf(order(op.order_id)).find((s) => s.team === Number(op.shift_id)); if (t) venues.add(placeOf(t)); }
    else if (op.kind === "set_position_times") { days.add(op.date); const s = slot(op.order_id, op.slot_id); if (s) venues.add(placeOf(s)); }
    else if (op.kind === "set_position_size" || op.kind === "cancel_position") { const s = slot(op.order_id, op.slot_id); if (s?.beginning) { days.add(dayOf(s.beginning)); venues.add(placeOf(s)); } }
  }
  venues.delete(0);
  return { days: [...days].sort(), venues: [...venues].sort((a, b) => a - b), orders: [...orders].sort((a, b) => a - b) };
}

/** The London days an act is about; null when it has none (a PO, a cancel, a job). */
function actDays(a: Act, o: any): string[] | null {
  const slots = slotsOf(o).filter((x) => x.beginning);
  if (a.what === "create order") return [...new Set(slots.filter((x) => x.cancelled !== true).map((x) => dayOf(x.beginning)))];
  if (a.model === "SlotTeam") { const ds = slots.filter((x) => x.team === a.model_id).map((x) => dayOf(x.beginning)); return ds.length ? ds : null; }
  if (a.model !== "Slot" || !a.model_id) return null;
  const b = a.changes?.beginning?.new ?? slots.find((x) => Number(x.id) === a.model_id)?.beginning;
  return b ? [dayOf(b)] : null;
}

export type Bucket = "matched" | "partial" | "wrong" | "staff did nothing" | "staff acted, no plan" | "can't tell";
export type Outcome = { bucket: Bucket; why: string | null; orders: number[]; acts: number; plan_keys: string[]; staff_keys: string[]; staff_other: string[] };

/** Why a create differs, field by field: "days", "times", "venue", "crew", or the shift grouping only. */
function createDiff(planKey: string, staffKey: string): string {
  const parse = (k: string) => k.replace(/^create \d+: /, "").split(" | ").map((x) => { const [d, t, at, ...c] = x.split(" "); return { d, t, at, c: c.join(" ") }; });
  const P = parse(planKey), S = parse(staffKey);
  const set = (xs: Array<Record<string, string>>, f: string) => [...new Set(xs.map((x) => x[f]))].sort().join(";");
  const diff = ["d", "t", "at", "c"].filter((f) => set(P, f) !== set(S, f)).map((f) => ({ d: "days", t: "times", at: "venue", c: "crew" } as Record<string, string>)[f]);
  return diff.length ? diff.join(", ") : "shift grouping";
}

/**
 * One email judged. `acts` are staff's acts on the client's orders (any time; the window is applied here);
 * `order(id)` is that order as it stood when the window closed. A plan of no operations is a hand-off or
 * nothing to do: staff's work on its days is "staff acted, no plan".
 */
export function scoreEmail(input: { plan: Op[] | null; days: string[]; venues: number[]; planOrders: number[]; sentAt: number; window: { from: number; to: number }; acts: Act[]; order: (id: number) => any | undefined }): Outcome {
  const { plan, days, venues, window: w } = input;
  const ops = plan ?? [];
  const inWindow = input.acts.filter((a) => T(a.at) >= w.from && T(a.at) <= w.to && a.what !== "confirm order" && !(a.what === "create order" && T(a.at) < input.sentAt));
  const touched = [...new Set(inWindow.map((a) => a.order_id))];
  const on = (o: any, wantVenue: boolean) => slotsOf(o).some((s) => s.beginning && days.includes(dayOf(s.beginning)) && (!wantVenue || !venues.length || venues.includes(placeOf(s))));
  const atVenue = touched.filter((id) => on(input.order(id), true));
  const onDay = touched.filter((id) => on(input.order(id), false));
  // No day named: only the plan's own orders can be compared.
  const matchedBy = !days.length ? [] : atVenue.length ? atVenue : onDay;
  const targets = new Set<number>([...input.planOrders.filter((id) => touched.includes(id)), ...matchedBy]);
  const mine = inWindow.filter((a) => targets.has(a.order_id)).filter((a) => {
    if (!days.length) return true;
    const ds = actDays(a, input.order(a.order_id));
    return ds == null || ds.some((d) => days.includes(d));
  });
  const truth = truthKeys(mine, (id) => input.order(id));
  const base = { orders: [...targets].sort((a, b) => a - b), acts: mine.length, staff_keys: truth.keys, staff_other: truth.other };
  if (!ops.length) {
    const p = { ...base, plan_keys: [] as string[] };
    return mine.length ? { ...p, bucket: "staff acted, no plan", why: null } : { ...p, bucket: "staff did nothing", why: days.length ? null : "the email names no day" };
  }
  const v = judge(ops, truth);
  const plan_keys = [...new Set(ops.flatMap(bookingKeys))].sort();
  const out = { ...base, plan_keys };
  if (!mine.length) return { ...out, bucket: "staff did nothing", why: null };
  if (v.verdict === "completed") return { ...out, bucket: "matched", why: null };
  if (v.verdict === "partial") return { ...out, bucket: "partial", why: "staff also did what the plan does not hold" };
  // Wrong: say why in the fields OnSinch holds.
  if (days.length && venues.length && !atVenue.length && onDay.length) return { ...out, bucket: "wrong", why: "venue: staff worked that day at another venue" };
  const planCreate = v.extra.find((k) => k.startsWith("create ")), staffCreate = truth.keys.find((k) => k.startsWith("create "));
  if (planCreate && staffCreate) return { ...out, bucket: "wrong", why: `differs in ${createDiff(planCreate, staffCreate)}` };
  if (planCreate) return { ...out, bucket: "wrong", why: "staff made no order on those days; they changed an existing one" };
  const orderOf = (k: string) => Number(/^\w+ (\d+)/.exec(k)?.[1]);
  const staffOrders = new Set(mine.map((a) => a.order_id));
  if (v.extra.every((k) => !staffOrders.has(orderOf(k)))) return { ...out, bucket: "wrong", why: "another order: staff changed a different order" };
  const kinds = [...new Set(v.extra.map((k) => k.split(" ")[0]))].join(", ");
  return { ...out, bucket: "wrong", why: `a different value (${kinds})` };
}

