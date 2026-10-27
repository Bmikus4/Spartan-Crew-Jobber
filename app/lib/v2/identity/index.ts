// ============================================================================
// WHICH ORDER AN EMAIL IS ABOUT: ONE RULE, ASKED BY EVERY PART THAT NEEDS IT (addendum 5.3, R8).
// ----------------------------------------------------------------------------
// Until 27 Oct the planner's findOrder, the thread state, "already booked" and the TV verifier
// each answered with a rule of its own, and they disagreed (the map, shown to the owner before
// this was built: claude.ai/artifact/6VWRB2Ymd3pst5QTbdL4zG). An answer is one of:
//   one       exactly one order carries the evidence, and `by` says what proved it
//   several   two or more carry it equally; a person picks (at most 3 are named)
//   none      nothing does, and `why` says so
// The ladder, strongest first:
//   1. an R or J number in the newest email's words or a subject (two such orders: a person);
//   2. the thread's link, while its order holds a day asked for;
//   3. a number elsewhere in the thread whose order holds a day asked for;
//   4. a PO or project reference on exactly one of the client's orders;
//   5. the day and one more fact (venue, start, crew), singling out one order of everything the
//      client has that day. NEVER THE DAY ALONE (Ben, 10-03 and 10-15). [DECISIONS V1]
//   6. the link, holding none of the days asked.
// A NUMBER IN QUOTED TEXT NEVER DECIDES WHEN NO DAY IS ASKED (F11): "see R12345 for the other job"
// quoted under "thanks" linked the thread. With a day asked it does, when its order holds the day:
// Harbour Scenic's R11508 stood only in the quote of our confirmation, which the thread store never
// held, and ops added the email's shifts to it (1a1308b99b2eaf9b, replay 10-27).
// `add` is for new shifts on an existing booking: only a number or the link places them there,
// never a resemblance (plan.ts: a new booking is never attached to an order by resemblance), and a
// number in the email itself needs no day held, since the shifts are new.
// ============================================================================
import { latestText } from "../interpret/ground";
import { utcToLondon } from "../bot/ops";
import type { ThreadMsg, Grounded } from "../threadState";

/** Where a written R or J number stands, which decides what it can prove. */
export type Where = "newest" | "subject" | "client" | "ours" | "quoted";
export type Ref = { kind: "R" | "J"; value: string; where: Where };
export type OrderRef = { id: number; r: string; j: string | null; by: string };
export type Identity =
  | { kind: "one"; order: OrderRef }
  /**
   * lead: the one of them holding a day asked, when exactly one does. A card may name it; nothing is
   * written to it, since the email named the others too.
   */
  | { kind: "several"; orders: OrderRef[]; why: string; lead?: OrderRef }
  | { kind: "none"; why: string };

export type Facts = {
  refs: Ref[];
  /** Every dated request the thread asked for, grounded or as the reader gave it. */
  requests: Grounded[];
  /** The thread's link (threadOrder.ts), if any. */
  link: number | null;
  /** The thread's text, for PO and project references. */
  text: string;
  /** Places that say nothing about where a job is ("No Location", "TBC"): never a venue fact. */
  generic?: Set<number>;
};

/**
 * A place name that says nothing about where a job is, as normName gives it: "No Location" (6922,
 * where a booking with no venue goes, plan.ts), "TBC", "Various". Never a venue fact.
 */
export const GENERIC_PLACE = /^(no location|location|tbc|tba|tbd|to be confirmed|various|various locations|venue|site|placeholder)$/;

