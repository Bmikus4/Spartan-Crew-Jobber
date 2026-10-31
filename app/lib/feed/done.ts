// ============================================================================
// Is this need done? The one answer (ADDENDUM §13.2 change 1; DECISIONS O14).
// ----------------------------------------------------------------------------
// Staff's OnSinch work after the client's email counts only on the need's own job. Clearing on any of the
// client's orders that day would have cleared 18 of 109 dated needs on another job (§13, 30 Oct), so the job is
// found by the first rung that yields one, absolute evidence first:
//   1. an order the thread names absolutely (links.ts gradeLinks): an R, J or PO OnSinch holds, or the bot's own;
//   2. a guessed link to the sender's company's order, only when that order holds a day the need names, at its
//      venue when it names one (a need with no day has no day to disagree);
//   3. the client's orders holding the need's day at the need's venue;
//   4. the client's orders holding the need's day;
//   5. for a new booking with no day, the client's orders staff made after the email.
// A new booking the order already held on every day it names, before the email, is done too: on 29 Oct a client
// confirmed shifts staff had booked a week before. Two or more candidate jobs with nothing absolute between them is never done: "Possibly done in R1 or R2".
// The work must fit the ask, and a deleted order (truth.ts refreshOrders) never counts: a create then a delete
// is no booking. Pure: the caller passes the stored rows, nothing here reads a database, OnSinch or the clock.
// ============================================================================
import { utcToLondon } from "../v2/bot/ops";

/** The bot's OnSinch user: its own writes are never a person's work. */
export const BOT = 2257;

export type Ask = "book" | "change" | "cancel" | "any";
/** `fresh`: the need is a new booking (needs-created), not a change to an order the client already has. */
export type Need = { at: number; asks: Ask[]; fresh: boolean; days: string[]; places: number[]; venues: string[]; company_id: number | null };
/** A thread's link to an order; `ref` is what named it, so one PO held by two orders is told from two POs. */
export type Link = { order_id: number; absolute: boolean; ref: string };
export type Order = { order_id: number; number: string | null; company_id: number | null; body: any; deleted: boolean };
export type Row = { id: number; action: string; creator: number | null; created: string; model: string | null; model_id: string | null; order_id: number | null; data: any };
export type Verdict = { state: "done" | "possibly" | "open"; orders: number[]; rung: string; text: string; at: string | null; creator: number | null };

type Shift = { slot: string; team: string; day: string; place: number | null; cancelled: boolean };

/** Every shift with a start, cancelled ones too: a cancelled shift still says which job a need was about. */
export function shiftsOf(body: any): Shift[] {
  const out: Shift[] = [];
  for (const j of [].concat(body?.Job ?? []) as any[]) for (const t of [].concat(j?.SlotTeam ?? []) as any[]) for (const s of [].concat(t?.Slot ?? []) as any[]) {
    if (!s?.beginning) continue;
    const loc = Array.isArray(s.SlotLocation) ? s.SlotLocation[0] : s.SlotLocation;
    out.push({ slot: String(s.id), team: String(t.id), day: utcToLondon(String(s.beginning)).date, place: Number(loc?.place_id) > 0 ? Number(loc.place_id) : null,
      cancelled: s.cancelled === true || Number(s.cancelled) > 0 || t.cancelled === true || Number(t.cancelled) > 0 });
  }
  return out;
}

const T = (s: string) => Date.parse(s) || 0;
const label = (o: Order) => (o.number ? `R${o.number}` : `order ${o.order_id}`);
const atPlace = (s: Shift, places: number[]) => !places.length || (s.place != null && places.includes(s.place));
const holdsDay = (o: Order, need: Need, places: number[]) => shiftsOf(o.body).some((s) => need.days.includes(s.day) && atPlace(s, places));
const MADE = new Set(["order_create", "order_create_by_copy", "order_created_via_api"]);
const madeAfter = (o: Order, rows: Row[], need: Need, within = Infinity) => rows.some((r) => r.order_id === o.order_id && MADE.has(r.action) && r.creator != null && Number(r.creator) !== BOT && T(r.created) > need.at && T(r.created) <= need.at + within);
/** An undated booking's order is one staff made within this of the email: 96 hours, the window the same-day study used. */
const UNDATED_WINDOW_MS = 96 * 3600e3;

