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
import { matchCompanyByDomain, rNumbersIn, normName } from "../../engine/resolve";

export type World = {
  companies(): Promise<any[]>;
  placesNamed(name: string): Promise<{ id: number; name: string }[]>;
  companyOrders(companyId: number): Promise<any[]>;
  orderByNumber(rNumber: string): Promise<any | null>;
};

export type Message = { message_id: string; from: string; subject: string; sentIso: string; text: string };

export type Decision =
  | { kind: "write"; ops: { source: string; op: Op }[]; why: string[] }
  | { kind: "handoff"; reasons: string[] }
  | { kind: "none"; reason: string };

const handoff = (...reasons: string[]): Decision => ({ kind: "handoff", reasons });

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
  if (cands.length !== 1) return `${cands.length} shifts on ${day} could be the one meant`;
  return cands[0];
}

/**
 * The OnSinch places a venue name means. Exact names only, never a resemblance. Clients
 * often write the address after the name ("The Peninsula, 1 Grosvenor Place, ..."), so the
 * name before the first comma is tried too.
 */
async function placesFor(world: World, venue: string): Promise<{ id: number; name: string }[]> {
  const exact = (await world.placesNamed(venue)).filter((p) => normName(p.name) === normName(venue));
  const head = venue.split(",")[0].trim();
  return exact.length || head === venue ? exact : (await world.placesNamed(head)).filter((p) => normName(p.name) === normName(head));
}

async function findOrder(msg: Message, companyId: number, world: World, threadOrderId: number | null, day?: string, venue?: string): Promise<any | string> {
  const rs = rNumbersIn(`${msg.subject}\n${msg.text}`);
  if (rs.length > 1) return `the email names ${rs.length} orders`;
  if (rs.length === 1) {
    const o = await world.orderByNumber(rs[0]);
    if (!o) return `R${rs[0]} not found`;
    return Number(o.company_id) === companyId ? o : `R${rs[0]} belongs to another client`;
  }
  const orders = await world.companyOrders(companyId);
  if (threadOrderId) {
    const o = orders.find((x) => Number(x.id) === threadOrderId);
    if (o) return o;
  }
  if (!day) return "no order is named";
  const onDay = orders.filter((o) => teams(o).some((t) => t.slots.some((s) => dayOf(s.beginning) === day)));
  if (onDay.length === 1) return onDay[0];
  // Several bookings that day: the venue the client wrote can name one (Blackout 10-09, three
  // orders on the 13th, "Wonder London - Old Billingsgate"). Its place must be on that day.
  if (onDay.length > 1 && venue) {
    const ids = new Set((await placesFor(world, venue)).map((p) => p.id));
    const atVenue = onDay.filter((o) => teams(o).some((t) => t.slots.some((s) => dayOf(s.beginning) === day && ids.has(Number(s.SlotLocation?.place_id)))));
    if (atVenue.length === 1) return atVenue[0];
  }
  return onDay.length ? `${onDay.length} of the client's orders have a shift on ${day}` : `no booking for this client on ${day}`;
}