// "R11507", "R 11507", "R#11507", "order no. 11507", and the older 4-digit numbers (R9001). "Repeat of
// R11000" names the job being copied, not this one (resolve.ts rNumbersIn, measured on staff's own subjects).
const R_RE = /\b(?:R\s*\.?\s*#?\s*|order\s*(?:no\.?|number|#)?\s*[#:-]?\s*)(\d{4,6})\b/gi;
const J_RE = /\bJ[\s#:-]?(1\d{4,5})\b/g;
const REPEAT = /\brepeat\s+(?:of\s+)?r\s*\.?\s*#?\s*\d{3,6}\b/gi;
const PO_RE = /\b(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,}\b/gi;

function scan(text: string, where: Where, out: Ref[]): void {
  const t = text.replace(REPEAT, " ");
  for (const m of t.matchAll(R_RE)) out.push({ kind: "R", value: m[1], where });
  for (const m of t.matchAll(J_RE)) out.push({ kind: "J", value: m[1], where });
}

/**
 * Every R and J number in the thread, by where it stands. `newest` is the email being decided
 * (its newest words and subject); without it the last client email's own words are the newest.
 */
export function refsIn(thread: ThreadMsg[], newest?: { subject: string; text: string }): Ref[] {
  const out: Ref[] = [];
  if (newest) { scan(newest.subject, "subject", out); scan(newest.text, "newest", out); }
  const lastClient = newest ? -1 : thread.map((m) => !m.ours).lastIndexOf(true);
  thread.forEach((m, k) => {
    const body = m.body.replace(/\r/g, "");
    const own = latestText(body);
    const end = own ? body.indexOf(own) + own.length : 0;
    scan(m.subject, "subject", out);
    scan(own, k === lastClient ? "newest" : m.ours ? "ours" : "client", out);
    scan(body.slice(end), "quoted", out);
  });
  return out;
}

const live = (o: any) => !!o && Number(o.status) !== -1;
const jOf = (o: any): string | null => { const j = ([] as any[]).concat(o?.Job ?? [])[0]; return j?.id ? `J${j.id}` : null; };
export const refOf = (o: any, by: string): OrderRef => ({ id: Number(o.id), r: `R${o.number}`, j: jOf(o), by });
const slotsOf = (o: any): any[] => ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j?.SlotTeam ?? []))
  .flatMap((t: any) => ([] as any[]).concat(t?.Slot ?? [])).filter((s: any) => s?.cancelled !== true && s?.beginning);
export const daysOn = (o: any): string[] => slotsOf(o).map((s) => utcToLondon(s.beginning).date);

const STOP = new Set(["the", "and", "hotel", "london", "house", "centre", "center", "hall", "venue", "place", "street", "road", "park"]);
const words = (s: unknown): string[] => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4 && !STOP.has(x));

/**
 * The facts besides the day that tie an order to the requests: the venue (a place the email
 * named, never a generic one), a start on that day, the crew on that day, the venue's words in
 * the order's name ("Creative Technology @ Cytiva").
 */
function factsFor(o: any, f: Facts): string[] {
  // A change names its shift by the day it is on (target) and may give a new day (date): both count.
  const days = new Set(f.requests.flatMap((r) => [r.date, r.target?.date]).filter((d): d is string => !!d));
  const on = slotsOf(o).filter((s) => days.has(utcToLondon(s.beginning).date));
  if (!on.length) return [];
  const out: string[] = [];
  const places = new Set(f.requests.map((r) => Number(r.place_id)).filter((p) => p > 0 && !f.generic?.has(p)));
  if (places.size && on.some((s) => places.has(Number(s?.SlotLocation?.place_id)))) out.push("venue");
  const starts = new Set(on.map((s) => `${utcToLondon(s.beginning).date}|${utcToLondon(s.beginning).time}`));
  if (f.requests.some((r) => (r.date && r.start && starts.has(`${r.date}|${r.start}`)) || (r.target?.date && r.target.start && starts.has(`${r.target.date}|${r.target.start}`)))) out.push("start time");
  const totals = new Map<string, number>();
  for (const s of on) { const d = utcToLondon(s.beginning).date; totals.set(d, (totals.get(d) ?? 0) + Number(s.size || 0)); }
  if (f.requests.some((r) => r.date && r.crew && totals.get(r.date) === r.crew)) out.push("crew count");
  const venues = new Set(f.requests.flatMap((r) => words(r.venue)));
  const at = String(o.name ?? "").split("@").slice(1).join("@");
  if (venues.size && !out.includes("venue") && words(at).some((x) => venues.has(x))) out.push("venue name");
  return out;
}