/** A row as staff's work: what it did, and which asks it answers. Null when it is not booking work. */
function workOf(r: Row, o: Order, need: Need): { what: string; fits: Ask[] } | null {
  if (r.creator == null || Number(r.creator) === BOT || T(r.created) <= need.at) return null;
  const d = r.data ?? {};
  const days = new Set(shiftsOf(o.body).filter((s) => s.slot === String(r.model_id) || s.team === String(r.model_id)).map((s) => s.day));
  for (const f of ["beginning", "end"]) for (const v of [d.diffChanges?.Slot?.[f]?.old, d.diffChanges?.Slot?.[f]?.new]) if (v) days.add(utcToLondon(String(v)).date);
  // A part is on the need's day, or its day cannot be known (a deleted part, an undated need).
  const onDay = !need.days.length || !days.size || [...days].some((x) => need.days.includes(x));
  if (MADE.has(r.action)) return { what: "made the order", fits: ["book", "any"] };
  // OnSinch marks staff's own order cancels "automated" (175 of 207 to 31 Oct, by 11 people): the creator is the test.
  if (r.action === "order_cancel") return { what: "cancelled the order", fits: ["cancel", "any"] };
  if (r.action === "order_confirm_provisional") return { what: "confirmed the order", fits: ["book", "any"] };
  if (r.action === "common_create" && (d.model === "SlotTeam" || d.model === "Slot") && onDay) return { what: d.model === "Slot" ? "added crew" : "added a shift", fits: ["book", "change", "any"] };
  if (r.action === "common_delete" && /^(Slot|SlotTeam|Job)$/.test(String(d.data?.model ?? "")) && onDay) return { what: "removed a shift", fits: ["cancel", "change", "any"] };
  if (r.action === "common_change") {
    const f = Object.entries(d.diffChanges ?? {}).flatMap(([m, x]) => Object.keys(x as object).map((k) => `${m}.${k}`));
    if (f.includes("Slot.cancelled") && onDay) return { what: "cancelled a shift", fits: ["cancel", "any"] };
    if (f.some((x) => /^Slot\.(size|beginning|end|profession_id)$/.test(x)) && onDay) return { what: f.includes("Slot.size") ? "changed the crew" : "changed the times", fits: ["change", "any"] };
    if (f.some((x) => /^Order\.(intern_name|name)$/.test(x))) return { what: "changed the order's details", fits: ["any"] };
  }
  return null;
}

/** Every ask has staff work that fits it on this order after the email (with the latest such row), or a new booking was on it already. */
function doneOn(o: Order, rows: Row[], need: Need, places: number[]): { what: string[]; last: Row | null } | null {
  const mine = rows.filter((r) => r.order_id === o.order_id);
  const active = shiftsOf(o.body).filter((s) => !s.cancelled);
  if (need.fresh && need.days.length && !madeAfter(o, rows, need) && need.days.every((d) => active.some((s) => s.day === d && atPlace(s, places)))) return { what: ["booked it before the email"], last: null };
  const undone = (r: Row) => r.action === "order_cancel" && mine.some((u) => u.action === "order_uncancel" && T(u.created) > T(r.created));
  const work = mine.filter((r) => !undone(r)).map((r) => ({ r, w: workOf(r, o, need) })).filter((x): x is { r: Row; w: NonNullable<ReturnType<typeof workOf>> } => !!x.w);
  const cancelled = work.find((x) => x.r.action === "order_cancel");
  if (cancelled) return { what: ["cancelled the order"], last: cancelled.r };
  const asks = need.asks.length ? need.asks : (["any"] as Ask[]);
  if (!work.length || !asks.every((a) => work.some((x) => x.w.fits.includes(a)))) return null;
  const last = work.reduce((a, b) => (T(b.r.created) > T(a.r.created) ? b : a)).r;
  return { what: [...new Set(work.map((x) => x.w.what))], last };
}

