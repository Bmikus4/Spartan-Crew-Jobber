// ============================================================================
// Write judging: what staff did after an email, against what the system would have written.
// ----------------------------------------------------------------------------
// item_correctness on writes was measured once by a worker whose scripts were deleted, and that
// measurement carried six scorer faults (eval/write-breakdown.md §7). This is the committed,
// tested version. app/lib/v2/score.ts nets edits and drops parts added then deleted (faults 1-3);
// this file fixes the act set and the order state judged against (faults 4-6):
//   - acts come from the audit copy, Order-level rows keyed by NUMBER (only order_create names the id;
//     test/orderAuditByNumber.ts), deletes kept as acts on the deleted part, the bot (2257) and
//     OnSinch's automated cancels left out;
//   - an email's window runs from 1 h before it to the first of 96 h after it or the next client email
//     on its thread: the next email's work is that email's (fault 5);
//   - orders are read as they stood when the window closed, through the time-correct world, so a later
//     email's change, or a later cancel, cannot make an earlier right plan wrong (faults 4, 6).
// Offline: the gold copy only.
// ============================================================================
import type { Op } from "../../app/lib/v2/bot/ops";
import { utcToLondon } from "../../app/lib/v2/bot/ops";
import { judge, truthKeys, type Act, type Verdict } from "../../app/lib/v2/score";
import { gold, type GoldMessage } from "./data";
import { TimeWorld, type Index } from "./world";

export const BOT = 2257;
const HOUR = 3600e3;
const T = (s: unknown) => Date.parse(String(s ?? "")) || 0;
const BOOKING = /^Slot\.(size|beginning|end|profession_id|cancelled|role)$|^Order\.intern_name$/;
const PART: Record<string, string> = { SlotTeam: "shift", Slot: "position", Job: "job" };

export type Who = { order_id: number; number: string; company_id: number };

/**
 * Every entity key an audit row can name, to its order. Snapshot orders give their parts; a create row's
 * path ("Order:13617/Job:13897/SlotTeam:5/Slot:9") gives parts deleted since.
 */