/** The one order the facts single out among `orders`, or why there is not one. */
export function identify(f: Facts, orders: any[], opts: { companyIds: number[]; add?: boolean }): Identity {
  const byId = new Map(orders.map((o) => [Number(o.id), o]));
  const byNumber = new Map(orders.map((o) => [String(o.number), o]));
  const byJob = new Map<string, any>();
  for (const o of orders) for (const j of ([] as any[]).concat(o?.Job ?? [])) byJob.set(String(j.id), o);
  const mine = (o: any) => !opts.companyIds.length || opts.companyIds.includes(Number(o.company_id));
  const asked = new Set(f.requests.flatMap((r) => [r.date, r.target?.date]).filter((d): d is string => !!d));
  const holds = (o: any) => !asked.size || daysOn(o).some((d) => asked.has(d));
  // The email's own number and the link place new shifts whatever days the order holds.
  const placesNew = (o: any) => !!opts.add || holds(o);
  const orderOf = (r: Ref) => (r.kind === "R" ? byNumber.get(r.value) : byJob.get(r.value));
  const named = (where: Where[]) => [...new Map(f.refs.filter((r) => where.includes(r.where)).map(orderOf)
    .filter((o) => live(o) && mine(o)).map((o) => [Number(o.id), o])).values()];
  // Several named orders holding the days equally: the day and its facts decide among them alone.
  let tied: any[] | null = null, tiedBy = "";
  const pick = (os: any[], by: string, fits: (o: any) => boolean = holds): Identity | null => {
    const held = os.filter(fits);
    if (held.length === 1) return { kind: "one", order: refOf(held[0], by) };
    if (held.length < 2) return null;
    // Several named, holding the days: the one holding more of them (Harbour Scenic names its
    // September R10950 and its October R11508).
    const n = (o: any) => new Set(daysOn(o).filter((d) => asked.has(d))).size;
    const most = Math.max(...held.map(n));
    const top = held.filter((o) => n(o) === most);
    if (top.length === 1) return { kind: "one", order: refOf(top[0], `${by}, and the most days asked`) };
    if (opts.add) return { kind: "several", orders: top.slice(0, 3).map((o) => refOf(o, by)), why: `the email names ${top.length} orders` };
    if (!tied) { tied = top; tiedBy = by; }
    return null;
  };

  // Two orders named in the email itself are for a person, whatever days they hold: "For R1 and R2,
  // could the shift on Friday be 8-4?" may mean both (harness "two R numbers", plan.ts since 10-06).
  const inEmail = named(["newest", "subject"]);
  if (inEmail.length > 1) {
    const holding = asked.size ? inEmail.filter(holds) : [];
    return { kind: "several", orders: inEmail.slice(0, 3).map((o) => refOf(o, "its number in the email")), why: `the email names ${inEmail.length} orders`,
      ...(holding.length === 1 ? { lead: refOf(holding[0], "its number in the email, the one holding the day asked") } : {}) };
  }
  const fresh = pick(inEmail, "its number in the email", placesNew);
  if (fresh) return fresh;
  const linked = f.link ? byId.get(Number(f.link)) : null;
  if (live(linked) && placesNew(linked)) return { kind: "one", order: refOf(linked, "link") };
  const elsewhere = [...new Map([...named(["client", "ours"]), ...(asked.size ? named(["quoted"]) : [])].map((o) => [Number(o.id), o])).values()];
  const thread = tied ? null : pick(elsewhere, "its number in the thread");
  if (thread) return thread;
  if (opts.add) return { kind: "none", why: "no order is named" };

  const client = orders.filter((o) => live(o) && mine(o));
  const tokens = new Set([...f.text.matchAll(PO_RE)].map((x) => x[0].toUpperCase()));
  const po = client.filter((o) => {
    const p = String(o.intern_name ?? "").trim().toUpperCase();
    if (p.length >= 5 && tokens.has(p)) return true;
    return String(o.name ?? "").toUpperCase().split(/[^A-Z0-9-]+/).some((x) => x.length >= 5 && /\d/.test(x) && tokens.has(x));
  }).filter(holds);
  if (po.length === 1) return { kind: "one", order: refOf(po[0], "its PO or project reference in the thread") };

  if (asked.size) {
    const scored = (tied ?? client).map((o) => ({ o, by: factsFor(o, f) })).filter((x) => x.by.length);
    if (scored.length) {
      const best = Math.max(...scored.map((x) => x.by.length));
      let top = scored.filter((x) => x.by.length === best);
      // Equal evidence: the order holding more of the days asked. SN ExCeL asks for the 17th,
      // 18th, 20th and 21st; COG's R10522 holds all four, its R10304 three.
      if (top.length > 1) {
        const n = (o: any) => new Set(daysOn(o).filter((d) => asked.has(d))).size;
        const most = Math.max(...top.map((x) => n(x.o)));
        top = top.filter((x) => n(x.o) === most);
        if (top.length === 1) return { kind: "one", order: refOf(top[0].o, `the day and ${top[0].by.join(" + ")}, and the most days asked`) };
      }
      if (top.length === 1) return { kind: "one", order: refOf(top[0].o, `the day and ${top[0].by.join(" + ")}`) };
      return { kind: "several", orders: top.slice(0, 3).map((x) => refOf(x.o, `the day and ${x.by.join(" + ")}`)), why: `${top.length} of the client's orders fit equally` };
    }
  }
  const t = tied as any[] | null;
  if (t) return { kind: "several", orders: t.slice(0, 3).map((o) => refOf(o, tiedBy)), why: `${t.length} orders are named, each holding the days asked` };
  if (live(linked)) return { kind: "one", order: refOf(linked, "link (it holds none of the days asked)") };
  return { kind: "none", why: "no order is named, and none holds a day asked with one more fact" };
}

