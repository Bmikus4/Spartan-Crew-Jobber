// ============================================================================
// The planner: grounded requests + what OnSinch holds now -> bot operations, or the reason a
// person must do it (shown on the office TV), or no action with the reason. Nothing here writes.
// ----------------------------------------------------------------------------
// All-or-nothing per email: if any request in it cannot be planned, the whole email goes
// to a person. Half an email automated and half by hand is how a change gets done twice.
//
// "Never infer from history unless explicitly requested and the job can be found" (Ben,
// 10-06). An existing booking is touched only when the email names it: an R number, the
// thread the bot itself booked it in, or the day of a change that exactly one of the
// client's orders has a shift on. A new booking is never attached to an existing order by
// resemblance; it becomes its own order.
// ============================================================================
import type { Op, PositionSpec, ShiftSpec } from "../bot/ops";
import { shiftWindow, utcToLondon } from "../bot/ops";
import type { Interpretation, Request } from "./interpret";
import { addMinutes } from "./ground";
import { tradeOf, pickProfession, PROFESSION_NAME, type LiveProfession } from "./professions";
import { matchCompanyByDomain, rNumbersIn, normName } from "../../engine/resolve";

export type World = {
  companies(): Promise<any[]>;
  placesNamed(name: string): Promise<{ id: number; name: string }[]>;
  /** Every OnSinch place, for names written with an address or a district after them. */
  allPlaces?(): Promise<{ id: number; name: string; address?: string }[]>;
  companyOrders(companyId: number): Promise<any[]>;
  orderByNumber(rNumber: string): Promise<any | null>;
  /** OnSinch's live (not deleted) professions, for a trade found by name (Security). */
  professions?(): Promise<LiveProfession[]>;
};

export type Message = { message_id: string; from: string; subject: string; sentIso: string; text: string };

export type Decision =
  | { kind: "write"; ops: { source: string; op: Op }[]; why: string[] }
  /**
   * reply: what a person must do is WRITE BACK, not touch an order: a quote, a question, or a
   * booking missing a detail only the client can give. The TV shows it as Needs Reply, never
   * as an order that failed (Ben, 10-11: 1 failed order in 100 is the bar; a question is not one).
   */
  | { kind: "handoff"; reasons: string[]; reply?: boolean }
  | { kind: "none"; reason: string };

const handoff = (...reasons: string[]): Decision => ({ kind: "handoff", reasons });
const ask = (...reasons: string[]): Decision => ({ kind: "handoff", reasons, reply: true });
/** A detail the client did not write: the client is asked, nobody can book it without them. */
const MISSING = /: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;

/**
 * Ops' practice, measured 10-08 on 725 staff-built shifts: 4-9 crew always carry exactly one
 * Crew Chief (243/243), counted within the total; 3 or fewer carry none (434/440). 10+ varies
 * from 1 to 6 chiefs, so it is not decided here.
 */
export function positionsFor(total: number): PositionSpec[] | null {
  if (!Number.isInteger(total) || total < 1) return null;
  if (total <= 3) return [{ size: total, profession_id: "1" }];
  if (total <= 9) return [{ size: 1, profession_id: "36", role: "crew_chief" }, { size: total - 1, profession_id: "1" }];
  return null;
}

const teams = (o: any) =>
  ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []))
    .map((t: any) => ({ id: Number(t.id), name: String(t.name ?? ""), slots: ([] as any[]).concat(t.Slot ?? []).filter((s: any) => s.cancelled !== true) }))
    .filter((t) => t.slots.length);
const dayOf = (iso: string) => utcToLondon(iso).date;
const SHIFT_WORDS = ["derig", "de-rig", "install", "build", "setup", "set up", "rig", "get in", "get out", "load in", "load out", "breakdown", "strike", "collection", "delivery"];