export function ownerIndex(orders: any[], rows: any[]): Map<string, Who> {
  const owner = new Map<string, Who>(), byId = new Map<number, Who>();
  for (const o of orders) {
    const who = { order_id: Number(o.id), number: String(o.number), company_id: Number(o.company_id) };
    byId.set(who.order_id, who);
    owner.set(`Order:${o.id}`, who);
    owner.set(`OrderNo:${o.number}`, who);
    for (const j of [].concat(o.Job ?? []) as any[]) {
      owner.set(`Job:${j.id}`, who);
      for (const t of [].concat(j.SlotTeam ?? []) as any[]) { owner.set(`SlotTeam:${t.id}`, who); for (const s of [].concat(t.Slot ?? []) as any[]) owner.set(`Slot:${s.id}`, who); }
    }
  }
  for (const r of rows) {
    let d: any; try { d = typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { continue; }
    const segs = String(d?.data?.path ?? "").split("/");
    const who = /^Order:(\d+)$/.test(segs[0] ?? "") ? byId.get(Number(segs[0].slice(6))) : undefined;
    if (who) for (const s of segs.slice(1)) if (!owner.has(s)) owner.set(s, who);
  }
  return owner;
}

/** Staff booking acts from audit rows, with the values the scorer judges by; `creator: "bot"` reads the API user's instead. */
export function actsOf(rows: any[], owner: Map<string, Who>, creator: "staff" | "bot" = "staff"): Act[] {
  const acts: Act[] = [];
  for (const r of rows) {
    if ((Number(r.creator) === BOT) !== (creator === "bot")) continue;
    let d: any; try { d = typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { continue; }
    let what = "", key = "", model = String(d?.model ?? ""), model_id = Number(d?.id) || undefined;
    let changes: Act["changes"];
    if (r.action === "order_create") { what = "create order"; key = `Order:${d.id}`; }
    else if (r.action === "order_create_by_copy") { what = "create order"; key = `OrderNo:${d.id}`; }
    else if (r.action === "order_cancel") { if (d?.data?.automated) continue; what = "cancel order"; key = `OrderNo:${d.id}`; }
    else if (r.action === "order_confirm_provisional") { what = "confirm order"; key = `OrderNo:${d.id}`; }
    else if (r.action === "common_create" && PART[d.model]) { what = `add ${PART[d.model]}`; key = String(d.data?.path ?? "").split("/").pop() || `${d.model}:${d.id}`; }
    else if (r.action === "common_delete" && PART[d.data?.model]) {
      // A delete row names the parent as model/id and the deleted part in data.
      what = `delete ${PART[d.data.model]}`; model = String(d.data.model); model_id = Number(d.data.id) || undefined;
      key = `${model}:${model_id}`;
      if (!owner.has(key)) key = d.model === "Order" ? `OrderNo:${d.id}` : `${d.model}:${d.id}`;
    } else if (r.action === "common_change") {
      const fields = Object.entries(d.diffChanges ?? {}).flatMap(([m, f]) => Object.keys(f as object).map((k) => `${m}.${k}`)).filter((f) => BOOKING.test(f));
      if (!fields.length) continue;
      what = `edit ${[...new Set(fields)].sort().join("+")}`;
      key = d.model === "Order" ? `OrderNo:${d.id}` : `${d.model}:${d.id}`;
      changes = Object.fromEntries(fields.filter((f) => f.startsWith(`${d.model}.`)).map((f) => [f.split(".")[1], d.diffChanges[d.model][f.split(".")[1]]]));
    } else continue;
    const who = owner.get(key);
    if (!who) continue;
    acts.push({ at: String(r.created), by: Number(r.creator), what, ...who, model, model_id, ...(changes ? { changes } : {}) });
  }
  return acts;
}

/**
 * An email's window: 1 h before it to the first of 96 h after it or the thread's next client email that
 * `cuts` (one asking for new booking work). A follow-up that asks nothing new ("any update?") does not
 * cut: staff often act on the first email after it (1a1308b99b2eaf9b, 1a13e9ba4edde86b).
 */
export function windowFor(email: { date_iso: string; message_id: string }, thread: Array<Pick<GoldMessage, "message_id" | "date_iso" | "is_from_spartan">>, cuts: (message_id: string) => boolean = () => true): { from: number; to: number; cut_by: string | null } {
  const at = T(email.date_iso);
  const next = thread.filter((m) => !m.is_from_spartan && m.message_id !== email.message_id && T(m.date_iso) > at && cuts(m.message_id)).sort((a, b) => T(a.date_iso) - T(b.date_iso))[0];
  const cap = at + 96 * HOUR, nextAt = next ? T(next.date_iso) : Infinity;
  return { from: at - HOUR, to: Math.min(cap, nextAt), cut_by: nextAt < cap ? next!.message_id : null };
}

const slotsOf = (o: any): any[] => ([].concat(o?.Job ?? []) as any[]).flatMap((j) => [].concat(j.SlotTeam ?? []) as any[]).flatMap((t) => ([].concat(t.Slot ?? []) as any[]).map((x) => ({ ...x, team: Number(t.id) })));
const day = (iso: unknown) => utcToLondon(String(iso)).date;

/** The London days an act is about, for the readers'-days test; null when it has none (a PO, a cancel). */
function actDays(a: Act, order: any): string[] | null {
  const slots = slotsOf(order).filter((x) => x.beginning);
  if (a.what === "create order") return [...new Set(slots.filter((x) => x.cancelled !== true).map((x) => day(x.beginning)))];
  if (a.model === "SlotTeam") { const ds = slots.filter((x) => x.team === a.model_id).map((x) => day(x.beginning)); return ds.length ? ds : null; }
  if (a.model !== "Slot" || !a.model_id) return null;
  const b = a.changes?.beginning?.new ?? slots.find((x) => Number(x.id) === a.model_id)?.beginning;
  return b ? [day(b)] : null;
}

export type WriteJudgement = { message_id: string; ops: string[]; orders: number[]; window: { from: string; to: string; cut_by: string | null }; acts: number; verdict: Verdict; extra: string[]; lacking: string[] };

/**
 * One write judged: staff's acts on the write's own orders (a create: the orders staff created in the
 * window for that client) within the email's window, on the readers' days when they named any, against
 * the orders as they stood when the window closed.
 */
export async function judgeWrite(ix: Index, staffActs: Act[], email: { message_id: string; date_iso: string; thread: GoldMessage[] }, ops: Op[], companyId: number | null, days: string[], cuts?: (message_id: string) => boolean, botActs: Act[] = []): Promise<WriteJudgement> {
  // WHAT PRODUCTION WROTE FOR THIS EMAIL IS PART OF WHAT WAS DONE. Before the 10-21 pause the bot ran some of
  // these writes itself; staff then had nothing left to do, and a staff-only truth called the same plan
  // "wrong" (3 dev-2 POs the bot set, which the orders still hold). The caller passes the bot's acts only
  // for an email whose own decision ran; a staff reversal of them is a later staff act and nets them out.
  const acts = [...staffActs, ...botActs];
  const w = windowFor(email, email.thread, cuts);
  // An order staff created before the email existed when the client wrote: its create is not this email's
  // work, and staff's later edits to it are (1a13fea576aeda13's R11613, 1a139bb8ded24cbd's R11541).
  const inWindow = acts.filter((a) => T(a.at) >= w.from && T(a.at) <= w.to && !(a.what === "create order" && T(a.at) < T(email.date_iso)));
  const targets = new Set<number>(ops.flatMap((o) => ("order_id" in o && o.order_id ? [Number(o.order_id)] : [])));
  if (ops.some((o) => o.kind === "create_order")) {
    const company = Number((ops.find((o) => o.kind === "create_order") as any).company_id) || companyId;
    for (const a of inWindow) if (a.what === "create order" && a.company_id === company) targets.add(a.order_id);
  }
  const world = new TimeWorld(ix, w.to);
  const orders = new Map<number, any>();
  for (const id of targets) orders.set(id, await world.orderById(id).catch(() => undefined));
  // A confirm is staff accepting an order into the schedule, never a change the plan could hold.
  const mine = inWindow.filter((a) => targets.has(a.order_id) && a.what !== "confirm order").filter((a) => {
    if (!days.length) return true;
    const ds = actDays(a, orders.get(a.order_id));
    return ds == null || ds.some((d) => days.includes(d));
  });
  const v = judge(ops, truthKeys(mine, (id) => orders.get(id)));
  const iso = (n: number) => new Date(n).toISOString();
  return { message_id: email.message_id, ops: ops.map((o) => o.kind), orders: [...targets], window: { from: iso(w.from), to: iso(w.to), cut_by: w.cut_by }, acts: mine.length, ...v };
}

/** The audit acts of the gold copy, once per process. */
let _acts: { staff: Act[]; bot: Act[] } | null = null;
export function goldActs(ix: Index): { staff: Act[]; bot: Act[] } {
  if (!_acts) { const rows = gold<any[]>("timeline.json"), owner = ownerIndex(ix.orders, rows); _acts = { staff: actsOf(rows, owner), bot: actsOf(rows, owner, "bot") }; }
  return _acts;
}
