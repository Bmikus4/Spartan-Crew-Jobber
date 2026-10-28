// ============================================================================
// The planner: grounded requests + what OnSinch holds now -> bot operations, or the reason a
// person must do it (shown on the office TV), or no action with the reason. Nothing here writes.
// ----------------------------------------------------------------------------
// All-or-nothing per email: if any request in it cannot be planned, the whole email goes
// to a person. Half an email automated and half by hand is how a change gets done twice.
//
// "Never infer from history unless explicitly requested and the job can be found" (Ben, [DECISIONS V2]
// 10-06). An existing booking is touched only when the email names it: an R number, the
// thread the bot itself booked it in, or the day of a change that exactly one of the
// client's orders has a shift on. A new booking is never attached to an existing order by
// resemblance; it becomes its own order.
// ============================================================================
import type { Op, PositionSpec, ShiftSpec } from "../bot/ops";
import { shiftWindow, utcToLondon } from "../bot/ops";
import { confirms, type Interpretation, type Request } from "./interpret";
import { addMinutes } from "./ground";
import { fillTimes, pastShifts } from "./assume";
import { tradeOf, pickProfession, PROFESSION_NAME, type LiveProfession } from "./professions";
import { matchCompanyBySender, rNumbersIn, normName, domainOfEmail, CONSUMER_DOMAINS } from "../../onsinch/resolve";
import { BOT_USER } from "../evidence";
import { coded } from "../reasons";
import { companiesOf, stampedSince, type ThreadIn, type ThreadMsg, type StateWorld, type Grounded } from "../threadState";
import { identify, covered, refsIn, atVenue, nearStart, placesOn, GENERIC_PLACE, type Facts, type OrderRef } from "../identity";

export type World = {
  companies(): Promise<any[]>;
  placesNamed(name: string): Promise<{ id: number; name: string }[]>;
  /** Every OnSinch place, for names written with an address or a district after them. */
  allPlaces?(): Promise<{ id: number; name: string; address?: string }[]>;
  companyOrders(companyId: number): Promise<any[]>;
  orderByNumber(rNumber: string): Promise<any | null>;
  /** One order by its OnSinch id, nested. */
  orderById?(id: number): Promise<any | null>;
  /** OnSinch's live (not deleted) professions, for a trade found by name (Security). */
  professions?(): Promise<LiveProfession[]>;
};

export type Message = { message_id: string; from: string; subject: string; sentIso: string; text: string };

/** code: stamped when the decision is made (v2/reasons.ts), what the weekly numbers are counted by. */
export type Decision = (
  | { kind: "write"; ops: { source: string; op: Op }[]; why: string[]; defaults?: string[] }
  /**
   * reply: what a person must do is WRITE BACK, not touch an order: a quote, a question, or a
   * booking missing a detail only the client can give. The TV shows it as Needs Reply, never
   * as an order that failed (Ben, 10-11: 1 failed order in 100 is the bar; a question is not one). [DECISIONS V5]
   */
  | { kind: "handoff"; reasons: string[]; reply?: boolean; order_id?: number }
  /** found: the orders that already hold what the email asks for; the thread is linked to one. */
  | { kind: "none"; reason: string; found?: number[] }) & { code?: string };

const handoff = (...reasons: string[]): Decision => ({ kind: "handoff", reasons });
/** The bot creates an order only when its first day is more than this many days after the email; Settings can change it. */
export const CREATE_LEAD_DAYS = 14;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
const ask = (...reasons: string[]): Decision => ({ kind: "handoff", reasons, reply: true });
/** A detail the client did not write: the client is asked, nobody can book it without them. */
const MISSING = /: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;

/**
 * THE CREW CHIEF RULE (Ben, 10-15): 4 or more on a shift carry a Crew Chief, 10+ two, 20+ [DECISIONS V13]
 * three, and every further 10 one more, inside the headcount. Measured 10-15 on 3,145 staff-built
 * shifts counting every seat, drivers and trades included: it matches 96.0% (1-3: 99.2%, 4-9:
 * 93.3%, 10-19: 88.6%). Ops book more than it on 30+ (13 shifts). A chief the client asks for on
 * a smaller shift is booked: no request is refused for its size. The old engine's
 * chiefsForTeam (engine/compose.ts) stops at 3; this one does not, by Ben's rule. [DECISIONS V13]
 */
export function chiefsFor(total: number, asked = false): number {
  if (!Number.isInteger(total) || total < 1) return 0;
  return total < 4 ? (asked ? 1 : 0) : 1 + Math.floor(total / 10);
}

/** A shift of plain crew: its chiefs (chiefsFor) first, the rest as Crew. */
export function positionsFor(total: number, asked = false): PositionSpec[] | null {
  if (!Number.isInteger(total) || total < 1) return null;
  const c = chiefsFor(total, asked);
  const out: PositionSpec[] = c ? [{ size: c, profession_id: "36", role: "crew_chief" }] : [];
  if (total > c) out.push({ size: total - c, profession_id: "1" });
  return out;
}

const teams = (o: any) =>
  ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []))
    .map((t: any) => ({ id: Number(t.id), name: String(t.name ?? ""), raw: t, slots: ([] as any[]).concat(t.Slot ?? []).filter((s: any) => s.cancelled !== true) }))
    .filter((t) => t.slots.length);
const dayOf = (iso: string) => utcToLondon(iso).date;
const SHIFT_WORDS = ["derig", "de-rig", "install", "build", "setup", "set up", "rig", "get in", "get out", "load in", "load out", "breakdown", "strike", "collection", "delivery"];

/** The one shift a change is about, or why there is not exactly one. */
export function targetShift(order: any, r: Request, at?: Set<number> | null): { id: number; slots: any[] } | string {
  const day = r.target?.date ?? r.date;
  // On an order at several venues, the one the email names (identity atVenue, F10).
  const fits = atVenue(order, at);
  let cands = teams(order).filter((t) => t.slots.some((s) => dayOf(s.beginning) === day && fits(s)));
  if (!cands.length) return `no shift on ${day}${at?.size && placesOn(order).size > 1 ? " at the venue written" : ""}`;
  if (cands.length > 1 && r.target?.start) cands = cands.filter((t) => t.slots.some((s) => utcToLondon(s.beginning).time === r.target!.start));
  if (cands.length > 1 && r.target?.quote) {
    const words = SHIFT_WORDS.filter((w) => r.target!.quote.toLowerCase().includes(w));
    if (words.length) cands = cands.filter((t) => words.some((w) => t.name.toLowerCase().replace(/-/g, "").includes(w.replace(/-/g, ""))));
  }
  // "the evening call" (Encore, 10-11): two shifts that day, one starting after 17:00.
  if (cands.length > 1 && r.target?.quote) {
    const q = r.target.quote.toLowerCase();
    const hour = (t: { slots: any[] }) => Number(utcToLondon(t.slots[0].beginning).time.slice(0, 2));
    const band = /\b(evening|night|late)\b/.test(q) ? (h: number) => h >= 17 : /\bmorning\b/.test(q) ? (h: number) => h < 12 : /\bafternoon\b/.test(q) ? (h: number) => h >= 12 && h < 17 : null;
    if (band) cands = cands.filter((t) => band(hour(t)));
  }
  // A time move keeps the shift's length: "move the call for tonight forward by 30mins?
  // 20:30 - 00:30?" (Creative Technology 10-12, two calls that night) is the 4-hour 21:00 one.
  if (cands.length > 1 && r.start && r.end) {
    const mins = (a: string, b: string) => ((Number(b.slice(0, 2)) * 60 + Number(b.slice(3))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3))) + 1440) % 1440;
    const want = mins(r.start, r.end);
    const near = cands.filter((t) => {
      const s0 = utcToLondon(t.slots[0].beginning).time, e0 = utcToLondon(t.slots[0].end).time;
      return mins(s0, e0) === want && Math.min(mins(s0, r.start!), mins(r.start!, s0)) <= 120;
    });
    if (near.length === 1) cands = near;
  }
  if (cands.length !== 1) return `${cands.length} shifts on ${day} could be the one meant`;
  return cands[0];
}

/**
 * A venue as clients write it, reduced to its name: "The Peninsula, 1 Grosvenor Place, ...",
 * "Labs House 15-19 Bloomsbury Way", "BDC in Angel", "Christies". Measured 10-09..10-11: 4 of
 * 44 hand-offs were venues OnSinch holds as "The Peninsula London", "LABS House", "BDC" and
 * "Christie's London". The address, a district after "in", "the", "London" and apostrophes
 * carry no name; what is left must equal a place's name reduced the same way.
 */