/** The one shift a change is about, or why there is not exactly one. */
export function targetShift(order: any, r: Request): { id: number; slots: any[] } | string {
  const day = r.target?.date ?? r.date;
  let cands = teams(order).filter((t) => t.slots.some((s) => dayOf(s.beginning) === day));
  if (!cands.length) return `no shift on ${day}`;
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
async function placesFor(world: World, venue: string, clientOrders: any[] = []): Promise<{ id: number; name: string }[]> {
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
    if (!hits.length && /^[A-Z]{3,5}$/.test(caps)) {
      const initials = (n: string) => venueKey(n).split(" ").filter(Boolean).map((w) => w[0]).join("");
      const acr = (await world.allPlaces()).filter((p) => p.address && initials(p.name) === caps.toLowerCase());
      if (acr.length === 1) hits = acr;
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
 * THE ORDER A CHANGE IS FOR: one the client names by R number, or the order this thread is
 * already linked to. Nothing else. A client's only booking on the day it names is NOT enough
 * (Ben, 10-03: "the engine should not link an enquiry to an existing order for the same client
 * on the same day, and that be the only reason"). A second job that day would have its crew
 * and times rewritten; the old engine linked 57 of 90 times on the date alone. A venue match
 * does not lift it: a venue is support, never proof.
 */
async function findOrder(msg: Message, companyId: number, world: World, threadOrderId: number | null): Promise<any | string> {
  const rs = rNumbersIn(`${msg.subject}
${msg.text}`);
  if (rs.length > 1) return `the email names ${rs.length} orders`;
  if (rs.length === 1) {
    const o = await world.orderByNumber(rs[0]);
    if (!o) return `R${rs[0]} not found`;
    return Number(o.company_id) === companyId ? o : `R${rs[0]} belongs to another client`;
  }
  if (threadOrderId) {
    const o = (await world.companyOrders(companyId)).find((x) => Number(x.id) === threadOrderId);
    if (o) return o;
  }
  return "no order is named";
}

type ShiftGroup = { date: string; start: string; end: string; venue?: string; place_id?: number; positions: PositionSpec[]; label: string; notes: string[] };

/**
 * New shifts, one per day and window, each with its positions. "10 crew and 1 carpenter" on
 * one call is ONE shift with two positions (RG Jones, 10-09: read as two requests). The crew
 * chief rule counts everyone on the shift: across 402 staff-built shifts with a named trade, a
 * total of 4-9 carried a chief 128 times in 132, and counting crew alone fitted 71% against
 * 78%. The chief comes out of the plain crew, so it needs two or more of them.
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
    if (total > 9) return `${total} on one shift is not a shape the system builds`;
    const chief = total >= 4 && crew >= 2;
    if (rs.some((r) => r.crew_chief) && !chief) return "a crew chief was asked for on a crew of 3 or fewer";
    // A shift of trades alone (2 carpenters) has no crew position: the API makes the shift
    // with its first trade (apiCreate.ts), so it is booked rather than handed over.
    const positions: PositionSpec[] = !crew ? [] : chief ? [{ size: 1, profession_id: "36", role: "crew_chief" }, { size: crew - 1, profession_id: "1" }] : [{ size: crew, profession_id: "1" }];
    for (const [id, size] of profs) positions.push({ size, profession_id: id });
    const r0 = rs[0];
    const place_id = rs.map((r) => r.place_id).find(Boolean);
    out.push({ date: r0.date!, start: r0.start!, end: r0.end!, venue: venues[0], place_id, positions, label: [crew ? `${crew} crew` : "", ...labels].filter(Boolean).join(", "), notes });
  }
  return out;
}

export async function plan(msg: Message, i: Interpretation, world: World, threadOrderId: number | null = null): Promise<Decision> {
  const problems = [...i.problems, ...i.requests.flatMap((r) => r.problems)];
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

  const companyId = matchCompanyByDomain(msg.from, await world.companies());
  // A sender OnSinch has no company for has nothing booked: a cancellation or a PO from them
  // changes nothing (AT Comms, 10-11: "the PM has this covered now" after their first email).
  if (!companyId && (i.intent === "cancellation" || i.intent === "info_only")) return { kind: "none", reason: `${msg.from} is not a client in OnSinch, so nothing of theirs is booked` };
  if (!companyId) return handoff(`no single client company for ${msg.from}`);
  const clientOrders = await world.companyOrders(companyId);
  const live = i.requests.some((r) => tradeOf(r.trade)?.named) && world.professions ? await world.professions() : [];
  const professionOf = (r: Request) => {
    const trade = tradeOf(r.trade);
    const prof = trade && !trade.asCrew ? pickProfession(trade, clientOrders, live) : null;
    return trade && prof ? { trade, prof } : null;
  };
  const ops: { source: string; op: Op }[] = [];
  const why: string[] = [];
  const src = (n: number) => `${msg.message_id}#${n}`;

  const news = i.requests.filter((r) => r.action === "new_shift");
  const changes = i.requests.filter((r) => r.action !== "new_shift");

  for (const [n, r] of changes.entries()) {
    const picked = r.order_id ? clientOrders.find((o) => Number(o.id) === r.order_id) : null;
    const order = picked ?? (await findOrder(msg, companyId, world, threadOrderId));
    if (typeof order === "string") return handoff(order);
    const pickedShift = r.shift_id ? teams(order).find((t) => t.id === r.shift_id) : undefined;
    const shift = pickedShift ?? targetShift(order, r);
    if (typeof shift === "string") return handoff(`R${order.number}: ${shift}`);
    const first = shift.slots[0];
    // A change names its shift by the day it is on (target) and may give a NEW day (date).
    // Until 10-11 the new day was ignored, so "move Tuesday's shift to Wednesday, 9-5" wrote
    // 9-5 on Tuesday: measured by the harness, 40 of 40 such emails were wrong writes.
    const date = r.target?.date && r.date && r.date !== r.target.date ? r.date : dayOf(first.beginning);
    if (r.action === "change_times") {
      // "Tuesday 13th 2 x Crew 8 hours": a count written beside a time change says which shift
      // the client means, so it must be that shift's size or this is another shift.
      const size = shift.slots.reduce((a, s) => a + Number(s.size), 0);
      if (r.crew && r.crew !== size) return handoff(`R${order.number} shift ${shift.id}: the email says ${r.crew} crew, the shift has ${size}`);
      const start = r.start ?? utcToLondon(first.beginning).time;
      // "Increase hours to 8 (currently 6)": the client gave a length, not a time. The
      // shift keeps its start and the end moves (Ben, 10-09).
      const end = r.end ?? (r.duration ? addMinutes(start, r.duration) : utcToLondon(first.end).time);
      // A position already at the asked times is left alone: a restated booking is not a change.
      for (const s of shift.slots) {
        const w = shiftWindow(date, start, end);
        if (Date.parse(s.beginning) === Date.parse(w.beginning) && Date.parse(s.end) === Date.parse(w.end)) continue;
        ops.push({ source: `${src(n)}:${s.id}`, op: { kind: "set_position_times", order_id: Number(order.id), slot_id: Number(s.id), date, start, end } });
      }
      why.push(`R${order.number} shift ${shift.id}: times to ${start}-${end}`);
    } else if (r.action === "cancel_shift") {
      for (const s of shift.slots) ops.push({ source: `${src(n)}:${s.id}`, op: { kind: "cancel_position", order_id: Number(order.id), slot_id: Number(s.id) } });
      why.push(`R${order.number} shift ${shift.id}: cancelled`);
    } else if (r.action === "change_crew" && professionOf(r)) {
      // "add a carpenter to the team tomorrow" (Wall to Wall, 10-11): a position of that
      // profession on the shift, beside the crew. Only an addition: a total or a reduction of
      // a profession is for a person to square with what is booked.
      const { trade, prof } = professionOf(r)!;
      if (!r.crew_add || r.crew || r.crew_remove) return handoff(`R${order.number}: a change to the ${trade.label} count other than adding`);
      const londonStart = utcToLondon(first.beginning).time, londonEnd = utcToLondon(first.end).time;
      ops.push({ source: `${src(n)}:prof`, op: { kind: "add_position", order_id: Number(order.id), shift_id: shift.id, date, start: londonStart, end: londonEnd, position: { size: r.crew_add, profession_id: prof.id } } });
      why.push(`R${order.number}: add ${r.crew_add} ${trade.label} on ${date}`);
    } else if (r.action === "change_crew") {
      const unverified = tradeOf(r.trade);
      if (unverified) why.push(`asked for ${unverified.label}: no live OnSinch profession, booked as Crew`);
      const chief = shift.slots.filter((s) => Number(s.role) === 1);
      // A shift with several plain crew positions (a general crew and a named team, Event Concept
      // R11461) changes on its largest, where ops put general crew.
      const crew = shift.slots.filter((s) => Number(s.role) !== 1 && Number(s.profession_id) === 1).sort((a, b) => Number(b.size) - Number(a.size)).slice(0, 1);
      if (crew.length !== 1) return handoff(`R${order.number} shift ${shift.id}: no crew position to change`);
      const chiefSize = chief.reduce((a, s) => a + Number(s.size), 0);
      const current = chiefSize + Number(crew[0].size);
      // "Add 2 more, making it 4 x Crew": both written, so both must hold against the shift
      // as it stands. If they disagree the client and OnSinch see different shifts.
      if (r.crew && r.crew_add && r.crew !== current + r.crew_add)
        return handoff(`R${order.number} shift ${shift.id}: ${r.crew_add} more on ${current} makes ${current + r.crew_add}, not the ${r.crew} written`);
      if (r.crew && r.crew_remove && r.crew !== current - r.crew_remove)
        return handoff(`R${order.number} shift ${shift.id}: ${r.crew_remove} fewer on ${current} makes ${current - r.crew_remove}, not the ${r.crew} written`);
      const total = r.crew ?? current + (r.crew_add ?? 0) - (r.crew_remove ?? 0);
      // A shift of 10 or more, or one ops gave several chiefs, keeps its chiefs as ops set them:
      // only the crew position moves (Event Concept R11404, "2 additional crew" on 8 + 2 chiefs).
      if (total > 9 || current > 9 || chief.length > 1 || chiefSize > 1) {
        const size = Number(crew[0].size) + (total - current);
        if (size < 1) return handoff(`R${order.number} shift ${shift.id}: ${total} crew leaves no crew position`);
        if (size !== Number(crew[0].size)) ops.push({ source: src(n), op: { kind: "set_position_size", order_id: Number(order.id), slot_id: Number(crew[0].id), size } });
        why.push(`R${order.number} shift ${shift.id}: ${total} crew in all`);
        continue;
      }
      const shape = positionsFor(total);
      if (!shape) return handoff(`R${order.number}: ${total} crew is not a shape the system builds`);
      if (chief.length > 1 || chiefSize > 1) return handoff(`R${order.number} shift ${shift.id}: ${chiefSize} crew chiefs`);
      // Crossing the 3/4 line keeps ops' shape (positionsFor): 4-9 carry exactly one Crew Chief
      // inside the total, 1-3 none. Up adds the chief's position, down cancels it; the crew
      // position takes the rest. A signed-on chief is the bot's to refuse (run.ts preflight).
      const wantsChief = shape.length === 2;
      const londonStart = utcToLondon(first.beginning).time, londonEnd = utcToLondon(first.end).time;
      if (wantsChief && chiefSize === 0) {
        ops.push({ source: `${src(n)}:chief`, op: { kind: "add_position", order_id: Number(order.id), shift_id: shift.id, date, start: londonStart, end: londonEnd, position: shape[0] } });
      } else if (!wantsChief && chiefSize === 1) {
        ops.push({ source: `${src(n)}:chief`, op: { kind: "cancel_position", order_id: Number(order.id), slot_id: Number(chief[0].id) } });
      }
      ops.push({ source: src(n), op: { kind: "set_position_size", order_id: Number(order.id), slot_id: Number(crew[0].id), size: wantsChief ? total - 1 : total } });
      why.push(`R${order.number} shift ${shift.id}: ${total} crew in all${wantsChief !== (chiefSize === 1) ? (wantsChief ? ", a crew chief added" : ", the crew chief removed") : ""}`);
    }
  }

  // New shifts on a booking the email names (R number, or the thread the bot booked it in)
  // are added to it: Legal Geek's "add a derig on the 13th" is a shift on #13709, not a new
  // order. Only an explicit reference counts; a resemblance never does.
  const pins = [...new Set(news.map((r) => r.order_id).filter((x): x is number => !!x))];
  // One email's new shifts are one job: when the reader put one of them on a booking, the rest
  // of that email's new shifts go there too (Harbour Scenic 10-12, all added to R11508 by ops).
  if (pins.length > 1) return handoff(`new shifts for ${pins.length} existing bookings in one email`);
  const named = news.length ? (pins.length ? clientOrders.find((o) => Number(o.id) === pins[0]) ?? "the picked booking is not readable" : await findOrder(msg, companyId, world, threadOrderId)) : null;
  if (named && typeof named !== "string") {
    // Each of the order's locations, by the OnSinch place it stands at.
    const atPlace = new Map<number, number>();
    for (const t of teams(named)) for (const s of t.slots) if (Number(s.slotlocation_id)) atPlace.set(Number(s.SlotLocation?.place_id), Number(s.slotlocation_id));
    const locations = new Set(atPlace.values());
    // A shift the order already holds over the same window is the client restating the
    // booking ("Re: Crew Booking - Tuesday 13th", Light Motif 10-12), not asking for a second:
    // 12 of the replay's writes ops never made were exactly this.
    const held = (r: Request) => { const w = shiftWindow(r.date!, r.start!, r.end!); return teams(named).some((t) => t.slots.some((x) => Date.parse(x.beginning) === Date.parse(w.beginning) && Date.parse(x.end) === Date.parse(w.end))); };
    const fresh = news.filter((r) => !held(r));
    if (!fresh.length) return { kind: "none", reason: [`already booked: R${named.number}`, ...(i.notes ?? [])].join("; ") };
    const groups = shiftGroups(fresh, clientOrders, live);
    if (typeof groups === "string") return handoff(groups);
    for (const [n, g] of groups.entries()) {
      let location_id = locations.size === 1 ? [...locations][0] : 0;
      // An order at several venues: the venue the client names picks the location, or nothing does.
      if (!location_id && g.venue) {
        const hits = (await placesFor(world, g.venue, clientOrders)).map((p) => atPlace.get(p.id)).filter((x): x is number => !!x);
        if (hits.length === 1) location_id = hits[0];
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
    // Already booked: a client's order holding a live shift over exactly the asked window on
    // that day. Measured 10-07: every engine order in To Confirm duplicated one ops had built
    // by hand. Some booked and some not is for a person to untangle.
    // The venue counts when the email names one OnSinch knows: EMS's Mandarin Oriental install
    // (10-09) has the same day, hours and crew as its Roundhouse derig, and was not booked.
    const orders = clientOrders;
    const placeIds = new Map<Request, Set<number> | null>();
    for (const r of news) {
      const venue = r.venue ?? news.find((x) => x.venue)?.venue;
      const places = venue ? await placesFor(world, venue, clientOrders) : [];
      placeIds.set(r, places.length === 1 ? new Set(places.map((p) => Number(p.id))) : null);
    }
    const bookedIn = (r: Request) => {
      const w = shiftWindow(r.date!, r.start!, r.end!);
      const at = placeIds.get(r);
      return orders.find((o) => teams(o).some((t) => t.slots.some((s) => Date.parse(s.beginning) === Date.parse(w.beginning) && Date.parse(s.end) === Date.parse(w.end)
        && (!at || at.has(Number(s.SlotLocation?.place_id))))));
    };
    const booked = news.map(bookedIn);
    if (booked.every(Boolean)) return { kind: "none", reason: `already booked: ${[...new Set(booked.map((o) => `R${o.number}`))].join(", ")}` };
    // Some of it already booked, all in ONE order: the email re-lists that booking and adds to
    // it ("Yes please, 2 x crew also for 2 hours at 21:30", Encore 10-09, which ops added to
    // R11498). The rest is added to that order at its one location; anything else is a person's.
    if (booked.some(Boolean)) {
      const hit = [...new Set(booked.filter(Boolean).map((o) => Number(o.id)))];
      const o = booked.find(Boolean);
      const locs = new Set(teams(o).flatMap((t) => t.slots.map((x) => Number(x.slotlocation_id)).filter(Boolean)));
      const rest = news.filter((_, k) => !booked[k]);
      const groups = hit.length === 1 && locs.size === 1 ? shiftGroups(rest, clientOrders, live) : null;
      if (!groups || typeof groups === "string") return handoff(`part of this is already booked (${booked.filter(Boolean).map((x) => `R${x.number}`).join(", ")})`);
      for (const [n, g] of groups.entries()) {
        ops.push({ source: src(50 + n), op: { kind: "add_shift", order_id: Number(o.id), location_id: [...locs][0], name: "Crew", date: g.date, start: g.start, end: g.end, positions: g.positions } });
        why.push(`R${o.number}: add a shift on ${g.date} ${g.start}-${g.end}, ${g.label} (the rest of the email is already booked there)`, ...g.notes);
      }
      const notes = i.notes ?? [];
      return { kind: "write", ops, why: [...why, ...notes] };
    }
    const shifts: ShiftSpec[] = [];
    const groups = shiftGroups(news, clientOrders, live);
    if (typeof groups === "string") return handoff(groups);
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
        const places = await placesFor(world, venue, clientOrders);
        if (places.length > 1) return handoff(`${places.length} OnSinch venues are named "${venue}"`);
        place = places.length ? { id: String(places[0].id), name: places[0].name } : { id: `new:${venue.trim().slice(0, 120)}`, name: venue.trim().split(",")[0].slice(0, 80) };
        if (!places.length) extra.push(`venue "${venue.trim()}" is new to OnSinch and was added`);
      }
      if (!place) return ask("no venue in the email");
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
    const specification = [`From ${msg.from}: "${msg.subject}"`, ...groups.map((g) => `${g.date} ${g.start}-${g.end}: ${g.label}`)].join("\n").slice(0, 1000);
    ops.push({ source: src(100), op: { kind: "create_order", company_id: String(companyId), company_name: who, client_email: msg.from, job_name, po: i.po, specification, shifts } });
    why.push(`new order: ${shifts.length} shift(s) at ${venueName}`, ...extra);
  } else if (i.po) {
    // The order a PO is for: the email's R number or the thread's order, never a day's only
    // booking (findOrder). A PO is cosmetic (Ben: 1 in 50), so one with no order named is left
    // off with the reason, not a card.
    const order = (i.order_id ? clientOrders.find((o) => Number(o.id) === i.order_id) : null) ?? (await findOrder(msg, companyId, world, threadOrderId));
    if (typeof order === "string") return { kind: "none", reason: `PO ${i.po} left off: ${order}` };
    // A PO already on the order is never replaced by the system: the client correcting one is
    // rare, and a reference misread as a PO would overwrite the real one.
    const had = String(order.intern_name ?? "").trim();
    if (had && had !== i.po) return handoff(`R${order.number} already has PO ${had}; the email gives ${i.po}`);
    if (had !== i.po) ops.push({ source: src(200), op: { kind: "set_po", order_id: Number(order.id), po: i.po } });
    why.push(`R${order.number}: PO ${i.po}`);
  }
  const notes = i.notes ?? [];
  return ops.length ? { kind: "write", ops, why: [...why, ...notes] } : { kind: "none", reason: [why.join("; ") || "already as asked", ...notes].join("; ") };
}
