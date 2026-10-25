// ============================================================================
// The time-correct world (OPERATING §8.7): OnSinch, the links and the thread as they stood
// when one email arrived, rebuilt from the 10-23 snapshot and the audit rows.
// ----------------------------------------------------------------------------
// Orders: only those created before the email. Each one rolled back to the email's time:
//   - jobs, teams and shifts created after it are removed (their own `created` field);
//   - every logged field change after it is undone, newest first, from the audit row's `old`;
//   - a cancel after it reopens the order (status -1 -> 0; the audit row carries no old status).
// What cannot be rolled back is COUNTED per email, never guessed (TimeWorld.limits):
//   - a part deleted after the email (its content is gone with it);
//   - an order that existed then and is absent now. The bot's own creates are rebuilt from the
//     create_order op it sent; anything else deleted cannot be;
//   - a change after the audit copy ends (22:51Z 10-22; the snapshot was taken 01:45Z 10-23);
//   - a part modified after the email with no audit row explaining it (an unlogged change:
//     only 8 audit actions were fetched, and a venue change is none of them);
//   - a link whose state at the time is unknown (links.json holds today's state).
// Companies, contacts, places and professions carry no timestamps and are as of the snapshot.
//
// AUDIT IDS ARE NOT ONE KIND (data-map.md:211): an Order common_change, cancel, confirm, copy or
// delete row names the order by its NUMBER; order_create and order_created_via_api by its id;
// Job, SlotTeam and Slot rows by id. A delete row is "under parent <id>, child <data> deleted".
// Slot beginning/end in audit rows are UTC "YYYY-MM-DD HH:MM:SS" (927 of 929 agree with the
// snapshot where no later change exists).
// ============================================================================
import type { World } from "../../app/lib/v2/interpret/plan";
import { normName } from "../../app/lib/engine/resolve";
import { shiftWindow } from "../../app/lib/v2/bot/ops";
import { gold, type GoldDecision } from "./data";

type Change = { at: number; id: number; diff: Record<string, { old: unknown; new: unknown }> };
type Delete = { at: number; order_id: number | null; parent: string; child: string };
const T = (s: unknown) => Date.parse(String(s ?? "")) || 0;
const LIVE = new Set(["linked", "relinked"]);

/** Built once per process: the snapshot and the audit, indexed for rollback. */
export class Index {
  readonly orders: any[];
  readonly byId = new Map<number, any>();
  readonly byNo = new Map<string, any>();
  readonly byCompany = new Map<number, any[]>();
  readonly changes = new Map<string, Change[]>();
  readonly cancels = new Map<string, number[]>();
  readonly deletes: Delete[] = [];
  /** Every audit row touching an entity, any action: the times, for "modified with no row". */
  readonly touched = new Map<string, number[]>();
  /** Orders that existed at some point and are absent from the snapshot. */
  readonly absent: { id: number; number: string | null; via: string; company_id: number | null; from: number; to: number | null; record: any | null }[] = [];
  readonly companies: any[];
  readonly places: any[];
  readonly professions: any[];
  readonly links: any[];
  readonly decisions: GoldDecision[];
  readonly timelineEnd: number;
  readonly floorCreated: number;
  /** Shift creation times with the highest place id in use by then: place ids only grow, and places carry no date. */
  readonly placeUse: { at: number; max: number }[] = [];