/**
 * The orders already holding every dated request, or null when one is in none. Each request is
 * identified on its own, among everything the client has that day: two same-day jobs at other
 * venues with the same crew do not both "hold" a third (F9). Several orders holding one request
 * count only when all were made after `after`: staff booking a quote's options as separate orders
 * (Subfrantic 10-16: R11701 and R11705 for Job 2's two options).
 */
export function covered(requests: Grounded[], orders: any[], opts: { companyIds: number[]; after?: number; generic?: Set<number> }): OrderRef[] | null {
  const dated = requests.filter((r) => r.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!dated.length) return null;
  const out = new Map<number, OrderRef>();
  for (const r of dated) {
    const id = identify({ refs: [], requests: [r], link: null, text: "", generic: opts.generic }, orders, { companyIds: opts.companyIds });
    if (id.kind === "one" && /^the day and/.test(id.order.by)) { out.set(id.order.id, id.order); continue; }
    if (id.kind === "several" && opts.after != null && id.orders.every((o) => Date.parse(orders.find((x) => Number(x.id) === o.id)?.created) > opts.after!)) {
      for (const o of id.orders) out.set(o.id, o);
      continue;
    }
    return null;
  }
  return [...out.values()];
}

/** The OnSinch places an order's live shifts stand at. */
export const placesOn = (o: any): Set<number> => new Set(slotsOf(o).map((s) => Number(s?.SlotLocation?.place_id)).filter((p) => p > 0));

/**
 * Whether a shift counts for a call at `at` (the places the email's venue names): on an order standing at
 * several places, only those there do (F10: "the ExCeL call" changed Olympia's shift with the same window,
 * and a new ExCeL shift read as already booked by Olympia's). With no venue named, or an order at one
 * place, every shift counts.
 */
export const atVenue = (o: any, at: Set<number> | null | undefined) => {
  const here = at?.size && placesOn(o).size > 1 ? at : null;
  return (s: any) => !here || here.has(Number(s?.SlotLocation?.place_id));
};

/** How far, in minutes, a shift's start may sit from the asked one and still be the same booking (F9). */
export const NEAR_MINUTES = 60;

/**
 * THE NEAR MISS (F9's strict half): a shift that day at the venue whose start is within NEAR_MINUTES of the
 * asked start but not at it, as London's clock reads it ("07:30"), or null. Staff's 07:30 against an asked
 * 08:00 read as a fresh call, so the bot could book the job a second time. `sameVenue`: the shift must stand
 * at a place in `at` whatever the order holds; without it the order the email named is its own venue.
 * Without the venue a client running several jobs a day had one taken for the new booking (Creative
 * Technology, 1a13b915f3a326a3: staff made R11588 for it).
 */
export function nearStart(o: any, date: string, start: string, at?: Set<number> | null, sameVenue = false): string | null {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if (sameVenue && !at?.size) return null;
  const fits = sameVenue ? (s: any) => at!.has(Number(s?.SlotLocation?.place_id)) : atVenue(o, at);
  for (const s of slotsOf(o)) {
    if (!fits(s)) continue;
    const l = utcToLondon(s.beginning);
    if (l.date !== date || l.time === start) continue;
    if (Math.abs(mins(l.time) - mins(start)) <= NEAR_MINUTES) return l.time;
  }
  return null;
}