export async function plan(msg: Message, i: Interpretation, world: World, threadOrderId: number | null = null): Promise<Decision> {
  const problems = [...i.problems, ...i.requests.flatMap((r) => r.problems)];
  if (problems.length) return handoff(...problems);
  if (i.intent === "quote_request") return handoff("the client asked for a quote");
  if (i.intent === "unclear") return handoff("the request is unclear");
  if (i.intent === "info_only" && !i.po) return { kind: "none", reason: ["no change asked for", ...(i.notes ?? [])].join("; ") };

  const companyId = matchCompanyByDomain(msg.from, await world.companies());
  if (!companyId) return handoff(`no single client company for ${msg.from}`);
  const ops: { source: string; op: Op }[] = [];
  const why: string[] = [];
  const src = (n: number) => `${msg.message_id}#${n}`;

  const news = i.requests.filter((r) => r.action === "new_shift");
  const changes = i.requests.filter((r) => r.action !== "new_shift");

  for (const [n, r] of changes.entries()) {
    const order = await findOrder(msg, companyId, world, threadOrderId, r.target?.date ?? r.date, r.venue);
    if (typeof order === "string") return handoff(order);
    const shift = targetShift(order, r);
    if (typeof shift === "string") return handoff(`R${order.number}: ${shift}`);
    const first = shift.slots[0];
    const date = dayOf(first.beginning);
    if (r.action === "change_times") {
      // "Tuesday 13th 2 x Crew 8 hours": a count written beside a time change says which shift
      // the client means, so it must be that shift's size or this is another shift.
      const size = shift.slots.reduce((a, s) => a + Number(s.size), 0);
      if (r.crew && r.crew !== size) return handoff(`R${order.number} shift ${shift.id}: the email says ${r.crew} crew, the shift has ${size}`);
      const start = r.start ?? utcToLondon(first.beginning).time;
      // "Increase hours to 8 (currently 6)": the client gave a length, not a time. The
      // shift keeps its start and the end moves (Ben, 10-09).
      const end = r.end ?? (r.duration ? addMinutes(start, r.duration) : utcToLondon(first.end).time);
      for (const s of shift.slots) ops.push({ source: `${src(n)}:${s.id}`, op: { kind: "set_position_times", order_id: Number(order.id), slot_id: Number(s.id), date, start, end } });
      why.push(`R${order.number} shift ${shift.id}: times to ${start}-${end}`);
    } else if (r.action === "cancel_shift") {
      for (const s of shift.slots) ops.push({ source: `${src(n)}:${s.id}`, op: { kind: "cancel_position", order_id: Number(order.id), slot_id: Number(s.id) } });
      why.push(`R${order.number} shift ${shift.id}: cancelled`);
    } else if (r.action === "change_crew") {
      const chief = shift.slots.filter((s) => Number(s.role) === 1);
      const crew = shift.slots.filter((s) => Number(s.role) !== 1 && Number(s.profession_id) === 1);
      if (crew.length !== 1) return handoff(`R${order.number} shift ${shift.id}: ${crew.length} crew positions`);
      const chiefSize = chief.reduce((a, s) => a + Number(s.size), 0);
      const current = chiefSize + Number(crew[0].size);
      // "Add 2 more, making it 4 x Crew": both written, so both must hold against the shift
      // as it stands. If they disagree the client and OnSinch see different shifts.
      if (r.crew && r.crew_add && r.crew !== current + r.crew_add)
        return handoff(`R${order.number} shift ${shift.id}: ${r.crew_add} more on ${current} makes ${current + r.crew_add}, not the ${r.crew} written`);
      const total = r.crew ?? current + (r.crew_add ?? 0);
      const shape = positionsFor(total);
      if (!shape) return handoff(`R${order.number}: ${total} crew is not a shape the system builds`);
      if ((shape.length === 2) !== (chiefSize === 1)) return handoff(`R${order.number}: ${total} crew changes whether the shift needs a crew chief`);
      ops.push({ source: src(n), op: { kind: "set_position_size", order_id: Number(order.id), slot_id: Number(crew[0].id), size: total - chiefSize } });
      why.push(`R${order.number} shift ${shift.id}: ${total} crew in all`);
    }
  }

  // New shifts on a booking the email names (R number, or the thread the bot booked it in)
  // are added to it: Legal Geek's "add a derig on the 13th" is a shift on #13709, not a new
  // order. Only an explicit reference counts; a resemblance never does.
  const named = news.length ? await findOrder(msg, companyId, world, threadOrderId) : null;
  if (named && typeof named !== "string") {
    const locations = new Set(teams(named).flatMap((t) => t.slots.map((s: any) => Number(s.slotlocation_id))).filter(Boolean));
    if (locations.size !== 1) return handoff(`R${named.number} has ${locations.size} locations; which one the new shift belongs to is not written`);
    const location_id = [...locations][0];
    for (const [n, r] of news.entries()) {
      const positions = positionsFor(r.crew!);
      if (!positions) return handoff(`${r.crew} crew is not a shape the system builds`);
      ops.push({ source: src(50 + n), op: { kind: "add_shift", order_id: Number(named.id), location_id, name: "Crew", date: r.date!, start: r.start!, end: r.end!, positions } });
      why.push(`R${named.number}: add a shift on ${r.date} ${r.start}-${r.end}, ${r.crew} crew`);
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
    const orders = await world.companyOrders(companyId);
    const placeIds = new Map<Request, Set<number> | null>();
    for (const r of news) {
      const venue = r.venue ?? news.find((x) => x.venue)?.venue;
      const places = venue ? await placesFor(world, venue) : [];
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
    if (booked.some(Boolean)) return handoff(`part of this is already booked (${booked.filter(Boolean).map((o) => `R${o.number}`).join(", ")})`);
    const shifts: ShiftSpec[] = [];
    for (const r of news) {
      const positions = positionsFor(r.crew!);
      if (!positions) return handoff(`${r.crew} crew is not a shape the system builds`);
      if (r.crew_chief && positions.length === 1) return handoff("a crew chief was asked for on a crew of 3 or fewer");
      const venue = r.venue ?? news.find((x) => x.venue)?.venue;
      if (!venue) return handoff("no venue in the email");
      const places = await placesFor(world, venue);
      if (places.length !== 1) return handoff(`${places.length} OnSinch venues are named "${venue}"`);
      shiftWindow(r.date!, r.start!, r.end!);
      shifts.push({ name: "Crew", date: r.date!, start: r.start!, end: r.end!, place_id: String(places[0].id), place_label: places[0].name, positions });
    }
    const companies = await world.companies();
    const company = companies.find((c) => Number(c.id) === companyId);
    const venueName = shifts[0].place_label;
    ops.push({ source: src(100), op: { kind: "create_order", company_id: String(companyId), company_name: String(company?.name ?? "").trim(), client_email: msg.from, job_name: `${String(company?.name ?? "").trim()} @ ${venueName}`, po: i.po, shifts } });
    why.push(`new order: ${shifts.length} shift(s) at ${venueName}`);
  } else if (i.po) {
    const order = await findOrder(msg, companyId, world, threadOrderId);
    if (typeof order === "string") return handoff(`PO ${i.po}: ${order}`);
    if ((order.intern_name ?? "") !== i.po) ops.push({ source: src(200), op: { kind: "set_po", order_id: Number(order.id), po: i.po } });
    why.push(`R${order.number}: PO ${i.po}`);
  }
  const notes = i.notes ?? [];
  return ops.length ? { kind: "write", ops, why: [...why, ...notes] } : { kind: "none", reason: [why.join("; ") || "already as asked", ...notes].join("; ") };
}