  constructor() {
    this.orders = gold<any[]>("orders.json");
    this.companies = gold<any[]>("companies.json");
    this.places = gold<any[]>("places.json");
    this.professions = gold<any[]>("professions.json");
    this.links = gold<any[]>("links.json");
    this.decisions = gold<GoldDecision[]>("decisions.json");
    const partOrder = new Map<string, number>();
    for (const o of this.orders) {
      this.byId.set(Number(o.id), o);
      this.byNo.set(String(o.number), o);
      this.byCompany.set(Number(o.company_id), [...(this.byCompany.get(Number(o.company_id)) ?? []), o]);
      for (const j of o.Job ?? []) {
        partOrder.set(`Job:${j.id}`, Number(o.id));
        for (const t of j.SlotTeam ?? []) { partOrder.set(`SlotTeam:${t.id}`, Number(o.id)); for (const s of t.Slot ?? []) partOrder.set(`Slot:${s.id}`, Number(o.id)); }
      }
    }
    this.floorCreated = Math.min(...this.orders.map((o) => T(o.created)));
    const uses = this.orders.flatMap((o) => (o.Job ?? []).flatMap((j: any) => (j.SlotTeam ?? []).flatMap((t: any) => (t.Slot ?? []).map((s: any) => ({ at: T(s.created), pid: Number(s.SlotLocation?.place_id) || 0 })))))
      .sort((a: { at: number }, b: { at: number }) => a.at - b.at);
    let mx = 0;
    for (const u of uses) { mx = Math.max(mx, u.pid); this.placeUse.push({ at: u.at, max: mx }); }
    const rows = gold<any[]>("timeline.json").map((r) => ({ ...r, d: JSON.parse(r.data), at: T(r.created) })).sort((a, b) => a.at - b.at || a.id - b.id);
    this.timelineEnd = rows[rows.length - 1].at;
    const created = new Map<number, { at: number; number: string | null; via: string }>();
    const copies: { at: number; number: string }[] = [];
    const noToId = new Map<string, number>();
    for (const r of rows) {
      const m = r.d.model, id = String(r.d.id);
      // A created part's order, from its path ("Order:13617/Job:13897/..."), for parts deleted since.
      const path = String(r.d.data?.path ?? "");
      const po = /^Order:(\d+)/.exec(path)?.[1];
      if (po) for (const seg of path.split("/").slice(1)) partOrder.set(seg, Number(po));
      if (r.action === "order_create" || r.action === "order_created_via_api") {
        created.set(Number(id), { at: r.at, number: r.d.data?.number != null ? String(r.d.data.number) : null, via: r.action });
        if (r.d.data?.number != null) noToId.set(String(r.d.data.number), Number(id));
      }
      // A copy names the new order by its number only.
      if (r.action === "order_create_by_copy" && !this.byNo.has(id)) copies.push({ at: r.at, number: id });
      const key = m === "Order" && r.action !== "order_create" && r.action !== "order_created_via_api" ? `Order#${id}` : `${m}:${id}`;
      this.touched.set(key, [...(this.touched.get(key) ?? []), r.at]);
      if (r.action === "common_change" && r.d.diffChanges?.[m]) this.changes.set(key, [...(this.changes.get(key) ?? []), { at: r.at, id: r.id, diff: r.d.diffChanges[m] }]);
      if (r.action === "order_cancel") this.cancels.set(id, [...(this.cancels.get(id) ?? []), r.at]);
      if (r.action === "common_delete") {
        const childKey = `${r.d.data?.model}:${r.d.data?.id}`;
        const order_id = m === "Order" ? (this.byNo.get(id)?.id ?? noToId.get(id) ?? null) : (partOrder.get(`${m}:${id}`) ?? partOrder.get(childKey) ?? null);
        this.deletes.push({ at: r.at, order_id: order_id == null ? null : Number(order_id), parent: key, child: childKey });
        this.touched.set(childKey, [...(this.touched.get(childKey) ?? []), r.at]);
      }
    }
    // Orders created since the audit copy began and absent now. The bot's own are rebuilt from its op.
    const botOps = new Map<number, { op: any; company_id: number; at: number }>();
    for (const d of this.decisions) for (const [i, e] of (d.executed ?? []).entries()) {
      const oid = Number(e?.detail?.order_id), op = d.decision?.ops?.[i]?.op;
      if (oid > 0 && op?.kind === "create_order") botOps.set(oid, { op, company_id: Number(op.company_id) || Number(d.company_id) || 0, at: T(d.created_at) });
    }
    const deletedAt = (no: string | null) => this.deletes.find((x) => x.parent === `Order#${no}`)?.at ?? null;
    for (const [id, c] of created) {
      if (this.byId.has(id)) continue;
      const bot = botOps.get(id);
      this.absent.push({ id, number: c.number, via: c.via, company_id: bot?.company_id ?? null, from: c.at, to: deletedAt(c.number), record: bot ? botOrder(id, c.number, bot.company_id, bot.op, c.at) : null });
    }
    for (const c of copies) this.absent.push({ id: 0, number: c.number, via: "order_create_by_copy", company_id: null, from: c.at, to: deletedAt(c.number), record: null });
    // Deleted since the audit copy began, created before it: existed from an unknown time until the delete.
    const known = new Set(this.absent.map((a) => `Order#${a.number}`));
    for (const d of this.deletes) if (d.parent.startsWith("Order#") && !this.byNo.has(d.parent.slice(6)) && !known.has(d.parent)) {
      known.add(d.parent);
      this.absent.push({ id: 0, number: d.parent.slice(6), via: "created before the audit copy", company_id: null, from: 0, to: d.at, record: null });
    }
  }
}