export function venueKey(name: string): string {
  return normName(name.split(",")[0].replace(/[‘’']/g, "").replace(/\s+\d[\s\S]*$/, "").replace(/\s+in\s+[a-z ]+$/i, ""))
    .replace(/\b(the|london|venue|uk)\b/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The OnSinch places a venue name means: its exact name, else its name with the address
 * dropped (venueKey). Never a resemblance: a key must equal a key. Several places with one
 * name (146 addresses hold 2 or more) are narrowed to the ones this client has booked before.
 */
async function placesFor(world: World, venue: string, clientOrders: any[] = []): Promise<{ id: number; name: string; byHistory?: true }[]> {
  let hits: { id: number; name: string; address?: string }[] = (await world.placesNamed(venue)).filter((p) => normName(p.name) === normName(venue));
  if (!hits.length) {
    const head = venue.split(",")[0].trim();
    if (head !== venue) hits = (await world.placesNamed(head)).filter((p) => normName(p.name) === normName(head));
  }
  if (!hits.length && world.allPlaces) {
    const key = venueKey(venue);
    // Only a place with an address: "BDC" (6615) has none and no booking in 2,995 orders, while
    // ops book the Business Design Centre as place 29 (Konnect, 10-09).
    if (key.length >= 3) hits = (await world.allPlaces()).filter((p) => p.address && venueKey(p.name) === key);
    // "BDC in Angel" (Konnect, 10-09): a short name in capitals is the initials of exactly one
    // place's name. Ops booked it at the Business Design Centre (29).
    const caps = venue.split(",")[0].trim().split(/\s+/)[0];
    // The whole name's initials count too: venueKey drops "London" and "the", which a client spelling
    // the initials writes (1a14063b8d8dd75c: a new place was made where staff used the client's own,
    // booked 30 times; ADDENDUM R17). Several such places: the one this client has booked.
    if (!hits.length && /^[A-Z]{3,5}$/.test(caps)) {
      const initials = (k: string) => k.split(" ").filter(Boolean).map((w) => w[0]).join("");
      let acr = (await world.allPlaces()).filter((p) => p.address && [venueKey(p.name), normName(p.name)].some((k) => initials(k) === caps.toLowerCase()));
      if (acr.length > 1) {
        const booked = new Set(clientOrders.flatMap((o) => teams(o).flatMap((t) => t.slots.map((x) => Number(x.SlotLocation?.place_id)))));
        acr = acr.filter((p) => booked.has(Number(p.id)));
      }
      if (acr.length === 1) hits = acr;
    }
  }
  // A PLACE THIS CLIENT BOOKS, NAMED IN MORE OR FEWER WORDS. When nothing matches by name, or only places
  // the client never booked, the one place the client has booked whose name words and the email's share
  // at least two, one set holding the other, is the venue. On current mail creates booked a new place, or
  // an unused duplicate (place 7083, no booking ever), where staff used the client's own place, booked 2
  // to 32 times (1a15984719fbd60e, 1a15984f57ab3251, 1a13438a3dd67400; eval/phase-c.md). Exactly one:
  // two such places stay as they were.
  // With no place of that name at all, the one OnSinch place (of 2,319 with an address) that fits the same
  // way is the venue: right and unique on 2 of the 4 current-mail cases, and never a guess between two.
  if (world.allPlaces) {
    const used = new Set(clientOrders.flatMap((o) => teams(o).flatMap((t) => t.slots.map((x) => Number(x.SlotLocation?.place_id)))).filter(Boolean));
    if (!hits.some((h) => used.has(Number(h.id)))) {
      const words = (s: string | null | undefined) => new Set(venueKey(s ?? "").split(" ").filter((w) => w.length > 2));
      const asked = words(venue);
      const fit = (p: { name: string; address?: string }) => {
        const name = words(p.name), shared = [...asked].filter((w) => name.has(w)).length;
        return !!p.address && shared >= 2 && (shared === name.size || shared === asked.size);
      };
      const all = await world.allPlaces();
      const mine = all.filter((p) => used.has(Number(p.id)) && fit(p));
      if (mine.length === 1) return [{ id: Number(mine[0].id), name: mine[0].name, byHistory: true }];
      const any = hits.length ? [] : all.filter(fit);
      if (any.length === 1) return [{ id: Number(any[0].id), name: any[0].name, byHistory: true }];
    }
  }
  // ONE BUILDING, SEVERAL PLACES: 146 addresses hold 2 or more. "Mandarin Oriental" (230) and
  // "Mandarin Oriental Hyde Park, London" (468) are both 66 Knightsbridge, and EMS moved from
  // 230 to 468 in May 2026; booked by name the order went to 230 (10-09). The building's
  // places are narrowed to the one this client booked most recently, when it booked any.
  if (hits.length && clientOrders.length && world.allPlaces) {
    const all = await world.allPlaces();
    const addr = (p: { address?: string }) => normName(p.address ?? "");
    const full = hits.map((h) => all.find((p) => Number(p.id) === Number(h.id)) ?? h);
    const sameBuilding = all.filter((p) => p.address && full.some((h) => h.address && addr(h) === addr(p)));
    if (sameBuilding.length > 1 || hits.length > 1) {
      const pool = new Map([...full, ...sameBuilding].map((p) => [Number(p.id), p]));
      const latest = [...clientOrders].sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0))
        .flatMap((o) => teams(o).flatMap((t) => t.slots.map((x) => Number(x.SlotLocation?.place_id))))
        .find((id) => pool.has(id));
      if (latest) return [pool.get(latest)!];
    }
  }
  return hits;
}

/**
 * THE ORDER A CHANGE IS FOR. Until 10-21 only an R number in the subject or the newest text, or
 * the thread's link: measured 10-21, of 107 threads with a need since 10-09, 42 asked about an
 * order that already existed and was never found, by its PO or project reference in the order's
 * name (12), an R or J number elsewhere in the thread (8), or its day and one more fact (39).
 * Since R8 the shared resolver (identity/index.ts) names it, by the same ladder the TV uses.
 * NEVER the day alone (Ben, 10-03 and 10-15): a second job that day would have its crew and [DECISIONS V1]
 * times rewritten.
 * `explicit` refuses the day-and-fact finds: new shifts go onto an order only by reference,
 * and a day's booking is weighed by bookedAt instead.
 */
async function findOrder(msg: Message, companyId: number, world: World, threadOrderId: number | null, ev?: Evidence | null, explicit = false): Promise<any | string> {
  // A number the email itself writes is checked against OnSinch first: one OnSinch does not hold,
  // or holds for another client, is said rather than passed over for a weaker find.
  const pool = ev ? [...ev.pool] : await world.companyOrders(companyId);
  for (const n of rNumbersIn(`${msg.subject}\n${msg.text}`)) {
    const o = pool.find((x) => String(x.number) === n) ?? (await world.orderByNumber(n));
    if (!o) return `R${n} not found`;
    if (Number(o.company_id) !== companyId) return `R${n} belongs to another client`;
    if (!pool.some((x) => Number(x.id) === Number(o.id))) pool.push(o);
  }
  const facts: Facts = ev?.facts ?? { refs: refsIn([], { subject: msg.subject, text: msg.text }), requests: [], link: threadOrderId, text: `${msg.subject}\n${msg.text}` };
  const id = identify(facts, pool, { companyIds: [companyId], add: explicit });
  if (id.kind === "one") return pool.find((o) => Number(o.id) === id.order.id);
  if (id.kind === "several") return `${id.why}: ${id.orders.map((o) => o.r).join(", ")}`;
  return "no order is named";
}

/** What the evidence finder reads: the thread, every company it could be, their orders, the facts. */
type Evidence = { ids: number[]; pool: any[]; tin: ThreadIn; sw: StateWorld; sentAt: number; facts: Facts };
/** The order a card names: the resolver's one, or the lead of several (never written to: findOrder refuses several). */
const found = (ev: Evidence): OrderRef | null => { const id = identify(ev.facts, ev.pool, { companyIds: ev.ids }); return id.kind === "one" ? id.order : id.kind === "several" ? id.lead ?? null : null; };
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

async function evidenceOf(msg: Message, i: Interpretation, world: World, threadOrderId: number | null, opts: PlanOpts): Promise<Evidence | null> {
  const companies = await world.companies();
  const thread: ThreadMsg[] = opts.thread?.length ? opts.thread : [{ message_id: msg.message_id, from: msg.from, to: [], at: Date.parse(msg.sentIso), subject: msg.subject, body: msg.text, ours: false }];
  const linked = threadOrderId && world.orderById ? await world.orderById(threadOrderId).catch(() => null) : null;
  // Finding may search every company the senders could be; booking still needs exactly one. A Cc'd
  // venue contact or second client never widens the search (F12): the To and Cc addresses count
  // only when no sender names a company, and only when they name exactly one.
  const clientMail = thread.filter((m) => !m.ours);
  const fromIds = companiesOf(clientMail.map((m) => m.from), companies);
  const toIds = fromIds.length ? [] : companiesOf(clientMail.flatMap((m) => m.to), companies);
  const ids = [...new Set([matchCompanyBySender(msg.from, companies) || 0, Number(linked?.company_id) || 0,
    ...fromIds, ...(toIds.length === 1 ? toIds : [])].filter((x) => x > 0))].slice(0, 4);
  if (!ids.length && !linked) return null;
  const pool: any[] = [];
  for (const c of ids) pool.push(...(await world.companyOrders(c)));
  if (linked && !pool.some((o) => Number(o.id) === Number(linked.id))) pool.push(linked);
  // The days asked for, as grounded and as the reader gave them: a check that refused "20-Nov"
  // still leaves the day the order is found by (Subfrantic R11698, 10-16).
  const requests: Grounded[] = [
    ...i.requests.map((r) => ({ date: r.date ?? r.target?.date, start: r.start, crew: r.crew, place_id: r.place_id, venue: r.venue, target: r.target })),
    ...(opts.raw ?? []),
  ].filter((r) => isDay(r.date) || isDay(r.target?.date)).map((r) => ({ ...r, date: isDay(r.date) ? r.date : r.target!.date }));
  const generic = new Set((world.allPlaces ? await world.allPlaces() : []).filter((p) => GENERIC_PLACE.test(normName(p.name))).map((p) => Number(p.id)));
  return {
    ids, pool, sentAt: Date.parse(msg.sentIso),
    tin: { thread_id: "", messages: thread, requests, link: threadOrderId ? { order_id: threadOrderId } : null, need: null },
    sw: { orders: pool.filter((o) => Number(o.status) !== -1), companies, staffEdits: [] },
    facts: { refs: refsIn(thread, { subject: msg.subject, text: msg.text }), requests, link: threadOrderId, text: thread.map((m) => `${m.subject}\n${m.body}`).join("\n"), generic },
  };
}

/**
 * A PERSON'S CARD SAYS WHICH ORDER IT IS ABOUT, AND GOES WHEN STAFF HAVE BOOKED IT. A hand-off
 * names the order the finder finds (the TV's R and J come from it, through the thread's link).
 * A new booking every day of which is in an order made or touched by staff since the email is
 * done (Ben 10-16: "anything that the staff got to first ... you should go quiet"): 13 bookings [DECISIONS V22]
 * since 10-09 were built by staff after the email and stayed on the TV with no numbers. An
 * order that was there before the email is never the new booking's: it would hide a second job
 * the client has that day.
 */
function settle(d: Decision, i: Interpretation, ev: Evidence | null, again: boolean): Decision {
  if (!ev) return d;
  // Made or changed by a person (not the bot) since the email.
  const since = (id: number) => {
    const o = ev.pool.find((x) => Number(x.id) === id);
    return !!o && ((Date.parse(o.created) > ev.sentAt && Number(o.creator) !== BOT_USER) || stampedSince(o, ev.sentAt));
  };
  const rOf = (id: number) => `R${ev.pool.find((x) => Number(x.id) === id)?.number ?? id}`;
  // PLANNED AGAIN, A WRITE ON STAFF'S WORK IS STAFF'S: Video Illusions' R11765 was built by staff 4
  // minutes after the email with its own start, and the re-plan read the asked 22:15 as a shift
  // still to add. A new order every day of which staff have since booked is the same.
  if (d.kind === "write" && again) {
    const targets = [...new Set(d.ops.map((o) => ("order_id" in o.op ? Number(o.op.order_id) : 0)).filter((x) => x > 0))];
    const touched = targets.filter(since);
    if (touched.length) return { kind: "none", reason: `staff changed ${touched.map(rOf).join(", ")} after the email`, found: touched };
    if (d.ops.some((o) => o.op.kind === "create_order")) {
      const all = covered(ev.tin.requests, ev.sw.orders, { companyIds: ev.ids, after: ev.sentAt, generic: ev.facts.generic });
      if (all?.length && all.every((o) => since(o.id))) return { kind: "none", reason: `already booked: ${all.map((o) => o.r).join(", ")}`, found: all.map((o) => o.id) };
    }
    return d;
  }
  if (d.kind !== "handoff") return d;
  const asksNew = i.requests.length ? i.requests.every((r) => r.action === "new_shift") : i.intent === "booking" || i.intent === "quote_request";
  if (asksNew) {
    const all = covered(ev.tin.requests, ev.sw.orders, { companyIds: ev.ids, after: ev.sentAt, generic: ev.facts.generic });
    if (all?.length && all.every((o) => since(o.id))) return { kind: "none", reason: `already booked: ${all.map((o) => o.r).join(", ")}`, found: all.map((o) => o.id) };
  }
  const ref = found(ev);
  if (!ref || ref.by === "link (it holds none of the days asked)") return d;
  // Nor are its numbers a new booking's: a client running two jobs that day would see the other's.
  if (asksNew && /^the day and/.test(ref.by) && !since(ref.id)) return d;
  return { ...d, order_id: ref.id };
}

type ShiftGroup = { date: string; start: string; end: string; venue?: string; place_id?: number; positions: PositionSpec[]; label: string; notes: string[] };

/**
 * Spartan's shortest call. Staff booked 11,914 of 11,915 positions in the gold copy at 2 hours or more; asked
 * for three 1-hour calls, they booked 2-hour ones and joined two that touched (1a153e512dae2620, ADDENDUM R17).
 * How to lengthen a shorter call is staff's choice, so it is a person's.
 */
export const MIN_CALL_MINUTES = 120;

/**
 * New shifts, one per day and window, each with its positions. "10 crew and 1 carpenter" on
 * one call is ONE shift with two positions (RG Jones, 10-09: read as two requests). The crew
 * chief rule counts everyone on the shift: across 402 staff-built shifts with a named trade, a
 * total of 4-9 carried a chief 128 times in 132, and counting crew alone fitted 71% against
 * 78%. The chiefs come out of the plain crew, then out of the largest trade, so the people
 * who turn up are the number the client asked for.
 */
function shiftGroups(news: Request[], clientOrders: any[], live: LiveProfession[]): ShiftGroup[] | string {
  const byWindow = new Map<string, Request[]>();
  for (const r of news) {
    const k = `${r.date}|${r.start}|${r.end}`;
    byWindow.set(k, [...(byWindow.get(k) ?? []), r]);
  }
  const out: ShiftGroup[] = [];
  for (const rs of byWindow.values()) {
    const venues = [...new Set(rs.map((r) => r.venue).filter(Boolean))];
    if (venues.length > 1) return `one call at ${venues.length} venues`;
    const win = shiftWindow(rs[0].date!, rs[0].start!, rs[0].end!);
    const minutes = Math.round((Date.parse(win.end) - Date.parse(win.beginning)) / 60_000);
    if (minutes < MIN_CALL_MINUTES) return `a call of ${minutes} minutes on ${rs[0].date} (${rs[0].start}-${rs[0].end}): Spartan books 2 hours at least, so a person sets it`;
    let crew = 0;
    const profs = new Map<string, number>();
    const notes: string[] = [];
    const labels: string[] = [];
    for (const r of rs) {
      const trade = tradeOf(r.trade);
      if (!trade) { crew += r.crew!; continue; }
      const p = trade.asCrew ? null : pickProfession(trade, clientOrders, live);
      if (!p) { crew += r.crew!; notes.push(`asked for ${trade.label}: no live OnSinch profession, booked as Crew`); continue; }
      profs.set(p.id, (profs.get(p.id) ?? 0) + r.crew!);
      labels.push(`${r.crew} ${trade.label}`);
      if (trade.candidates.length > 1) notes.push(`${trade.label} booked as ${PROFESSION_NAME[p.id] ?? p.id}${p.fromHistory ? ", the one this client last had" : ", ops' most used (no history for this client)"}`);
    }
    const total = crew + [...profs.values()].reduce((a, b) => a + b, 0);
    const label = [crew ? `${crew} crew` : "", ...labels].filter(Boolean).join(", ");
    const chiefs = chiefsFor(total, rs.some((r) => r.crew_chief));
    let short = chiefs - Math.min(chiefs, crew);
    crew -= chiefs - short;
    while (short > 0) {
      const [id, size] = [...profs].sort((a, b) => b[1] - a[1])[0];
      const take = Math.min(short, size);
      profs.set(id, size - take);
      short -= take;
    }
    // A shift of trades alone (2 carpenters) has no crew position: the API makes the shift
    // with its first position (apiCreate.ts), so it is booked rather than handed over.
    const positions: PositionSpec[] = chiefs ? [{ size: chiefs, profession_id: "36", role: "crew_chief" }] : [];
    if (crew) positions.push({ size: crew, profession_id: "1" });
    for (const [id, size] of profs) if (size) positions.push({ size, profession_id: id });
    const r0 = rs[0];
    const place_id = rs.map((r) => r.place_id).find(Boolean);
    out.push({ date: r0.date!, start: r0.start!, end: r0.end!, venue: venues[0], place_id, positions, label, notes });
  }
  return out;
}

/** One call the email asks for: its day and window, everyone on it, and the requests it came from. */
type Call = { date: string; start: string; end: string; crew?: number; chief: boolean; plain: boolean; rs: Request[] };
function windowsOf(news: Request[]): Call[] {
  const by = new Map<string, Call>();
  for (const r of news) {
    const k = `${r.date}|${r.start}|${r.end}`;
    const w = by.get(k) ?? { date: r.date!, start: r.start!, end: r.end!, crew: 0, chief: false, plain: true, rs: [] };
    w.rs.push(r);
    w.crew = w.crew != null && r.crew != null ? w.crew + r.crew : undefined;
    w.chief ||= !!r.crew_chief;
    const t = tradeOf(r.trade);
    if (t && !t.asCrew) w.plain = false;
    by.set(k, w);
  }
  return [...by.values()];
}

/** A person's hand on this shift after `sent`: made or changed by anyone but the bot. */
function staffSince(t: { raw: any; slots: any[] }, slots: any[], sent: number): boolean {
  const staff = (u: unknown) => u != null && Number(u) > 0 && Number(u) !== BOT_USER;
  const after = (x: unknown) => Date.parse(String(x ?? "")) > sent;
  const r = t.raw ?? {};
  return (after(r.created) && staff(r.creator)) || (after(r.modified) && staff(r.modifier))
    || (staff(r.modifier ?? r.creator) && slots.some((s) => after(s.created) || after(s.modified)));
}

/**
 * FIX 2 (Ben approved 10-20): ALREADY BOOKED IS THE DAY AND THE START, NOT THE EXACT WINDOW. [DECISIONS V26]
 * Measured 10-20 on every bot write since 9 Oct: 4 of the 6 shifts the bot added sat beside
 * staff's own shift on that day at that start, let through because the end differed (Roof
 * Gardens 14:00-15:00 beside 14:00-16:00, COG 08:00-18:00 beside 08:00-17:00). Every position at
 * that start counts together, so a chief and 3 crew are 4. Who has the last word:
 *   - a person made or changed that shift after the email: their shape stands, nothing is written
 *     (staff's 14:00-16:00 is not cut to the asked 15:00, their chief is not split back out);
 *   - it was there before the email: the difference is the client's change, a new count or a new
 *     finish on that shift, planned like any other change ("even booked orders may still need
 *     updated", Ben 10-20);
 *   - nothing starts then: a new shift, as before.
 * A trade beside the crew ("2 carpenters at 08:00") is not a new count for the crew's shift, so
 * only the same window holds it.
 */
function bookedAt(o: any, w: Call, sent: number, venue: Set<number> | null = null): "fresh" | { synth: Request[] } | string {
  const win = shiftWindow(w.date, w.start, w.end);
  const b = Date.parse(win.beginning), e = Date.parse(win.end);
  // On an order at several venues, only the venue's shifts hold the call (F10).
  const fits = atVenue(o, venue);
  const ts = teams(o).map((t) => ({ ...t, slots: t.slots.filter(fits) })).filter((t) => t.slots.length);
  if (!w.plain) return ts.some((t) => t.slots.some((s) => Date.parse(s.beginning) === b && Date.parse(s.end) === e)) ? { synth: [] } : "fresh";
  const at = ts.map((t) => ({ t, slots: t.slots.filter((s) => Date.parse(s.beginning) === b) })).filter((x) => x.slots.length);
  if (!at.length) {
    const near = nearStart(o, w.date, w.start, venue);
    return near ? `R${o.number}: a shift on ${w.date} starts at ${near}, the email asks ${w.start}: possibly the same booking` : "fresh";
  }
  if (at.some((x) => staffSince(x.t, x.slots, sent))) return { synth: [] };
  const total = at.reduce((a, x) => a + x.slots.reduce((k, s) => k + Number(s.size), 0), 0);
  const sameEnd = at.every((x) => x.slots.every((s) => Date.parse(s.end) === e));
  const sameCrew = w.crew == null || w.crew === total;
  if (sameEnd && sameCrew) return { synth: [] };
  if (at.length > 1) return `R${o.number}: ${at.length} shifts on ${w.date} could be the one meant`;
  const base = { order_id: Number(o.id), order: `R${o.number}`, shift_id: at[0].t.id, target: { quote: at[0].t.name, date: w.date, start: w.start }, problems: [] as string[] };
  return { synth: [
    ...(sameCrew ? [] : [{ ...base, action: "change_crew" as const, date: w.date, crew: w.crew, ...(w.chief ? { crew_chief: true } : {}) }]),
    ...(sameEnd ? [] : [{ ...base, action: "change_times" as const, date: w.date, start: w.start, end: w.end }]),
  ] };
}

/**
 * opts.leadDays: Settings' lead days; null = the rule is switched off; absent = CREATE_LEAD_DAYS.
 * opts.now: the moment of deciding. A day before it is already over and never written; without
 * it only a day before the email is refused, so every production caller passes it (process.ts).
 */
export type PlanOpts = {
  leadDays?: number | null;
  now?: number;
  /** The whole thread, ours included, for the finder: an R or J number in a quoted email names the order. */
  thread?: ThreadMsg[];
  /** The reader's own values, for finding only: a day grounding refused still says which order. */
  raw?: Grounded[];
  /**
   * The email is planned again after the fact (v2/replan.ts): what staff have done since stands.
   * A write on an order a person built or changed after the email is theirs, done. At intake it
   * is not applied: a person assigning crew a minute after a client's change is not that change.
   */
  again?: boolean;
};

export async function plan(msg: Message, i: Interpretation, world0: World, threadOrderId: number | null = null, opts: PlanOpts = {}): Promise<Decision> {
  const world = once(world0);
  const ev = await evidenceOf(msg, i, world, threadOrderId, opts).catch(() => null);
  return coded(settle(await decide(msg, i, world, threadOrderId, opts, ev), i, ev, !!opts.again));
}

/** Each OnSinch read once per email: the finder and the planner ask for the same orders. */
function once(w: World): World {
  const memo = new Map<string, Promise<any>>();
  const m = <T,>(k: string, f: () => Promise<T>): Promise<T> => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k)! as Promise<T>; };
  // Every method named, never `...w`: a spread copies own properties only, so a World written as a
  // class (the harness's FakeWorld) lost placesNamed, orderByNumber and orderById, and from 10-20
  // to 10-24 every harness case that named a venue or an R number ended "could not plan".
  return {
    companies: () => m("companies", () => w.companies()),
    companyOrders: (id) => m(`orders:${id}`, () => w.companyOrders(id)),
    placesNamed: (name) => w.placesNamed(name),
    orderByNumber: (n) => w.orderByNumber(n),
    ...(w.allPlaces ? { allPlaces: () => m("places", () => w.allPlaces!()) } : {}),
    ...(w.orderById ? { orderById: (id: number) => w.orderById!(id) } : {}),
    ...(w.professions ? { professions: () => w.professions!() } : {}),
  };
}

async function decide(msg: Message, i: Interpretation, world: World, threadOrderId: number | null, opts: PlanOpts, ev: Evidence | null): Promise<Decision> {
  // A request from the thread's history (interpret.ts) is never new work: what it lacks blocks
  // nothing, and it is only checked against the client's orders below.
  let reqs = i.requests.filter((r) => !r.history);
  const hist = i.requests.filter((r) => r.history);
  let problems = [...i.problems, ...reqs.flatMap((r) => r.problems)];
  // A STAND-DOWN WITH NOTHING BOOKED THAT DAY CHANGES NOTHING (R10, recommended with Release 1):
  // "we're going with a different crew company for this job" (Cells4Life, 10-19) had no words
  // cancelling a whole shift, and nothing of theirs was booked on the 25th, yet it was a card.
  const STANDS = /: no words cancelling the whole shift$/;
  if (problems.some((p) => STANDS.test(p))) {
    const cid = matchCompanyBySender(msg.from, await world.companies()) || (threadOrderId && world.orderById ? Number((await world.orderById(threadOrderId).catch(() => null))?.company_id) || 0 : 0);
    const booked = new Set((cid ? await world.companyOrders(cid) : []).filter((o) => Number(o.status) !== -1).flatMap((o) => teams(o).flatMap((t) => t.slots.map((x) => dayOf(x.beginning)))));
    // A stand-down with no day of its own is about the days the thread asked for: Cells4Life's
    // "going with a different crew company" lost its 25th when the booking it named was cancelled.
    const threadDays = [...new Set((opts.raw ?? []).map((x) => x.date ?? x.target?.date).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))];
    const daysOf = (r: Request) => (r.target?.date ?? r.date ? [(r.target?.date ?? r.date)!] : threadDays);
    const idle = reqs.filter((r) => r.action === "cancel_shift" && r.problems.some((p) => STANDS.test(p)) && daysOf(r).length > 0 && daysOf(r).every((d) => !booked.has(d)));
    if (idle.length) {
      const gone = new Set(idle.flatMap((r) => r.problems));
      problems = problems.filter((p) => !gone.has(p));
      reqs = reqs.filter((r) => !idle.includes(r));
      if (!problems.length && !reqs.length) return { kind: "none", reason: `nothing is booked on ${[...new Set(idle.flatMap(daysOf))].join(", ")}, so there is nothing to cancel` };
    }
  }
  // A quote, a question or an availability check whose shift is not bookable as written is
  // answered by a reply: "If you can check availability for Sunday" (Vivid), "send me a quote
  // for Friday 16th" (Blackout) were order cards before.
  const asking = i.intent === "quote_request" || i.intent === "unclear" || i.intent === "info_only";
  if (problems.length) return problems.every((p) => MISSING.test(p) || (asking && /not an operation the system performs$/.test(p))) ? ask(...problems) : handoff(...problems);
  // A QUOTE IS BOOKED as an order in To Confirm, as ops book it: of the quote requests 9-13 Oct
  // that named their shifts, ops raised an order for every one (scripts/score-vs-ops.mts).
  if (i.intent === "quote_request" && !i.requests.length) return ask("the client asked for a quote");
  if (i.intent === "unclear") return ask("the request is unclear");
  if (i.intent === "info_only" && !i.po) return { kind: "none", reason: ["no change asked for", ...(i.notes ?? [])].join("; ") };

  // The client: the sender's domain, else the company of the order this thread is already
  // linked to. "Re: SN ExCeL" from amy@mvstaging.com (10-13), a contact OnSinch does not hold,
  // is about an order that has a company.
  let companyId: number = matchCompanyBySender(msg.from, await world.companies()) || 0;
  if (!companyId && threadOrderId && world.orderById) { const o = await world.orderById(threadOrderId).catch(() => null); if (o && Number(o.company_id) > 0) companyId = Number(o.company_id); }
  // Else the company of the order the finder names: tom@fulltilt.london is on companies 501 and
  // 635, and the card read "new client, not in OnSinch" over staff's R11750 (MK Crew, 10-19).
  if (!companyId && ev) { const ref = found(ev); const o = ref ? ev.pool.find((x) => Number(x.id) === ref.id) : null; if (o && Number(o.company_id) > 0) companyId = Number(o.company_id); }
  // A sender OnSinch has no company for has nothing booked: a cancellation or a PO from them
  // changes nothing (AT Comms, 10-11: "the PM has this covered now" after their first email).
  if (!companyId && (i.intent === "cancellation" || i.intent === "info_only")) return { kind: "none", reason: `${msg.from} is not a client in OnSinch, so nothing of theirs is booked` };
  // A CLIENT ONSINCH DOES NOT HOLD IS CREATED from its name, as ops do and as Ben ruled for the [DECISIONS V32]
  // engine ("creating a client is never gated on information beyond a name", onsinch.ts): a
  // first booking from AT Comms (10-11) went to a person for want of a company record. Only a
  // booking or quote with its shifts does this; anything else from a stranger is for the inbox.
  // Never a second company for one OnSinch already holds: a written name sharing a word with an
  // existing client ("White Light / d&b solutions" beside "d&b solutions UK Ltd", 10-09) is for a
  // person to place. OnSinch's API cannot delete a company, so the bar is high on purpose.
  const STOP = new Set(["ltd", "limited", "uk", "the", "and", "group", "events", "event", "solutions", "services", "productions", "production", "media", "live", "co", "company", "plc", "llp", "&"]);
  const words = (t: string) => normName(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  // A DOMAIN SEVERAL COMPANIES SHARE is settled by the company the email names, when exactly one of
  // them matches it (held item 7, OPERATING §9.3: one sender for several clients is resolved by
  // content, never by the most frequent). 3 of the live week's 7 emails with no client were on such a
  // domain. Two to three companies only: a wider domain is a mail host. A domain OnSinch already
  // holds is never a new client either: a name matching none of its companies is for a person. A
  // personal mail host is neither: icloud.com sits on 2 of 811 companies and gmail.com on 34, and a
  // person's address says nothing about which company they book for (red-team-B H2).
  const senderDomain = CONSUMER_DOMAINS.has(domainOfEmail(msg.from)) ? "" : domainOfEmail(msg.from);
  const onDomain = !companyId && senderDomain ? (await world.companies()).filter((c) => (c.Client ?? []).some((cl: { email?: string }) => domainOfEmail(cl.email) === senderDomain)) : [];
  if (!companyId && i.company_name && onDomain.length >= 2 && onDomain.length <= 3) {
    const named = onDomain.filter((c) => words(String(c.name ?? "")).some((w) => words(i.company_name!).includes(w)));
    if (named.length === 1) companyId = Number(named[0].id);
  }
  const nameClash = i.company_name ? (await world.companies()).some((c) => words(String(c.name ?? "")).some((w) => words(i.company_name!).includes(w))) : false;
  const newClient = !companyId && i.company_name && !nameClash && !onDomain.length && (i.intent === "booking" || i.intent === "quote_request") && i.requests.length && i.requests.every((r) => r.action === "new_shift") ? i.company_name : null;
  if (!companyId && !newClient) return handoff(`no single client company for ${msg.from}`);
  const clientOrders = await world.companyOrders(companyId);
  const live = reqs.some((r) => tradeOf(r.trade)?.named) && world.professions ? await world.professions() : [];
  /** The OnSinch places a request's venue names: its picked place, else its words (placesFor); null when it names none. */
  const venueOf = async (r: Request | undefined): Promise<Set<number> | null> =>
    !r ? null : r.place_id ? new Set([Number(r.place_id)]) : r.venue ? new Set((await placesFor(world, r.venue, clientOrders)).map((p) => Number(p.id))) : null;
  const professionOf = (r: Request) => {
    const trade = tradeOf(r.trade);
    const prof = trade && !trade.asCrew ? pickProfession(trade, clientOrders, live) : null;
    return trade && prof ? { trade, prof } : null;
  };
  /** The hours a crew change asks for, when they are not its shift's; null when it names none or the same. */
  const hoursOf = (r: Request, first: { beginning: string; end: string }) => {
    const s = utcToLondon(first.beginning).time, e = utcToLondon(first.end).time;
    const start = r.start ?? s, end = r.end ?? (r.duration ? addMinutes(start, r.duration) : e);
    return start !== s || end !== e ? `${start}-${end}` : null;
  };
  const ops: { source: string; op: Op }[] = [];
  const asked = new Set<string>();
  const why: string[] = [];
  const src = (n: number) => `${msg.message_id}#${n}`;

  // A day before the email was sent is never written: a shift that has happened is not booked
  // or changed (ec938be planned Lux Technical R11206 on 1 October from a 13 October email).
  const sentDay = utcToLondon(msg.sentIso).date;
  const past = reqs.find((r) => (r.date && r.date < sentDay) || (r.target?.date && r.target.date < sentDay && r.action !== "new_shift"));
  if (past) return handoff(`a request is for ${past.date ?? past.target?.date}, before the email was sent`);
  // FIX 3 (Ben approved 10-20): A DAY ALREADY OVER IS NEVER WRITTEN. A change to a shift that has [DECISIONS V27]
  // happened is a timesheet or billing question. COG's 27 July email was decided on 19 Oct and
  // wrote a shift for 18 Oct, and 42 of 712 decisions since 9 Oct were on emails over 7 days old.
  const today = opts.now != null ? utcToLondon(new Date(opts.now).toISOString()).date : null;
  const overDay = (r: Request) => [r.date, r.target?.date].find((d) => !!d && !!today && d < today);
  const over = reqs.find((r) => overDay(r));
  if (over) return handoff(`${overDay(over)} is already over: a person adjusts it`);
  // FIX 1 (Ben approved 10-20): REQUESTS FROM HISTORY ARE NEVER NEW WORK. The client's newest [DECISIONS V25]
  // words asked for nothing new ("All confirmed on my side", "Quote looks great"), so a request
  // read from the quoted thread or the subject is checked against the client's orders by its day
  // and one more fact: held, nothing to do; held by no order, the card stays for a person.
  const histNew = hist.filter((r) => r.action === "new_shift" && r.date && r.date >= (today ?? sentDay));
  // Two orders holding it equally still hold it: the card would say no order does.
  const holders = histNew.map((r) => { const id = identify({ refs: [], requests: [r], link: null, text: "", generic: ev?.facts.generic }, clientOrders, { companyIds: [companyId] }); return id.kind === "one" ? id.order : id.kind === "several" ? "several" as const : null; });
  const unheld = histNew.filter((_, k) => !holders[k]);
  if (unheld.length) return handoff(`the client confirmed ${[...new Set(unheld.map((r) => r.date))].join(", ")}, and no order holds it yet`);
  // A change from the thread that the client now confirms is a person's to make: "Can we confirm
  // this?" under our offer of "an additional three crew" (Light Motif R11662, 10-20). Without
  // their yes it is only the quoted email read again, and nothing is asked.
  const histChange = hist.filter((r) => r.action === "change_times" || r.action === "change_crew");
  if (histChange.length && confirms(msg.text)) return handoff(`the client confirmed a change from the thread (${[...new Set(histChange.map((r) => r.target?.date ?? r.date ?? "a shift"))].join(", ")}): a person makes it`);
  if (!reqs.length && hist.length) {
    const held = [...new Map(holders.filter((h): h is OrderRef => !!h && h !== "several").map((h) => [h.id, h])).values()];
    const reason = held.length ? `already booked: ${held.map((o) => o.r).join(", ")}` : "nothing new asked for: the requests are the thread's earlier ones";
    return { kind: "none", reason: [reason, ...(i.notes ?? [])].join("; "), ...(held.length ? { found: held.map((o) => o.id) } : {}) };
  }
  const assumed: string[] = [];
  const history = pastShifts(clientOrders);
  const news: Request[] = [];
  for (const r of reqs.filter((q) => q.action === "new_shift")) {
    if (r.start && r.end) { news.push(r); continue; }
    const venue = r.venue ?? reqs.find((x) => x.venue)?.venue;
    const one = !r.place_id && venue ? await placesFor(world, venue, clientOrders) : [];
    const place_id = r.place_id ?? (one.length === 1 ? Number(one[0].id) : null);
    const f = fillTimes(r, history, { place_id, place_name: one.length === 1 ? one[0].name : venue });
    news.push({ ...r, start: f.start, end: f.end, duration: undefined });
    assumed.push(...f.assumed.map((a) => `assumed: ${r.date}, ${a}`));
  }
  // A time change that also asks for more or fewer people, or for a new total, is two changes on
  // that shift: "start an hour earlier, so 07:00 - 15:00? And add 2 more crew" (end to end on TEST,
  // 10-13) made only the time change, and "move them to 10:00 and make it 8 crew" was refused
  // (addendum F24). Both are planned against the shift as it stands; a position the crew change
  // adds takes the new times (retimed below).
  const changes = reqs.filter((r) => r.action !== "new_shift").flatMap((r) =>
    r.action === "change_times" && (r.crew_add || r.crew_remove || r.crew_set)
      ? [{ ...r, crew: r.crew_set ? undefined : r.crew, crew_add: undefined, crew_remove: undefined, crew_set: undefined },
        { ...r, action: "change_crew" as const, start: undefined, end: undefined, duration: undefined, crew: r.crew_set ? r.crew : undefined, crew_set: undefined }]
      : [r]);
  /** The times a time change in this email gives each shift, for a position the email also adds to it. */
  const retimed = new Map<number, { date: string; start: string; end: string }>();

  /** One change on one order's shift: its operations, or why a person must make it. */
  const change = async (n: number, r: Request): Promise<string | null> => {
    const picked = r.order_id ? clientOrders.find((o) => Number(o.id) === r.order_id) : null;
    const order = picked ?? (await findOrder(msg, companyId, world, threadOrderId, ev));
    if (typeof order === "string") return (order);
    const pickedShift = r.shift_id ? teams(order).find((t) => t.id === r.shift_id) : undefined;
    const shift = pickedShift ?? targetShift(order, r, await venueOf(r));
    if (typeof shift === "string") return (`R${order.number}: ${shift}`);
    // Two crew counts, or two times, for one shift in one email: each request reads the shift as it stood, so
    // applied one after the other they make a shift the client asked for in neither (1a121640a61d9b46).
    const once = `${shift.id}|${r.action}`;
    if (asked.has(once)) return (`R${order.number} shift ${shift.id}: two ${r.action === "change_crew" ? "crew" : r.action === "change_times" ? "time" : "such"} changes in one email`);
    asked.add(once);
    const first = shift.slots[0];
    // A change names its shift by the day it is on (target) and may give a NEW day (date).
    // Until 10-11 the new day was ignored, so "move Tuesday's shift to Wednesday, 9-5" wrote
    // 9-5 on Tuesday: measured by the harness, 40 of 40 such emails were wrong writes.
    const date = r.target?.date && r.date && r.date !== r.target.date ? r.date : dayOf(first.beginning);
    if (r.action === "change_times") {
      // A TIME FOR A NAMED ROLE OR TRADE MOVES ONLY THOSE POSITIONS. "The forklift driver and the chief
      // from 07:00" on a shift of crew, a chief and a forklift moved all three, so 6 crew would have
      // arrived an hour early; staff moved the chief and the forklift alone (1a13585d743572a8,
      // eval/next-block.md N2). A trade OnSinch books as plain crew cannot say which crew are meant.
      const trade = tradeOf(r.trade);
      let slots = shift.slots;
      if (r.crew_chief || trade) {
        if (trade && (trade.asCrew || trade.named || !trade.candidates.length)) return (`R${order.number} shift ${shift.id}: a time for the ${trade.label} only, and the shift does not say which positions are theirs`);
        slots = shift.slots.filter((s) => (r.crew_chief && Number(s.role) === 1) || (!!trade && Number(s.role) !== 1 && trade.candidates.includes(String(s.profession_id))));
        if (!slots.length) return (`R${order.number} shift ${shift.id}: no ${[r.crew_chief ? "crew chief" : "", trade?.label ?? ""].filter(Boolean).join(" or ")} position to re-time`);
      }
      const first = slots[0];
      // "Tuesday 13th 2 x Crew 8 hours": a count written beside a time change says which shift
      // the client means, so it must be that shift's size or this is another shift.
      const size = slots.reduce((a, s) => a + Number(s.size), 0);
      if (r.crew && r.crew !== size) return (`R${order.number} shift ${shift.id}: the email says ${r.crew} crew, the shift has ${size}`);
      // A length beside an end sets the start: "six hours ending 18:00" is 12:00 (addendum F22).
      const start = r.start ?? (r.end && r.duration ? addMinutes(r.end, -r.duration) : utcToLondon(first.beginning).time);
      // "Increase hours to 8 (currently 6)": the client gave a length, not a time. The
      // shift keeps its start and the end moves (Ben, 10-09). A new start alone moves the [DECISIONS V4]
      // whole call and keeps its length: "arrive for 17:00 instead of 14:00" on 14:00-17:00
      // was planned 17:00-17:00, and ops moved it to 17:00-20:00 (R11029, 10-15).
      const length = Math.round((Date.parse(first.end) - Date.parse(first.beginning)) / 60e3);
      const end = r.end ?? (r.duration ? addMinutes(start, r.duration) : r.start ? addMinutes(start, length) : utcToLondon(first.end).time);
      if (start === end) return (`R${order.number} shift ${shift.id}: ${start}-${end} has no length`);
      // A position already at the asked times is left alone: a restated booking is not a change.
      for (const s of slots) {
        const w = shiftWindow(date, start, end);
        if (Date.parse(s.beginning) === Date.parse(w.beginning) && Date.parse(s.end) === Date.parse(w.end)) continue;
        ops.push({ source: `${src(n)}:${s.id}`, op: { kind: "set_position_times", order_id: Number(order.id), slot_id: Number(s.id), date, start, end } });
      }
      retimed.set(shift.id, { date, start, end });
      why.push(`R${order.number} shift ${shift.id}: times to ${start}-${end}`);
    } else if (r.action === "cancel_shift") {
      for (const s of shift.slots) ops.push({ source: `${src(n)}:${s.id}`, op: { kind: "cancel_position", order_id: Number(order.id), slot_id: Number(s.id) } });
      why.push(`R${order.number} shift ${shift.id}: cancelled`);
    } else if (r.action === "change_crew" && hoursOf(r, first)) {
      // A CREW CHANGE WITH ITS OWN HOURS is not a size change of the shift. "4 crew from 17:00 for 4 hours"
      // on a 17:00-23:00 shift booked all 4 to 23:00 (1a13fea576aeda13); "2 more, 22:00-01:00" on a
      // 22:00-03:00 shift kept the 2 to 03:00 (1a154d69fc48ba38). Staff split such a shift by hours.
      return (`R${order.number} shift ${shift.id}: a crew change for ${hoursOf(r, first)}, the shift is ${utcToLondon(first.beginning).time}-${utcToLondon(first.end).time}`);
    } else if (r.action === "change_crew" && professionOf(r)) {
      // "add a carpenter to the team tomorrow" (Wall to Wall, 10-11): a position of that
      // profession on the shift, beside the crew. A total or a reduction ("make it 3 forkies",
      // "drop one forklift") changes the trade's one position on the shift (addendum F25); with
      // two such positions, which one is meant is a person's call. The bot's attendance guard
      // still refuses to shrink a position below the workers on it (run.ts staffedRefusal).
      const { trade, prof } = professionOf(r)!;
      const at = retimed.get(shift.id);
      const londonStart = at?.start ?? utcToLondon(first.beginning).time, londonEnd = at?.end ?? utcToLondon(first.end).time;
      const add = (size: number) => ops.push({ source: `${src(n)}:prof`, op: { kind: "add_position", order_id: Number(order.id), shift_id: shift.id, date: at?.date ?? date, start: londonStart, end: londonEnd, position: { size, profession_id: prof.id } } });
      if (r.crew_add && !r.crew && !r.crew_remove) {
        add(r.crew_add);
        why.push(`R${order.number}: add ${r.crew_add} ${trade.label} on ${date}`);
        return null;
      }
      const held = shift.slots.filter((s) => Number(s.role) !== 1 && (trade.candidates.includes(String(s.profession_id)) || String(s.profession_id) === prof.id));
      if (held.length > 1) return (`R${order.number} shift ${shift.id}: ${held.length} ${trade.label} positions, so which to change is for a person`);
      const now = held.length ? Number(held[0].size) : 0;
      const total = r.crew ?? now + (r.crew_add ?? 0) - (r.crew_remove ?? 0);
      if (r.crew && (r.crew_add || r.crew_remove) && r.crew !== now + (r.crew_add ?? 0) - (r.crew_remove ?? 0))
        return (`R${order.number} shift ${shift.id}: the email's ${trade.label} change on ${now} does not make the ${r.crew} written`);
      if (total < 0) return (`R${order.number} shift ${shift.id}: ${r.crew_remove} fewer ${trade.label} than the ${now} booked`);
      if (!held.length) {
        if (!total) return (`R${order.number} shift ${shift.id}: no ${trade.label} position to remove`);
        add(total);
      } else if (!total) {
        ops.push({ source: `${src(n)}:prof`, op: { kind: "cancel_position", order_id: Number(order.id), slot_id: Number(held[0].id) } });
      } else if (total !== now) {
        ops.push({ source: `${src(n)}:prof`, op: { kind: "set_position_size", order_id: Number(order.id), slot_id: Number(held[0].id), size: total } });
      }
      why.push(`R${order.number} shift ${shift.id}: ${total} ${trade.label} in all`);
    } else if (r.action === "change_crew") {
      const unverified = tradeOf(r.trade);
      if (unverified) why.push(`asked for ${unverified.label}: no live OnSinch profession, booked as Crew`);
      const chief = shift.slots.filter((s) => Number(s.role) === 1);
      // A shift with several plain crew positions (a general crew and a named team, Event Concept
      // R11461) changes on its largest, where ops put general crew.
      const crew = shift.slots.filter((s) => Number(s.role) !== 1 && Number(s.profession_id) === 1).sort((a, b) => Number(b.size) - Number(a.size)).slice(0, 1);
      if (crew.length !== 1) return (`R${order.number} shift ${shift.id}: no crew position to change`);
      const chiefSize = chief.reduce((a, s) => a + Number(s.size), 0);
      const current = chiefSize + Number(crew[0].size);
      // "Add 2 more, making it 4 x Crew": both written, so both must hold against the shift
      // as it stands. If they disagree the client and OnSinch see different shifts.
      if (r.crew && r.crew_add && r.crew !== current + r.crew_add)
        return (`R${order.number} shift ${shift.id}: ${r.crew_add} more on ${current} makes ${current + r.crew_add}, not the ${r.crew} written`);
      if (r.crew && r.crew_remove && r.crew !== current - r.crew_remove)
        return (`R${order.number} shift ${shift.id}: ${r.crew_remove} fewer on ${current} makes ${current - r.crew_remove}, not the ${r.crew} written`);
      const total = r.crew ?? current + (r.crew_add ?? 0) - (r.crew_remove ?? 0);
      // A shift ops gave several chief positions keeps them as ops set them: only the crew
      // position moves (Event Concept R11404, "2 additional crew" on 8 + 2 chiefs).
      if (chief.length > 1) {
        const size = Number(crew[0].size) + (total - current);
        if (size < 1) return (`R${order.number} shift ${shift.id}: ${total} crew leaves no crew position`);
        if (size !== Number(crew[0].size)) ops.push({ source: src(n), op: { kind: "set_position_size", order_id: Number(order.id), slot_id: Number(crew[0].id), size } });
        why.push(`R${order.number} shift ${shift.id}: ${total} crew in all`);
        return null;
      }
      // The chiefs follow Ben's rule (chiefsFor) on everyone the shift will hold: its trades and [DECISIONS V13]
      // other teams count too. A chief ops put on a shift of 3 or fewer stays while it stays
      // that small. Up adds the chief position or grows it, down shrinks or cancels it; the crew
      // position takes the rest.
      const others = shift.slots.filter((s) => Number(s.role) !== 1 && Number(s.id) !== Number(crew[0].id)).reduce((a, s) => a + Number(s.size), 0);
      const want = chiefsFor(total + others, !!r.crew_chief || (chiefSize > 0 && current + others < 4));
      if (total - want < 1) return (`R${order.number} shift ${shift.id}: ${total} crew leaves no crew position`);
      // A chief added beside a time change in the same email works the new times, not the old.
      const at = retimed.get(shift.id);
      const londonStart = at?.start ?? utcToLondon(first.beginning).time, londonEnd = at?.end ?? utcToLondon(first.end).time;
      if (want && !chiefSize) {
        ops.push({ source: `${src(n)}:chief`, op: { kind: "add_position", order_id: Number(order.id), shift_id: shift.id, date: at?.date ?? date, start: londonStart, end: londonEnd, position: { size: want, profession_id: "36", role: "crew_chief" } } });
      } else if (!want && chiefSize) {
        ops.push({ source: `${src(n)}:chief`, op: { kind: "cancel_position", order_id: Number(order.id), slot_id: Number(chief[0].id) } });
      } else if (want !== chiefSize) {
        ops.push({ source: `${src(n)}:chief`, op: { kind: "set_position_size", order_id: Number(order.id), slot_id: Number(chief[0].id), size: want } });
      }
      if (total - want !== Number(crew[0].size)) ops.push({ source: src(n), op: { kind: "set_position_size", order_id: Number(order.id), slot_id: Number(crew[0].id), size: total - want } });
      const chiefNote = want === chiefSize ? "" : !want ? ", the crew chief removed" : !chiefSize ? (want === 1 ? ", a crew chief added" : `, ${want} crew chiefs added`) : `, crew chiefs ${chiefSize} to ${want}`;
      why.push(`R${order.number} shift ${shift.id}: ${total} crew in all${chiefNote}`);
    }
    return null;
  };
  for (const [n, r] of changes.entries()) { const no = await change(n, r); if (no) return handoff(no); }
  // TWO CHANGES TO ONE POSITION IN ONE EMAIL are not a plan: each request read the shift as it stood, so
  // "4 crew for 2 hours" and "2 crew for 4 hours" on one 07:00 call sized one position 3, then 2, and
  // cancelled another (1a121640a61d9b46). A time and a size on the same position are two fields, not two
  // changes; the same kind twice, or a cancel beside anything, is for a person.
  const onSlot = new Map<number, string[]>();
  for (const { op } of ops) if ("slot_id" in op) onSlot.set(Number(op.slot_id), [...(onSlot.get(Number(op.slot_id)) ?? []), op.kind]);
  for (const [slot, kinds] of onSlot) if (new Set(kinds).size !== kinds.length || (kinds.includes("cancel_position") && kinds.length > 1))
    return handoff(`position ${slot}: ${kinds.length} changes in one email (${kinds.join(", ")})`);

  // New shifts on a booking the email names (R number, or the thread the bot booked it in)
  // are added to it: Legal Geek's "add a derig on the 13th" is a shift on #13709, not a new
  // order. Only an explicit reference counts; a resemblance never does.
  const pins = [...new Set(news.map((r) => r.order_id).filter((x): x is number => !!x))];
  // One email's new shifts are one job: when the reader put one of them on a booking, the rest
  // of that email's new shifts go there too (Harbour Scenic 10-12, all added to R11508 by ops).
  if (pins.length > 1) return handoff(`new shifts for ${pins.length} existing bookings in one email`);
  const named = news.length ? (pins.length ? clientOrders.find((o) => Number(o.id) === pins[0]) ?? "the picked booking is not readable" : await findOrder(msg, companyId, world, threadOrderId, ev, true)) : null;
  const sent = Date.parse(msg.sentIso);
  if (named && typeof named !== "string") {
    // Each of the order's locations, by the OnSinch place it stands at.
    const atPlace = new Map<number, number>();
    for (const t of teams(named)) for (const s of t.slots) if (Number(s.slotlocation_id)) atPlace.set(Number(s.SlotLocation?.place_id), Number(s.slotlocation_id));
    const locations = new Set(atPlace.values());
    // A shift the order already holds on that day at that start is the client restating the
    // booking or changing it, never a second one (bookedAt says who has the last word).
    const fresh: Request[] = [];
    const synth: Request[] = [];
    for (const w of windowsOf(news)) {
      const b = bookedAt(named, w, sent, await venueOf(w.rs.find((x) => x.place_id || x.venue) ?? news.find((x) => x.place_id || x.venue)));
      if (b === "fresh") fresh.push(...w.rs);
      else if (typeof b === "string") return handoff(b);
      else synth.push(...b.synth);
    }
    // The email's changes still stand when its new shifts are already booked: "change both days to
    // 10pm-2am, and add 2 crew on Monday 26th" lost its time changes once the 26th was booked
    // (We Are Family R11349, replay 10-21).
    if (!fresh.length && !synth.length) return ops.length ? { kind: "write", ops, why: [...why, `already booked: R${named.number}`, ...assumed, ...(i.notes ?? [])] } : { kind: "none", reason: [`already booked: R${named.number}`, ...(i.notes ?? [])].join("; "), found: [Number(named.id)] };
    for (const [n, r] of synth.entries()) { const no = await change(300 + n, r); if (no) return handoff(no); }
    const groups = shiftGroups(fresh, clientOrders, live);
    if (typeof groups === "string") return handoff(groups);
    for (const [n, g] of groups.entries()) {
      let location_id = locations.size === 1 ? [...locations][0] : 0;
      // An order at several venues: the venue the client names picks the location, or nothing does.
      if (!location_id && g.venue) {
        const hits = (await placesFor(world, g.venue, clientOrders)).map((p) => atPlace.get(p.id)).filter((x): x is number => !!x);
        if (hits.length === 1) location_id = hits[0];
      }
      // Still none: the location most of the order's shifts stand at, flagged for staff to check
      // (Ben, 10-15: no hand-off for a detail the order itself can answer). [DECISIONS V17]
      if (!location_id && locations.size > 1) {
        const uses = new Map<number, number>();
        for (const t of teams(named)) for (const s of t.slots) if (Number(s.slotlocation_id)) uses.set(Number(s.slotlocation_id), (uses.get(Number(s.slotlocation_id)) ?? 0) + 1);
        location_id = [...uses].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        assumed.push(`assumed: R${named.number} has ${locations.size} locations and the email names none; the new shift on ${g.date} is at the one most of its shifts use`);
      }
      if (!location_id) return handoff(`R${named.number} has ${locations.size} locations; which one the new shift belongs to is not written`);
      ops.push({ source: src(50 + n), op: { kind: "add_shift", order_id: Number(named.id), location_id, name: "Crew", date: g.date, start: g.start, end: g.end, positions: g.positions } });
      why.push(`R${named.number}: add a shift on ${g.date} ${g.start}-${g.end}, ${g.label}`, ...g.notes);
    }
  } else if (news.length && threadOrderId) {
    // THE THREAD IS ALREADY LINKED TO AN ORDER (bound, made by the bot, or found by the TV's
    // verifier) that could not be read back here (older than the read window, or another
    // client's). Booking afresh would put a second order on a job that has one.
    return handoff(`this thread is linked to order ${threadOrderId}, which the system could not read: ${typeof named === "string" ? named : "not found"}`);
  } else if (news.length) {
    // Already booked: a client's order with a live shift on that day at that start. Measured
    // 10-07: every engine order in To Confirm duplicated one ops had built by hand. Some booked
    // and some not is for a person to untangle.
    // The venue counts when the email names one OnSinch knows: EMS's Mandarin Oriental install
    // (10-09) has the same day, hours and crew as its Roundhouse derig, and was not booked.
    const orders = clientOrders;
    const placeIds = new Map<Request, Set<number> | null>();
    for (const r of news) {
      const venue = r.venue ?? news.find((x) => x.venue)?.venue;
      const places = venue ? await placesFor(world, venue, clientOrders) : [];
      placeIds.set(r, places.length === 1 ? new Set(places.map((p) => Number(p.id))) : null);
    }
    type Verdict = { w: Call; order: any | null; synth: Request[] };
    const verdicts: Verdict[] = [];
    for (const w of windowsOf(news)) {
      const at = placeIds.get(w.rs[0]);
      const begins = Date.parse(shiftWindow(w.date, w.start, w.end).beginning);
      const hits = orders.filter((o) => Number(o.status) !== -1 && teams(o).some((t) => t.slots.some((s) => Date.parse(s.beginning) === begins && (!at || at.has(Number(s.SlotLocation?.place_id))))));
      if (!hits.length) {
        // The near miss (F9): a shift of the client's that day at the venue the email names, starting within
        // the hour of the asked start. A second order beside it would book the job twice.
        const near = w.plain ? orders.filter((o) => Number(o.status) !== -1).map((o) => ({ o, t: nearStart(o, w.date, w.start, at, true) })).filter((x) => x.t) : [];
        if (near.length) return handoff(`${near.map((x) => `R${x.o.number}`).join(", ")}: a shift on ${w.date} starts at ${near[0].t}, the email asks ${w.start}: possibly the same booking`);
        verdicts.push({ w, order: null, synth: [] }); continue;
      }
      const each = hits.map((o) => bookedAt(o, w, sent, at));
      if (hits.length > 1) {
        // Booked as asked in every one of them is still booked; anything else needs a person to pick.
        if (each.every((v) => typeof v === "object" && !v.synth.length)) { verdicts.push({ w, order: hits[0], synth: [] }); continue; }
        return handoff(`${hits.length} of the client's orders have a shift on ${w.date} at ${w.start}`);
      }
      const v = each[0];
      if (v === "fresh") verdicts.push({ w, order: null, synth: [] });
      else if (typeof v === "string") return handoff(v);
      else verdicts.push({ w, order: hits[0], synth: v.synth });
    }
    const bookedV = verdicts.filter((v) => v.order);
    const synth = bookedV.flatMap((v) => v.synth);
    if (bookedV.length === verdicts.length && !synth.length) {
      const found = [...new Map(bookedV.map((v) => [Number(v.order.id), v.order])).values()];
      const booked = `already booked: ${found.map((o) => `R${o.number}`).join(", ")}`;
      return ops.length ? { kind: "write", ops, why: [...why, booked, ...assumed, ...(i.notes ?? [])] } : { kind: "none", reason: booked, found: found.map((o) => Number(o.id)) };
    }
    for (const [n, r] of synth.entries()) { const no = await change(300 + n, r); if (no) return handoff(no); }
    if (bookedV.length === verdicts.length) return ops.length ? { kind: "write", ops, why: [...why, ...assumed, ...(i.notes ?? [])] } : { kind: "none", reason: [why.join("; ") || "already as asked", ...(i.notes ?? [])].join("; ") };
    // Some of it already booked, all in ONE order: the email re-lists that booking and adds to
    // it ("Yes please, 2 x crew also for 2 hours at 21:30", Encore 10-09, which ops added to
    // R11498). The rest is added to that order at its one location; anything else is a person's.
    if (bookedV.length) {
      const hit = [...new Set(bookedV.map((v) => Number(v.order.id)))];
      const o = bookedV[0].order;
      const locs = new Set(teams(o).flatMap((t) => t.slots.map((x) => Number(x.slotlocation_id)).filter(Boolean)));
      const rest = verdicts.filter((v) => !v.order).flatMap((v) => v.w.rs);
      const groups = hit.length === 1 && locs.size === 1 ? shiftGroups(rest, clientOrders, live) : null;
      if (!groups || typeof groups === "string") return handoff(`part of this is already booked (${[...new Set(bookedV.map((v) => `R${v.order.number}`))].join(", ")})`);
      for (const [n, g] of groups.entries()) {
        ops.push({ source: src(50 + n), op: { kind: "add_shift", order_id: Number(o.id), location_id: [...locs][0], name: "Crew", date: g.date, start: g.start, end: g.end, positions: g.positions } });
        why.push(`R${o.number}: add a shift on ${g.date} ${g.start}-${g.end}, ${g.label} (the rest of the email is already booked there)`, ...g.notes);
      }
      const notes = i.notes ?? [];
      return { kind: "write", ops, why: [...why, ...assumed, ...notes] };
    }
    const shifts: ShiftSpec[] = [];
    const groups = shiftGroups(news, clientOrders, live);
    if (typeof groups === "string") return handoff(groups);
    // Ben, 10-15: "we should only be creating orders that are more than two weeks out, all [DECISIONS V14]
    // updates still should be enabled". A new order nearer than that is staff's to create;
    // shifts added to an order that already exists are updates and go on as before.
    const earliest = groups.map((g) => g.date).sort()[0];
    const lead = opts.leadDays === null ? null : opts.leadDays ?? CREATE_LEAD_DAYS;
    if (lead !== null && earliest && daysBetween(sentDay, earliest) <= lead) return handoff(`a new booking from ${earliest}, within ${lead} days of the email, is for staff to create`);
    const extra: string[] = [];
    for (const g of groups) {
      const venue = g.venue ?? news.find((x) => x.venue)?.venue;
      // The venue: the client's own venue the reader picked (by id, its words checked), else
      // the name matched in OnSinch, else a NEW place made from the words as written (ops add
      // one the same way: R11517 "Storage", R11518 "Light Motif - Bellingham", 10-12).
      let place: { id: string; name: string } | null = null;
      if (g.place_id) {
        const all = world.allPlaces ? await world.allPlaces() : [];
        place = { id: String(g.place_id), name: all.find((p) => Number(p.id) === g.place_id)?.name ?? venue ?? `place ${g.place_id}` };
      } else if (venue) {
        let places = await placesFor(world, venue, clientOrders);
        // Several OnSinch places with the name and none this client booked: one with an address,
        // then the oldest, flagged for staff to check, rather than no order at all (Ben, 10-15). [DECISIONS V16]
        if (places.length > 1) {
          const all = world.allPlaces ? await world.allPlaces() : [];
          const full = places.map((p) => all.find((x) => Number(x.id) === Number(p.id)) ?? p) as { id: number; name: string; address?: string }[];
          const pick = [...full].sort((a, b) => Number(!a.address) - Number(!b.address) || Number(a.id) - Number(b.id))[0];
          extra.push(`assumed: ${places.length} OnSinch venues are named "${venue}"; booked at ${pick.name} (place ${pick.id})`);
          places = [pick];
        }
        place = places.length ? { id: String(places[0].id), name: places[0].name } : { id: `new:${venue.trim().slice(0, 120)}`, name: venue.trim().split(",")[0].slice(0, 80) };
        if (!places.length) extra.push(`venue "${venue.trim()}" is new to OnSinch and was added`);
        else if (places[0].byHistory) extra.push(`assumed: "${venue.trim()}" is ${places[0].name} (place ${places[0].id}), the one OnSinch venue whose name fits these words`);
      }
      // No venue written: the client's own premises when it has exactly one among the places it
      // books (a warehouse, HQ, yard or depot): Event Concept's "Crew" for this week went to
      // "Event Concept @ Warehouse" (R11530, 10-13).
      if (!place) {
        const all = world.allPlaces ? await world.allPlaces() : [];
        const used = new Set(clientOrders.flatMap((o) => teams(o).flatMap((t) => t.slots.map((x) => Number(x.SlotLocation?.place_id)))));
        const who = normName(String((await world.companies()).find((c) => Number(c.id) === companyId)?.name ?? ""));
        // The client's own premises: a place named after the company (Event Concept's "Event
        // Concept", Galleywall Road, booked 264 times), else its one warehouse/HQ/depot.
        const named = who ? all.filter((p) => used.has(Number(p.id)) && normName(p.name) && (normName(p.name) === who || normName(p.name).startsWith(who + " "))) : [];
        const own = named.length ? named : all.filter((p) => used.has(Number(p.id)) && /\b(warehouse|hq|head ?office|yard|depot|workshop)\b/i.test(p.name));
        if (own.length === 1) { place = { id: String(own[0].id), name: own[0].name }; extra.push(`no venue written: the client's own ${own[0].name}`); }
      }
      // No venue at all: "No Location" (Ben, 10-15), found by its name (CLAUDE.md: exactly one may [DECISIONS V16]
      // exist, the id is incidental). A venue is one detail; without the order there is nothing.
      if (!place) {
        const none = (await world.placesNamed("No Location")).filter((p) => normName(p.name) === "no location");
        if (none.length !== 1) return ask("no venue in the email");
        place = { id: String(none[0].id), name: none[0].name };
        extra.push(`assumed: no venue written, booked at No Location`);
      }
      shiftWindow(g.date, g.start, g.end);
      shifts.push({ name: "Crew", date: g.date, start: g.start, end: g.end, place_id: place.id, place_label: place.name, positions: g.positions });
      extra.push(...g.notes);
    }
    const companies = await world.companies();
    const company = companies.find((c) => Number(c.id) === companyId);
    const venueName = shifts[0].place_label;
    const who = String(company?.name ?? "").trim();
    // Staff's own naming: "EMS Events - J45088 @ Mansion House" (10-12), the client's reference
    // between the company and the venue when there is one.
    const job_name = `${who}${i.po ? ` - ${i.po}` : ""} @ ${venueName}`.slice(0, 80);
    const assumedHere = [...assumed, ...extra.filter((e) => e.startsWith("assumed: "))];
    const specification = [`From ${msg.from}: "${msg.subject}"`, ...groups.map((g) => `${g.date} ${g.start}-${g.end}: ${g.label}`), ...assumedHere.map((a) => `CHECK, ${a}`)].join("\n").slice(0, 1000);
    ops.push({ source: src(100), op: { kind: "create_order", company_id: companyId ? String(companyId) : `new:${newClient}`, company_name: who || newClient || "", client_email: msg.from, job_name: newClient && !who ? job_name.replace(/^ ?@/, `${newClient} @`).replace(/^ - /, `${newClient} - `) : job_name, po: i.po, specification, shifts } });
    if (newClient) why.push(`new client "${newClient}" added to OnSinch`);
    why.push(`new order: ${shifts.length} shift(s) at ${venueName}`, ...extra);
  } else if (i.po) {
    // The order a PO is for: the email's R number or the thread's order, never a day's only
    // booking (findOrder). A PO is cosmetic (Ben: 1 in 50), so one with no order named is left [DECISIONS V33]
    // off with the reason, not a card.
    const order = (i.order_id ? clientOrders.find((o) => Number(o.id) === i.order_id) : null) ?? (await findOrder(msg, companyId, world, threadOrderId, ev));
    if (typeof order === "string") return { kind: "none", reason: `PO ${i.po} left off: ${order}` };
    // A PO already on the order is never replaced by the system: the client correcting one is
    // rare, and a reference misread as a PO would overwrite the real one.
    const had = String(order.intern_name ?? "").trim();
    if (had && had !== i.po) return handoff(`R${order.number} already has PO ${had}; the email gives ${i.po}`);
    if (had !== i.po) ops.push({ source: src(200), op: { kind: "set_po", order_id: Number(order.id), po: i.po } });
    why.push(`R${order.number}: PO ${i.po}`);
  }
  const notes = i.notes ?? [];
  return ops.length ? { kind: "write", ops, why: [...why, ...assumed, ...notes] } : { kind: "none", reason: [why.join("; ") || "already as asked", ...notes].join("; ") };
}