/** The need's candidate jobs: groups that must each come to one order, from the first rung that yields any. */
function candidates(need: Need, links: Link[], orders: Map<number, Order>, rows: Row[], places: number[]): { rung: string; groups: Order[][] } {
  const live = (id: number) => { const o = orders.get(id); return o && !o.deleted ? o : null; };
  const client = need.company_id ? [...orders.values()].filter((o) => !o.deleted && o.company_id === need.company_id) : [];
  const abs = links.filter((l) => l.absolute && live(l.order_id));
  if (abs.length) {
    const byRef = new Map<string, Order[]>();
    for (const l of abs) byRef.set(l.ref, [...(byRef.get(l.ref) ?? []), live(l.order_id)!]);
    // The need's day picks among the orders one reference names, and among the references: a thread naming this
    // job and an older one (31 Oct: a J and a PO a week apart) is about the one holding the day.
    const all = [...byRef.values()].map((g) => (need.days.length ? g.filter((o) => holdsDay(o, need, [])) : g));
    const groups = all.some((g) => g.length) ? all.filter((g) => g.length) : [...byRef.values()];
    return { rung: "named by the thread", groups };
  }
  // A guess on another company's order than the sender's is no candidate (31 Oct: R11871 would have cleared a need).
  const guessed = links.filter((l) => !l.absolute).map((l) => live(l.order_id))
    .filter((o): o is Order => !!o && (!need.days.length || holdsDay(o, need, places)) && (!need.company_id || o.company_id === need.company_id));
  if (guessed.length) return { rung: need.days.length ? "the thread's link, on the need's day" : "the thread's link", groups: [guessed] };
  if (!need.days.length) {
    const made = need.fresh ? client.filter((o) => madeAfter(o, rows, need, UNDATED_WINDOW_MS)) : [];
    return made.length ? { rung: "the client's order made after the email", groups: [made] } : { rung: "", groups: [] };
  }
  if (places.length) {
    const atVenue = client.filter((o) => holdsDay(o, need, places));
    if (atVenue.length) return { rung: "the need's venue and day", groups: [atVenue] };
  }
  const onDay = client.filter((o) => holdsDay(o, need, []));
  return onDay.length ? { rung: onDay.length === 1 ? "the client's only order that day" : "the client's orders that day", groups: [onDay] } : { rung: "", groups: [] };
}

export function isDone(need: Need, links: Link[], orders: Map<number, Order>, rows: Row[], placeNamed: (name: string) => number[] = () => []): Verdict {
  const places = [...need.places, ...need.venues.flatMap(placeNamed)];
  const { rung, groups } = candidates(need, links, orders, rows, places);
  const open: Verdict = { state: "open", orders: [], rung, text: "", at: null, creator: null };
  if (!groups.length) return open;
  const found = groups.map((g) => g.map((o) => ({ o, d: doneOn(o, rows, need, places) })).filter((x) => x.d));
  if (groups.some((g, i) => g.length > 1 && found[i].length)) {
    const hit = found.flat();
    return { ...open, state: "possibly", orders: hit.map((x) => x.o.order_id), text: `Possibly done in ${hit.map((x) => label(x.o)).join(" or ")}: check` };
  }
  if (found.some((f) => !f.length)) return open;
  const done = found.map((f) => f[0]);
  const last = done.map((x) => x.d!.last).filter((r): r is Row => !!r).sort((a, b) => T(b.created) - T(a.created))[0] ?? null;
  const text = done.map((x) => `${label(x.o)}, staff ${x.d!.what.join(", ")}`).join("; ");
  return { state: "done", orders: done.map((x) => x.o.order_id), rung, text, at: last ? new Date(T(last.created)).toISOString() : null, creator: last?.creator ?? null };
}