/** The highest place id any shift created by `at` used: a place above it may not have existed yet. */
export function placeCeiling(ix: Index, at: number): number {
  const u = ix.placeUse;
  let lo = 0, hi = u.length - 1, best = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (u[m].at <= at) { best = u[m].max; lo = m + 1; } else hi = m - 1; }
  return best;
}

/** An order as the bot created it, in the API's nested read shape, from the create_order op it sent. */
function botOrder(id: number, number: string | null, company_id: number, op: any, at: number) {
  const iso = new Date(at).toISOString();
  return {
    id, number: number ?? "", company_id, status: 0, name: op.job_name ?? "", intern_name: op.po ?? "", created: iso, modified: iso, creator: 2257, modifier: 2257, rebuilt_from_bot_op: true,
    Job: [{ id: -id, order_id: id, created: iso, modified: iso, SlotTeam: (op.shifts ?? []).map((s: any, n: number) => {
      const w = shiftWindow(s.date, s.start, s.end);
      return { id: -(id * 100 + n), name: s.name ?? "Crew", cancelled: false, created: iso, modified: iso,
        Slot: (s.positions ?? []).map((p: any, k: number) => ({ id: -(id * 10000 + n * 100 + k), beginning: w.beginning, end: w.end, size: Number(p.size), role: p.role === "crew_chief" ? 1 : 0,
          profession_id: Number(p.profession_id), cancelled: false, created: iso, modified: iso, slotlocation_id: null, SlotLocation: { place_id: Number(s.place_id) } })) };
    }) }],
  };
}

/** An audit row's `old`, in the snapshot field's own type. */
function coerce(field: string, old: unknown, cur: unknown): unknown {
  if (old === null || old === undefined) return old ?? null;
  if ((field === "beginning" || field === "end") && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(String(old))) return String(old).replace(" ", "T") + "+00:00";
  if (typeof cur === "number") return old === "" ? null : Number(old);
  if (typeof cur === "boolean") return old === true || old === 1 || old === "1";
  return old;
}

export type Limits = {
  orders_read: number;
  parts_deleted_after: number;
  status_inferred: number;
  changed_after_audit_end: number;
  modified_without_audit_row: number;
  absent_rebuilt: number;
  history_may_be_cut: boolean;
};

/** One email's world: OnSinch as it stood at `at`. */
export class TimeWorld implements World {
  readonly fake = true;
  readonly limits: Limits = { orders_read: 0, parts_deleted_after: 0, status_inferred: 0, changed_after_audit_end: 0, modified_without_audit_row: 0, absent_rebuilt: 0, history_may_be_cut: false };
  private memo = new Map<number, any>();
  private counted = new Set<number>();
  constructor(private ix: Index, readonly at: number) {}

  private visible = (o: any) => T(o.created) <= this.at;

  private rolled(o: any): any {
    const id = Number(o.id);
    if (this.memo.has(id)) return this.memo.get(id);
    const at = this.at, ix = this.ix;
    const x = structuredClone(o);
    const keep = (e: any) => !e?.created || T(e.created) <= at;
    x.Job = (x.Job ?? []).filter(keep).map((j: any) => ({ ...j, SlotTeam: (j.SlotTeam ?? []).filter(keep).map((t: any) => ({ ...t, Slot: (t.Slot ?? []).filter(keep) })) }));
    const parts: [string, any][] = [[`Order#${x.number}`, x]];
    for (const j of x.Job) { parts.push([`Job:${j.id}`, j]); for (const t of j.SlotTeam) { parts.push([`SlotTeam:${t.id}`, t]); for (const s of t.Slot) parts.push([`Slot:${s.id}`, s]); } }
    let afterEnd = false, unexplained = false;
    for (const [key, e] of parts) {
      if (T(e.modified) > ix.timelineEnd) afterEnd = true;
      if (T(e.modified) > at && !(ix.touched.get(key) ?? []).some((t) => t > at)) unexplained = true;
      const later = (ix.changes.get(key) ?? []).filter((c) => c.at > at).sort((a, b) => b.at - a.at || b.id - a.id);
      for (const c of later) for (const [f, v] of Object.entries(c.diff)) if (v && typeof v === "object" && "old" in v) e[f] = coerce(f, v.old, e[f]);
      // What staff did after the email did not exist then: the planner's "edited since" reads these.
      if (T(e.modified) > at) e.modified = new Date(Math.max(T(e.created), ...(ix.touched.get(key) ?? []).filter((t) => t <= at))).toISOString();
    }
    if (Number(x.status) === -1 && (ix.cancels.get(String(x.number)) ?? []).some((t) => t > at)) { x.status = 0; this.count(id, "status_inferred"); }
    if (afterEnd) this.count(id, "changed_after_audit_end");
    if (unexplained) this.count(id, "modified_without_audit_row");
    const del = ix.deletes.filter((d) => d.order_id === id && d.at > at).length;
    if (del) this.limits.parts_deleted_after += del;
    this.memo.set(id, x);
    return x;
  }
  private count(id: number, k: "status_inferred" | "changed_after_audit_end" | "modified_without_audit_row") {
    if (this.counted.has(id * 10 + ["status_inferred", "changed_after_audit_end", "modified_without_audit_row"].indexOf(k))) return;
    this.counted.add(id * 10 + ["status_inferred", "changed_after_audit_end", "modified_without_audit_row"].indexOf(k));
    this.limits[k]++;
  }
  /** Orders absent from the snapshot that existed at `at`. */
  private absentAt(companyId: number | null) {
    return this.ix.absent.filter((a) => a.from <= this.at && (a.to == null || a.to > this.at) && (companyId == null || a.company_id === companyId));
  }

