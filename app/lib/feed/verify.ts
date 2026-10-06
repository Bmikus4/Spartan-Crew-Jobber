// ============================================================================
// The feed's verifier: evidence that a person dealt with an item, read from OnSinch.
// ----------------------------------------------------------------------------
// GETs ONLY, and structurally so: every call goes through readOnly(), which refuses any
// other method before it reaches the network (test/feedReadsOnly.ts). The engine's own
// writes are real and this must never be able to make one.
//
// Four sources:
//   (d) the order for a need the engine never bound, found by the thread's R number or
//       client reference, or by its dates narrowed by venue and exact shift times, or
//       for a client with no company by the sender's name on that day's order. Run
//       first, so an order found this round is watched by (a) and (c) at once.
//       On 2026-10-04, 9 of 12 open needs were jobs staff had already booked by hand.
//   (a) the timeline log. It records every STAFF edit field by field and never the
//       API's (0 of 2,901 rows in 32 hours, 2026-10-03), so each row is a person. It is
//       sorted oldest-first, so the newest rows are on the LAST page.
//   (c) the order's own stamps, once per item: a person's edit or creation after the
//       client's email, or every shift the thread asks for already on a block a person
//       made.
//
// The sweep's "holds" is NOT evidence: straight after a write OnSinch always matches what
// the engine wrote, so it would turn every check green the moment it appeared. That is
// why (c) counts only blocks whose creator is not the engine.
// ============================================================================
import { OnsinchClient, type Transport } from "../engine/onsinch";
import { matchExistingOrder, type OrderRec } from "../engine/resolve";
import { staffChangeSince } from "../engine/reconcile";
import { londonDay, type FeedCard, type FeedItem, type FeedMark, type FeedWant } from "./project";

export const VERIFY_EVERY_MS = 5 * 60_000;
export const VERIFY_BUDGET_MS = 8_000;
/** Pages read back per round. ~90 staff rows an hour, 100 to a page. */
const MAX_PAGES = 6;
/** More same-day orders than this and the day is too crowded to pick from; a person ticks it. */
const MAX_CANDIDATES = 6;

export function readOnly(t: Transport): Transport {
  return (method, path) =>
    method === "GET" ? t("GET", path) : Promise.reject(new Error(`the live feed is read-only: refused ${method} ${path}`));
}

export interface VerifyDeps {
  transport: Transport;
  claim(everyMs: number): Promise<{ timeline_last_id: number | null } | null>;
  save(timeline_last_id: number | null, note: string): Promise<void>;
  addMark(m: Omit<FeedMark, "at">): Promise<void>;
}

/**
 * The fields that change what crew turn up where and when, or what the client is billed
 * against. Slot.group_number, Slot.Tag, Slot.hidden, Attendance.Tag and the description
 * fields move constantly and mean nothing about the order being right.
 */
const DECISION: Record<string, string> = {
  "Order.intern_name": "PO", "Order.name": "order name", "Order.happening": "date",
  "SlotTeam.name": "block",
  "Slot.size": "crew", "Slot.beginning": "start", "Slot.end": "end", "Slot.profession_id": "role", "Slot.cancelled": "cancelled",
};

interface TimelineRow { id: number; action: string; data: string | Record<string, unknown>; creator: number | string; created: string }
interface Change { at: number; creator: number; text: string; model: string; ref: string; order_api_id?: number }

const hhmm = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(ms);
function show(v: unknown): string {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && Number.isFinite(Date.parse(s))) return hhmm(Date.parse(s));
  return s.length > 24 ? s.slice(0, 23) + "…" : s || "blank";
}