  async companies() { return this.ix.companies; }
  async placesNamed(name: string) {
    return this.ix.places.filter((p) => normName(p.name) === normName(name)).map((p) => ({ id: Number(p.id), name: String(p.name) }));
  }
  async allPlaces() {
    return this.ix.places.map((p) => ({ id: Number(p.id), name: String(p.name ?? ""), address: String(p.address ?? "").trim() || undefined }));
  }
  /** The client's newest 1,000 orders, newest first, as onsinchWorld reads them (process.ts:91-101). */
  async companyOrders(companyId: number) {
    const own = (this.ix.byCompany.get(Number(companyId)) ?? []).filter(this.visible).map((o) => this.rolled(o));
    const rebuilt = this.absentAt(Number(companyId)).filter((a) => a.record).map((a) => a.record);
    this.limits.absent_rebuilt += rebuilt.length;
    this.limits.orders_read += own.length;
    if (own.some((o) => T(o.created) - this.ix.floorCreated < 30 * 864e5)) this.limits.history_may_be_cut = true;
    return [...own, ...rebuilt].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 1000);
  }
  async orderByNumber(n: string) {
    const o = this.ix.byNo.get(String(n).replace(/^R/i, ""));
    if (o && this.visible(o)) return this.rolled(o);
    return this.absentAt(null).find((a) => a.record && a.number === String(n).replace(/^R/i, ""))?.record ?? null;
  }
  async orderById(id: number) {
    const o = this.ix.byId.get(Number(id));
    if (o && this.visible(o)) return this.rolled(o);
    return this.absentAt(null).find((a) => a.record && a.id === Number(id))?.record ?? null;
  }
  async professions() {
    return this.ix.professions.filter((p) => !p.deleted).map((p) => ({ id: String(p.id), name: String(p.name ?? "").trim() }));
  }

  /** Orders that existed at `at`, are absent now, and cannot be rebuilt (deleted by staff: content gone). Company unknown. */
  absentUnrebuildable(): { staff: number; api: number } {
    const gone = this.absentAt(null).filter((a) => !a.record);
    return { staff: gone.filter((a) => a.via !== "order_created_via_api").length, api: gone.filter((a) => a.via === "order_created_via_api").length };
  }

  /**
   * The thread's order at `at` (threadOrder.ts linkedOrderId): a live job_links row first, newest
   * first; else an order a decision on the thread wrote or planned on, newest first. Links.json
   * is today's state, so a link seen before `at` and since gone or held is counted, not trusted.
   */
  threadOrderAt(threadId: string): { order_id: number | null; links_state_unknown: number } {
    const seen = this.ix.links.filter((l) => l.thread_id === threadId && T(l.first_seen) <= this.at && Number(l.order_id) > 0);
    const live = seen.filter((l) => LIVE.has(l.state)).sort((a, b) => T(b.first_seen) - T(a.first_seen));
    const unknown = seen.length - live.length;
    if (live.length) return { order_id: Number(live[0].order_id), links_state_unknown: unknown };
    const fromDecisions = this.ix.decisions
      .filter((d) => d.thread_id === threadId && T(d.created_at) <= this.at)
      .flatMap((d) => [
        ...(d.executed ?? []).map((e: any) => Number(e?.detail?.order_id)),
        ...(d.kind === "write" ? (d.decision?.ops ?? []).map((x: any) => Number(x?.op?.order_id)) : []),
      ].filter((n) => n > 0).map((n) => ({ n, at: T(d.created_at) })))
      .sort((a, b) => b.at - a.at);
    return { order_id: fromDecisions[0]?.n ?? null, links_state_unknown: unknown };
  }
}