/** One timeline row as a change worth reporting, or null. */
export function changeOf(row: TimelineRow, engine: number | null): Change | null {
  const creator = Number(row.creator);
  if (engine && creator === engine) return null;
  const at = Date.parse(row.created);
  if (!Number.isFinite(at)) return null;
  let d: any;
  try { d = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch { return null; }
  if (row.action === "common_change") {
    const diff = d?.diffChanges?.[d?.model] ?? {};
    const parts = Object.entries(diff)
      .filter(([f]) => DECISION[`${d.model}.${f}`])
      .map(([f, v]: [string, any]) => `${DECISION[`${d.model}.${f}`]} ${show(v?.old)} → ${show(v?.new)}`);
    if (!parts.length) return null;
    return { at, creator, text: parts.join(", "), model: String(d.model), ref: String(d.id) };
  }
  // A block or a position ADDED by hand carries its order in its path.
  if (row.action === "common_create" && (d?.model === "Slot" || d?.model === "SlotTeam")) {
    const owner = /^Order:(\d+)/.exec(String(d?.data?.path ?? "").replace(/\\\//g, "/"));
    if (!owner) return null;
    return { at, creator, text: d.model === "Slot" ? "crew added" : "block added", model: String(d.model), ref: String(d.id), order_api_id: Number(owner[1]) };
  }
  return null;
}

/** The open need on a card that evidence could close, or null. An engine write is done already. */
/** A check on an engine write is watched like an update: a staff edit after the write closes it. */
function openOrderItem(c: FeedCard): FeedItem | null {
  const it = c.items.find((i) => i.kind !== "needs-reply");
  return it && !it.green ? it : null;
}

/** staffChangeSince's sentence as evidence: what was touched, and the latest stamp. */
function stampChange(who: string): Change {
  const parts = who.split("; ").map((p) => /^(.*) by user (\d+) at (\S+)$/.exec(p)).filter((m): m is RegExpExecArray => !!m);
  const at = Math.max(...parts.map((m) => Date.parse(m[3] + ":00Z")).filter(Number.isFinite), 0);
  const what = [...new Set(parts.map((m) => m[1].replace(/^the /, "").replace(/^block \d+$/, "a block")))].join(", ");
  const last = parts.find((m) => Date.parse(m[3] + ":00Z") === at);
  return { at, creator: Number(last?.[2]) || 0, text: `${what || "the order"} edited after the client's email`, model: "Order", ref: "" };
}

/**
 * The order, job or a block CREATED by a person after the client's email. staffChangeSince
 * reads only the last modifier, so an order a person built and the engine then touched
 * (Holmes R11310, 2026-09-30) showed no person at all.
 */
function createdSince(order: any, sinceMs: number, engine: number): Change | null {
  const recs: Array<[string, any]> = [["order", order]];
  for (const job of order?.Job ?? []) {
    recs.push(["order", job]);
    for (const team of job?.SlotTeam ?? []) recs.push(["a block", team]);
  }
  const hits = recs.filter(([, r]) => Number(r?.creator) > 0 && Number(r.creator) !== engine && Date.parse(String(r?.created)) > sinceMs);
  if (!hits.length) return null;
  const latest = hits.reduce((a, b) => (Date.parse(b[1].created) > Date.parse(a[1].created) ? b : a));
  return { at: Date.parse(latest[1].created), creator: Number(latest[1].creator), text: `${[...new Set(hits.map(([w]) => w))].join(", ")} made by staff after the client's email`, model: "Order", ref: "" };
}

interface Block { b: number; e: number; place: number | null; creator: number }
function blocksOf(order: any): Block[] {
  const out: Block[] = [];
  for (const job of order?.Job ?? []) for (const team of job?.SlotTeam ?? []) {
    if (Number(team?.cancelled) > 0 || team?.cancelled === true) continue;
    for (const s of team?.Slot ?? []) {
      if (Number(s?.cancelled) > 0 || s?.cancelled === true) continue;
      const loc = Array.isArray(s?.SlotLocation) ? s.SlotLocation[0] : s?.SlotLocation;
      const b = Date.parse(String(s?.beginning)), e = Date.parse(String(s?.end));
      if (Number.isFinite(b) && Number.isFinite(e)) out.push({ b, e, place: Number(loc?.place_id) > 0 ? Number(loc.place_id) : null, creator: Number(team?.creator) || 0 });
    }
  }
  return out;
}
const sameShift = (w: FeedWant["shifts"][number], k: Block) => w.b === k.b && w.e === k.e && (w.p == null || k.place === w.p);

/**
 * Every shift the thread asks for is already on a block a PERSON made, and the order has
 * nothing on a day the thread does not ask for. The second half is what keeps Lux R11359
 * open: all ten asked-for days are there, and so is a Monday the client cancelled.
 */
function holdsAll(order: any, want: FeedWant | undefined, engine: number): boolean {
  if (!want?.shifts.length) return false;
  const blocks = blocksOf(order);
  const days = new Set(want.shifts.map((w) => londonDay(w.b)));
  return want.shifts.every((w) => blocks.some((k) => k.creator > 0 && k.creator !== engine && sameShift(w, k)))
    && blocks.every((k) => days.has(londonDay(k.b)));
}

type Nested = { teams: Set<string>; slots: Set<string>; raw: any };
const nestedCache = new Map<number, { at: number; v: Nested | null }>();
async function nested(client: OnsinchClient, order_id: number, now: number): Promise<Nested | null> {
  const hit = nestedCache.get(order_id);
  if (hit && now - hit.at < 10 * 60_000) return hit.v;
  const o = await client.orderWithBlocks(order_id);
  const v: Nested | null = o ? { teams: new Set(), slots: new Set(), raw: o } : null;
  for (const job of o?.Job ?? []) for (const team of job?.SlotTeam ?? []) {
    v!.teams.add(String(team?.id));
    for (const s of team?.Slot ?? []) v!.slots.add(String(s?.id));
  }
  nestedCache.set(order_id, { at: now, v });
  return v;
}

/** A company's orders, or for a sender with no company the tenant's newest 200. Ten minutes old at most. */
const poolCache = new Map<string, { at: number; rows: any[] }>();
async function pool(client: OnsinchClient, t: Transport, company_id: number | null, now: number): Promise<any[]> {
  const key = company_id ? `c${company_id}` : "recent";
  const hit = poolCache.get(key);
  if (hit && now - hit.at < 10 * 60_000) return hit.rows;
  let rows: any[] = [];
  if (company_id) rows = (await client.companyOrdersWithJob(company_id)) as any[];
  else for (const p of [1, 2]) {
    const r = await t("GET", `/orders?limit=100&page=${p}&with=Job`);
    const d = r.status < 400 && Array.isArray(r.data?.data) ? r.data.data : [];
    rows.push(...d);
    if (d.length < 100) break;
  }
  poolCache.set(key, { at: now, rows });
  return rows;
}

export function __resetVerifyCache(): void { nestedCache.clear(); poolCache.clear(); engineId = undefined; }

let engineId: Promise<number | null> | undefined;
function engineUser(t: Transport): Promise<number | null> {
  engineId ??= t("GET", "/users/profile").then((r) => {
    const d = r?.data?.data ?? r?.data;
    const id = Number(Array.isArray(d) ? d[0]?.id : d?.id);
    return id > 0 ? id : null;
  }, () => null);
  return engineId;
}

/** Mailbox words that name a desk, not a person, so they cannot pick a client's order out of a day. */
const DESK = new Set(["info", "admin", "office", "hello", "bookings", "booking", "events", "accounts", "contact", "mail", "team", "enquiries", "sales"]);
const senderNames = (sender: string | null) =>
  (sender ?? "").split("@")[0].toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !DESK.has(w));

type Bound = { order_id: number; r_number: string | null; j_number: string | null };
const boundOf = (o: any): Bound => ({
  order_id: Number(o.id),
  r_number: o.number != null && String(o.number) ? `R${o.number}` : null,
  j_number: Number(o.Job?.[0]?.id) > 0 ? `J${o.Job[0].id}` : null,
});

/**
 * The OnSinch order a need with no bound order is about, or null when nothing is certain.
 * A refusal leaves the card open, which a person can tick; a wrong pick would turn a real
 * outstanding job green, which nobody would look at again.
 */
async function findOrder(client: OnsinchClient, t: Transport, card: FeedCard, want: FeedWant | undefined, now: number): Promise<{ o: any; by: string } | null> {
  const rows = await pool(client, t, card.company_id, now);
  const names = senderNames(want?.sender ?? null);

  // The thread's own reference names the job outright, dated or not.
  const refs = (want?.refs ?? []).map((r) => r.toLowerCase());
  const named = rows.filter((o) => (want?.r_numbers ?? []).includes(String(o.number ?? ""))
    || refs.some((r) => `${o.name ?? ""} ${o.intern_name ?? ""}`.toLowerCase().includes(r)));
  if (named.length === 1) return { o: named[0], by: "its reference" };
  if (!card.dates.length) return null;

  const span = (o: any): [string, string] => {
    const j = o.Job?.[0];
    const a = String(j?.min_beginning ?? o.happening ?? "").slice(0, 10);
    return [a, String(j?.max_end ?? "").slice(0, 10) || a];
  };
  let cands = rows.filter((o) => { const [a, b] = span(o); return !!a && card.dates.some((d) => d >= a && d <= b); });
  if (!card.company_id) cands = cands.filter((o) => names.some((n) => String(o.name ?? "").toLowerCase().includes(n)));
  else {
    // The engine's own rule first: date, venue text and a named R number.
    const m = matchExistingOrder(card.dates[0], rows as OrderRec[], { days: card.dates, location_text: card.venue ?? undefined, r_numbers: want?.r_numbers });
    if (m && "order_id" in m) {
      const o = rows.find((x) => Number(x.id) === m.order_id);
      if (o) return { o, by: "date and venue" };
    }
  }
  if (!cands.length || cands.length > MAX_CANDIDATES) return null;

  const scored: Array<{ o: any; place: boolean; shifts: number }> = [];
  for (const o of cands) {
    const n = await nested(client, Number(o.id), now).catch(() => null);
    const blocks = blocksOf(n?.raw);
    scored.push({
      o,
      place: want?.place_id != null && blocks.some((k) => k.place === want.place_id),
      shifts: (want?.shifts ?? []).filter((w) => blocks.some((k) => sameShift(w, k))).length,
    });
  }
  if (scored.length === 1) {
    const [s] = scored;
    // A company's only order that day is still a different job if it is somewhere else.
    if (!card.company_id || want?.place_id == null || s.place || s.shifts > 0) return { o: s.o, by: card.company_id ? "the only order on those days" : "the sender's name on that day's order" };
    return null;
  }
  const score = (s: { place: boolean; shifts: number }) => (s.place ? 100 : 0) + s.shifts;
  const best = Math.max(...scored.map(score));
  const top = scored.filter((s) => score(s) === best);
  return best > 0 && top.length === 1 ? { o: top[0].o, by: top[0].place ? "venue" : "shift times" } : null;
}

export async function verify(
  cards: FeedCard[], now: number, deps: VerifyDeps, marks: FeedMark[] = [], budgetMs = VERIFY_BUDGET_MS,
  wants: Map<string, FeedWant> = new Map(),
): Promise<{ ran: boolean; wrote: number; note: string }> {
  const claim = await deps.claim(VERIFY_EVERY_MS);
  if (!claim) return { ran: false, wrote: 0, note: "not due" };
  const deadline = Date.now() + budgetMs;
  const t = readOnly(deps.transport);
  const client = new OnsinchClient(t);
  const engine = await engineUser(t);
  let wrote = 0;
  const notes: string[] = [];

  // Orders found for unbound needs on earlier rounds, by item.
  const matched = new Map<string, Bound>();
  for (const m of marks) {
    const e = m.evidence as Partial<Bound> | null;
    if (m.mark === "matched" && Number(e?.order_id) > 0) matched.set(m.item_key, { order_id: Number(e!.order_id), r_number: e!.r_number ?? null, j_number: e!.j_number ?? null });
  }
  const bound = (c: FeedCard): Bound | null => {
    if (c.order_id) return { order_id: c.order_id, r_number: c.r_number, j_number: c.j_number };
    const it = openOrderItem(c);
    return (it && matched.get(it.item_key)) ?? null;
  };

  // (d) the order for a need nobody bound
  let foundOrders = 0;
  for (const card of cards) {
    const item = openOrderItem(card);
    if (!item || card.order_id || matched.has(item.item_key)) continue;
    const want = wants.get(card.thread_id);
    if (!card.company_id && !senderNames(want?.sender ?? null).length) continue;
    if (!card.dates.length && !want?.refs.length && !want?.r_numbers.length) continue;
    if (Date.now() >= deadline) { notes.push("matcher stopped at the time budget"); break; }
    try {
      const hit = await findOrder(client, t, card, want, now);
      if (!hit) continue;
      const b = boundOf(hit.o);
      const name = b.r_number ?? `#${b.order_id}`;
      if (item.kind === "needs-created") {
        await deps.addMark({
          item_key: item.item_key, thread_id: card.thread_id, mark: "order-found", by: null,
          evidence: { text: `order ${name} is in OnSinch`, order_id: b.order_id, r_number: b.r_number, by: hit.by },
        });
        wrote++;
      } else {
        // An update is not done because its order exists: (a) and (c) now watch that order.
        await deps.addMark({ item_key: item.item_key, thread_id: card.thread_id, mark: "matched", by: null, evidence: { ...b, text: `${name}, found by ${hit.by}` } });
        matched.set(item.item_key, b);
      }
      foundOrders++;
    } catch (err) {
      notes.push(`matcher: ${String((err as Error)?.message ?? err).slice(0, 60)}`);
    }
  }

  const blue = cards.filter((c) => bound(c) && openOrderItem(c) && openOrderItem(c)!.kind !== "needs-created");
  const found = new Map<FeedCard, Change[]>();

  // (a) the timeline, newest page back to the cursor
  let cursor = claim.timeline_last_id;
  let timelineOk = true;
  try {
    const first = await t("GET", "/timelineAudits?limit=100&page=1");
    const pageCount = Number(first?.data?.pagination?.pageCount);
    if (first.status >= 400 || !Number.isInteger(pageCount) || pageCount < 1) throw new Error(`timeline ${first.status}`);
    const rows: TimelineRow[] = [];
    for (let p = pageCount, n = 0; p >= 1 && n < (cursor ? MAX_PAGES : 2) && Date.now() < deadline; p--, n++) {
      const r = p === 1 ? first : await t("GET", `/timelineAudits?limit=100&page=${p}`);
      if (r.status >= 400) throw new Error(`timeline page ${p}: ${r.status}`);
      const page = (r.data?.data ?? []) as TimelineRow[];
      rows.push(...page);
      if (!cursor || page.some((x) => Number(x.id) <= cursor!)) break;
    }
    const fresh = rows.filter((r) => !cursor || Number(r.id) > cursor);
    const changes = fresh.map((r) => changeOf(r, engine)).filter((c): c is Change => !!c);

    // Order rows name the R number, Job rows the J number, a create its api order id;
    // a Slot or SlotTeam row names only itself, so those need the order's own blocks.
    const needsNested = changes.some((c) => (c.model === "Slot" || c.model === "SlotTeam") && !c.order_api_id);
    for (const card of blue) {
      const item = openOrderItem(card)!;
      const b = bound(card)!;
      let n: Nested | null = null;
      if (needsNested && Date.now() < deadline) n = await nested(client, b.order_id, now).catch(() => null);
      const mine = changes.filter((c) => c.at > item.at && (
        (c.model === "Order" && b.r_number === `R${c.ref}`) ||
        (c.model === "Job" && b.j_number === `J${c.ref}`) ||
        (c.order_api_id !== undefined && c.order_api_id === b.order_id) ||
        (c.order_api_id === undefined && c.model === "SlotTeam" && !!n?.teams.has(c.ref)) ||
        (c.order_api_id === undefined && c.model === "Slot" && !!n?.slots.has(c.ref))));
      if (mine.length) found.set(card, mine);
    }
    const newest = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), cursor ?? 0);
    cursor = newest || cursor;
    notes.push(`timeline: ${fresh.length} new rows, ${changes.length} staff changes`);
  } catch (err) {
    timelineOk = false;
    notes.push(`timeline unreadable (${String((err as Error)?.message ?? err).slice(0, 80)}), used order stamps`);
  }

  /**
   * (c) The stamps on the order itself. Every open item gets this ONCE, for its history:
   * the timeline cursor only sees edits from the day it was first set (2026-10-03), and
   * 13 of 17 open updates on 2026-10-04 had been edited by staff before that. When the
   * timeline cannot be read, every item gets it every round instead.
   *
   * The once-only mark is "stamps", not the earlier "history": history was read with
   * modifier stamps alone, and the creator stamps and the shift comparison added on
   * 2026-10-04 have to reach the items it had already passed over.
   */
  const stampsDone = new Set(marks.filter((m) => m.mark === "stamps").map((m) => m.item_key));
  const stampsRead: FeedCard[] = [];
  if (engine) {
    for (const card of blue) {
      const item = openOrderItem(card)!;
      if (found.has(card) || (timelineOk && stampsDone.has(item.item_key))) continue;
      if (Date.now() >= deadline) { notes.push("stamps check stopped at the time budget"); break; }
      const b = bound(card)!;
      const n = await nested(client, b.order_id, now).catch(() => null);
      if (!n) continue;
      const who = staffChangeSince(n.raw, item.at, engine);
      const made = who ? null : createdSince(n.raw, item.at, engine);
      if (who) found.set(card, [stampChange(who)]);
      else if (made) found.set(card, [made]);
      else if (holdsAll(n.raw, wants.get(card.thread_id), engine)) found.set(card, [{ at: 0, creator: 0, text: "every shift asked for", model: "Order", ref: "" }]);
      if (timelineOk) stampsRead.push(card);
    }
  }

  for (const [card, ch] of found) {
    const item = openOrderItem(card)!;
    const latest = ch.reduce((a, b) => (b.at > a.at ? b : a));
    const text = [...new Set(ch.map((c) => c.text))].slice(0, 3).join(", ");
    // A shift comparison has no moment a person acted, so it carries no time and says so.
    await deps.addMark({
      item_key: item.item_key, thread_id: card.thread_id, mark: "staff-edit", by: null,
      evidence: latest.at ? { text, at: new Date(latest.at).toISOString(), creator: latest.creator || null } : { text, held: true },
    });
    wrote++;
  }

  for (const card of stampsRead) {
    const item = openOrderItem(card)!;
    await deps.addMark({ item_key: item.item_key, thread_id: card.thread_id, mark: "stamps", by: null, evidence: null });
  }

  notes.push(`${found.size} staff-edited, ${foundOrders} found`);

  const note = notes.join("; ");
  await deps.save(timelineOk ? cursor : null, note);
  return { ran: true, wrote, note };
}
