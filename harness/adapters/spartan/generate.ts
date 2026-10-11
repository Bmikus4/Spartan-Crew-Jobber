// ============================================================================
// Simulated client emails, each with its fake OnSinch, its correct final state, and the
// reading a perfect model would give (the "oracle"). Seeded, so the same seed is the same
// 500 cases forever, and a recording made today replays next month.
// ----------------------------------------------------------------------------
// The expected outcome is the BUSINESS answer, not what the code happens to do: an email
// that books "a crew of 4" should create an order whether or not today's parser can read it.
// A gap between the two is a finding, which is the point of running the cases.
// Wording: the date, time and count shapes are the ones measured in real client mail
// (test/v2Ground.ts); the people, companies and venues are made up.
// ============================================================================
import type { Case } from "../../core/types";
import type { Extraction, RawRequest } from "../../../app/lib/v2/interpret/extract";
import type { MessageIn } from "../../../app/lib/v2/process";
import type { Op } from "../../../app/lib/v2/bot/ops";
import { positionsFor } from "../../../app/lib/v2/interpret/plan";
import { addMinutes } from "../../../app/lib/v2/interpret/ground";
import { CLIENTS, COMPANIES, PLACES, UNIQUE_PLACES, orderRecord, type Company, type OrderSpec, type Place } from "./world";

export type SpartanInput = { message: MessageIn; orders: OrderSpec[]; threadOrderId: number | null; oracle: Extraction; company_id: number | null };
export type SpartanExpected = { kind: "write" | "handoff" | "none"; intents: Extraction["intent"][]; ops: Op[] };
export type SpartanCase = Case<SpartanInput, SpartanExpected> & { template: string };

// --- seeded randomness -------------------------------------------------------------
type Rng = () => number;
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// --- dates and words -----------------------------------------------------------------
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const londonDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));

function dayWords(day: string, r: Rng): string {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = WD[d.getUTCDay()], m = MO[d.getUTCMonth()], n = d.getUTCDate();
  return pick(r, [
    `${wd} ${ord(n)} ${m}`, `${String(n).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    `${ord(n)} ${m.slice(0, 3)}`, `${wd.slice(0, 3)} ${n} ${m.slice(0, 3)}`, `${m} ${ord(n)}`, `${wd} the ${ord(n)}`,
  ]);
}

function timeWords(hhmm: string, r: Rng): string {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12, ap = h < 12 ? "am" : "pm";
  return pick(r, [
    hhmm, m ? `${h12}.${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`, `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`,
    m ? `${h12}:${String(m).padStart(2, "0")} ${ap.toUpperCase()}` : `${h12}${ap.toUpperCase()}`,
  ]);
}

function rangeWords(start: string, end: string, r: Rng) {
  const a = timeWords(start, r), b = timeWords(end, r);
  return { text: pick(r, [`${a} - ${b}`, `${a}-${b}`, `${a} till ${b}`, `from ${a} to ${b}`, `${a} to ${b}`]), a, b };
}

const crewWords = (n: number, r: Rng) => pick(r, [`${n} x crew`, `${n} crew`, `x${n} crew`, `${n} x Crew`, `${n} crew members`]);

const GREET = ["Hi,", "Hi team,", "Hello,", "Morning all,", "Hi Dan,", "Good afternoon,"];
function signoff(person: string, company: string, r: Rng) {
  return pick(r, [
    `Thanks,\n${person.split(" ")[0]}`,
    `Kind regards,\n${person}\nProduction Manager | ${company}\nM: 07700 9${String(int(r, 10000, 99999))}`,
    `Many thanks\n${person}\n${company}`,
    `Cheers,\n${person.split(" ")[0]}\n\nSent from my iPhone`,
  ]);
}
const quotedHistory = (r: Rng) =>
  pick(r, [
    `\n\nOn Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:\n> Hi, thanks for your email, we will get this booked in.\n> Thanks, Dan`,
    `\n\n-----Original Message-----\nFrom: Bookings <bookings@spartancrew.co.uk>\nSent: 02 October 2026 14:11\nSubject: RE: Crew\n\nThanks, all noted on our side.`,
    "",
  ]);

// --- shifts ----------------------------------------------------------------------------
/** Day starts and lengths; a night shift is 22:00 for 4h, so no end falls in the clock-change hour. */
function shiftTimes(r: Rng): { start: string; end: string } {
  if (r() < 0.12) return { start: "22:00", end: "02:00" };
  const start = pick(r, ["06:30", "07:00", "08:00", "09:00", "09:30", "10:00", "12:00", "13:00", "14:00"]);
  return { start, end: addMinutes(start, 60 * pick(r, [4, 5, 6, 8, 10])) };
}

// --- extraction builders -----------------------------------------------------------------
const g = <T>(value: T, quote: string) => ({ value, quote });
const req = (p: Partial<RawRequest>): RawRequest => ({ action: "new_shift", date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, venue: null, crew_chief: null, trade: null, target: null, ...p });
const ex = (intent: Extraction["intent"], requests: RawRequest[], po: Extraction["po"] = null): Extraction => ({ intent, po, requests, note: "" });

// --- the case factory ---------------------------------------------------------------------
type Ctx = { i: number; r: Rng; sent: string; today: string; idBase: number };
type Built = Omit<SpartanCase, "id" | "source"> & { from?: string };

function sender(r: Rng, pool: Company[] = CLIENTS) {
  const c = pick(r, pool);
  const person = pick(r, c.people);
  const addr = `${person.split(" ")[0].toLowerCase()}@${c.domain}`;
  return { c, person, addr, from: `${person} <${addr}>` };
}
function order(ctx: Ctx, k: number, company_id: number, shifts: OrderSpec["shifts"], po?: string): OrderSpec {
  return { id: ctx.idBase + k, number: 40000 + ctx.i * 4 + k, company_id, shifts, ...(po ? { po } : {}) };
}
/** The positions of shift n of an order, as the order record holds them. */
const slotsOf = (o: OrderSpec, n: number) => (orderRecord(o).Job[0].SlotTeam[n].Slot as any[]);
const jobDay = (ctx: Ctx, lo = 3, hi = 20) => addDays(ctx.today, int(ctx.r, lo, hi));
const write = (intents: Extraction["intent"][], ops: Op[]): SpartanExpected => ({ kind: "write", intents, ops });
const person = (intents: Extraction["intent"][]): SpartanExpected => ({ kind: "handoff", intents, ops: [] });
const none = (intents: Extraction["intent"][]): SpartanExpected => ({ kind: "none", intents, ops: [] });

function mail(ctx: Ctx, s: ReturnType<typeof sender>, subject: string, text: string, history = true): MessageIn {
  return {
    message_id: `sim-${String(ctx.i).padStart(4, "0")}`, thread_id: `sim-thread-${ctx.i}`, from_address: s.from, date_iso: ctx.sent,
    subject, body: `${pick(ctx.r, GREET)}\n\n${text}\n\n${signoff(s.person, s.c.name, ctx.r)}${history ? quotedHistory(ctx.r) : ""}`, is_from_spartan: false,
  };
}

type Template = { name: string; branch: string; rules: string[]; n: number; build: (ctx: Ctx) => Built };

function newBooking(ctx: Ctx, opts: { po?: boolean } = {}): Built {
  const { r } = ctx;
  const s = sender(r), place = pick(r, UNIQUE_PLACES), date = jobDay(ctx), t = shiftTimes(r), crew = pick(r, [2, 3, 4, 5, 6, 8]);
  const day = dayWords(date, r), rg = rangeWords(t.start, t.end, r), cw = crewWords(crew, r);
  const poVal = String(int(r, 10000, 99999)), poQuote = pick(r, [`PO: ${poVal}`, `PO number: ${poVal}`, `PO ${poVal}`]);
  const line = pick(r, [
    `Could we please book ${cw} for ${day}, ${rg.text} at ${place.name}?`,
    `We need ${cw} at ${place.name} on ${day}, ${rg.text}.`,
    `Please can I request ${cw} on ${day} at ${place.name}. Times are ${rg.text}.`,
  ]);
  const text = opts.po ? `${line}\n\n${poQuote}` : line;
  return {
    template: "", branch: "", rules: [],
    input: {
      message: mail(ctx, s, pick(r, [`Crew request - ${place.name}`, "Crew booking", `Booking for ${place.name}`, "Crew needed"]), text, false),
      orders: [], threadOrderId: null, company_id: s.c.id,
      oracle: ex("booking", [req({ action: "new_shift", date: g(date, day), start: g(t.start, rg.a), end: g(t.end, rg.b), crew: g(crew, cw), venue: g(place.name, place.name) })], opts.po ? g(poVal, poQuote) : null),
    },
    expected: write(["booking"], [{ kind: "create_order", company_id: String(s.c.id), company_name: s.c.name, client_email: s.addr, job_name: "", ...(opts.po ? { po: poVal } : {}), shifts: [{ name: "Crew", date, start: t.start, end: t.end, place_id: String(place.id), place_label: place.name, positions: positionsFor(crew)! }] }]),
  };
}

/** A client with one booked shift, for the change templates. */
function booked(ctx: Ctx, crew = pick(ctx.r, [2, 3, 4, 5, 6])) {
  const s = sender(ctx.r), place = pick(ctx.r, UNIQUE_PLACES), date = jobDay(ctx), t = shiftTimes(ctx.r);
  const o = order(ctx, 0, s.c.id, [{ date, ...t, crew, place }]);
  return { s, place, date, t, crew, o };
}

const TEMPLATES: Template[] = [
  // ---- writes -----------------------------------------------------------------------
  { name: "new booking", branch: "P26", rules: ["P1.R3", "P1.R8", "P1.R9", "P1.R16"], n: 65, build: (ctx) => newBooking(ctx) },
  { name: "new booking with a PO", branch: "P26", rules: ["P1.R3", "P1.R12"], n: 15, build: (ctx) => newBooking(ctx, { po: true }) },
  {
    name: "two shifts in one email", branch: "X10", rules: ["P1.R13"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), place = pick(r, UNIQUE_PLACES), d1 = jobDay(ctx), d2 = addDays(d1, 1);
      const t1 = shiftTimes(r), t2 = shiftTimes(r), c1 = pick(r, [2, 3, 4, 6]), c2 = pick(r, [2, 3, 5]);
      const w1 = dayWords(d1, r), w2 = dayWords(d2, r), g1 = rangeWords(t1.start, t1.end, r), g2 = rangeWords(t2.start, t2.end, r), k1 = crewWords(c1, r), k2 = crewWords(c2, r);
      const text = `Could we book the following at ${place.name} please:\n\n${w1}: ${g1.text}, ${k1}\n${w2}: ${g2.text}, ${k2}`;
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, `Crew - ${place.name}`, text, false), orders: [], threadOrderId: null, company_id: s.c.id,
          oracle: ex("booking", [
            req({ date: g(d1, w1), start: g(t1.start, g1.a), end: g(t1.end, g1.b), crew: g(c1, k1), venue: g(place.name, place.name) }),
            req({ date: g(d2, w2), start: g(t2.start, g2.a), end: g(t2.end, g2.b), crew: g(c2, k2), venue: g(place.name, place.name) }),
          ]) },
        expected: write(["booking"], [{ kind: "create_order", company_id: String(s.c.id), company_name: s.c.name, client_email: s.addr, job_name: "", shifts: [
          { name: "Crew", date: d1, start: t1.start, end: t1.end, place_id: String(place.id), place_label: place.name, positions: positionsFor(c1)! },
          { name: "Crew", date: d2, start: t2.start, end: t2.end, place_id: String(place.id), place_label: place.name, positions: positionsFor(c2)! }] }]),
      };
    },
  },
  ...(["by R number", "by day"] as const).map((how): Template => ({
    name: `time change ${how}`, branch: how === "by R number" ? "P10" : "P6", rules: ["P1.R14", "P1.R9"], n: how === "by R number" ? 25 : 20, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      let t = shiftTimes(r);
      while (t.start === b.t.start && t.end === b.t.end) t = shiftTimes(r);
      const day = dayWords(b.date, r), rg = rangeWords(t.start, t.end, r);
      const ref = how === "by R number" ? ` (R${b.o.number})` : "";
      const text = pick(r, [`Could we change the times for ${day}${ref} to ${rg.text} please?`, `Change of plan for ${day}${ref}: can the crew do ${rg.text} instead?`]);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, how === "by R number" ? `Re: R${b.o.number}` : "Change of times", text), orders: [b.o], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: day, date: g(b.date, day), start: null } })]) },
        expected: write(["change"], slotsOf(b.o, 0).map((sl) => ({ kind: "set_position_times" as const, order_id: b.o.id, slot_id: sl.id, date: b.date, start: t.start, end: t.end }))),
      };
    },
  })),
  {
    name: "time change by weekday alone", branch: "G5", rules: ["P1.R8", "P1.R14"], n: 10, build: (ctx) => {
      const { r } = ctx;
      const sentDay = londonDay(ctx.sent);
      const gap = int(r, 1, 6), date = addDays(sentDay, gap), wd = WD[new Date(`${date}T12:00:00Z`).getUTCDay()];
      const s = sender(r), place = pick(r, UNIQUE_PLACES), t0 = shiftTimes(r), crew = pick(r, [2, 3, 4, 5]);
      const o = order(ctx, 0, s.c.id, [{ date, ...t0, crew, place }]);
      let t = shiftTimes(r);
      while (t.start === t0.start && t.end === t0.end) t = shiftTimes(r);
      const rg = rangeWords(t.start, t.end, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, "Quick change", `Can ${wd}'s shift be ${rg.text} instead?`), orders: [o], threadOrderId: null, company_id: s.c.id,
          oracle: ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: `${wd}'s shift`, date: g(date, wd), start: null } })]) },
        expected: write(["change"], slotsOf(o, 0).map((sl) => ({ kind: "set_position_times" as const, order_id: o.id, slot_id: sl.id, date, start: t.start, end: t.end }))),
      };
    },
  },
  {
    name: "longer shift by hours", branch: "P11", rules: ["P1.R14"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), place = pick(r, UNIQUE_PLACES), date = jobDay(ctx), start = pick(r, ["07:00", "08:00", "09:00", "10:00"]);
      const o = order(ctx, 0, s.c.id, [{ date, start, end: addMinutes(start, 240), crew: pick(r, [2, 3, 4, 5]), place }]);
      const hours = pick(r, [6, 8, 10]), day = dayWords(date, r), hw = pick(r, [`${hours} hours`, `${hours}hrs`, `${hours} hrs`]);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, "Extending a shift", `Could we extend the shift on ${day} to ${hw} please? Currently it is 4 hours.`), orders: [o], threadOrderId: null, company_id: s.c.id,
          oracle: ex("change", [req({ action: "change_times", duration_minutes: g(hours * 60, hw), target: { quote: `the shift on ${day}`, date: g(date, day), start: null } })]) },
        expected: write(["change"], slotsOf(o, 0).map((sl) => ({ kind: "set_position_times" as const, order_id: o.id, slot_id: sl.id, date, start, end: addMinutes(start, hours * 60) }))),
      };
    },
  },
  ...(["total", "increase"] as const).map((how): Template => ({
    name: `crew ${how}`, branch: how === "total" ? "P13" : "P14", rules: how === "total" ? ["P1.R16"] : ["P1.R17"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx, int(r, 4, 7));
      const add = int(r, 1, 9 - b.crew), total = b.crew + add, day = dayWords(b.date, r);
      const q = how === "total" ? pick(r, [`${total} crew`, `${total} x crew`]) : pick(r, [`add ${add} more crew`, `add ${add} extra crew`]);
      const text = how === "total" ? `Can we make it ${q} on ${day} please?` : pick(r, [`Could you ${q} to ${day}?`, `Please can we ${q} on ${day}?`]);
      const addQuote = q;
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, "More crew", text), orders: [b.o], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_crew", date: g(b.date, day), ...(how === "total" ? { crew: g(total, q) } : { crew_add: g(add, addQuote) }) })]) },
        expected: write(["change"], [{ kind: "set_position_size", order_id: b.o.id, slot_id: slotsOf(b.o, 0)[1].id, size: total - 1 }]),
      };
    },
  })),
  {
    name: "cancel a shift", branch: "P19", rules: ["P1.R13"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), place = pick(r, UNIQUE_PLACES), d1 = jobDay(ctx), d2 = addDays(d1, 1);
      const o = order(ctx, 0, s.c.id, [{ date: d1, ...shiftTimes(r), crew: pick(r, [2, 3, 4]), place }, { date: d2, ...shiftTimes(r), crew: pick(r, [2, 3, 5]), place }]);
      const n = int(r, 0, 1), date = n ? d2 : d1, day = dayWords(date, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, "Cancellation", `Unfortunately we need to cancel the shift on ${day}. The other day is still going ahead.`), orders: [o], threadOrderId: null, company_id: s.c.id,
          oracle: ex("cancellation", [req({ action: "cancel_shift", date: g(date, day) })]) },
        expected: write(["cancellation", "change"], slotsOf(o, n).map((sl) => ({ kind: "cancel_position" as const, order_id: o.id, slot_id: sl.id }))),
      };
    },
  },
  {
    name: "PO for a named order", branch: "P28", rules: ["P1.R11", "P1.R12"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      const po = String(int(r, 10000, 99999));
      const phr = pick(r, [`PO number: ${po} (for R${b.o.number})`, `Please find our PO ${po} for R${b.o.number}.`, `The PO for R${b.o.number} is ${po}.`]);
      const quote = phr.startsWith("PO number") ? `PO number: ${po}` : phr.startsWith("Please") ? `PO ${po}` : `PO for R${b.o.number} is ${po}`;
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, `PO - R${b.o.number}`, phr), orders: [b.o], threadOrderId: null, company_id: b.s.c.id, oracle: ex("info_only", [], g(po, quote)) },
        expected: write(["info_only"], [{ kind: "set_po", order_id: b.o.id, po }]),
      };
    },
  },
  {
    name: "add a shift to a named order", branch: "P20", rules: ["P1.R13"], n: 10, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      const date = addDays(b.date, 1), crew = pick(r, [2, 3, 4]), day = dayWords(date, r), rg = rangeWords("22:00", "02:00", r), cw = crewWords(crew, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, `Re: R${b.o.number}`, `Please can you add a derig to R${b.o.number} on ${day}, ${rg.text}, ${cw}.`), orders: [b.o], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("booking", [req({ action: "new_shift", date: g(date, day), start: g("22:00", rg.a), end: g("02:00", rg.b), crew: g(crew, cw) })]) },
        expected: write(["booking", "change"], [{ kind: "add_shift", order_id: b.o.id, location_id: 70000 + b.place.id, name: "Crew", date, start: "22:00", end: "02:00", positions: positionsFor(crew)! }]),
      };
    },
  },
  // ---- a person must act -----------------------------------------------------------------
  {
    name: "quote request", branch: "X3", rules: ["P1.R10"], n: 25, build: (ctx) => {
      const b = newBooking(ctx);
      const m = b.input.message;
      m.subject = "Quote request";
      m.body = String(m.body).replace(/Could we please book|We need|Please can I request/, "Could you send me a quote for");
      return { ...b, input: { ...b.input, oracle: { ...b.input.oracle, intent: "quote_request" } }, expected: person(["quote_request"]) };
    },
  },
  {
    name: "vague crew change", branch: "G4", rules: ["P1.R6"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      const day = dayWords(b.date, r), vague = pick(r, ["bump it up a couple", "add a few more", "get the usual numbers"]);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, "Crew numbers", `Can we ${vague} for ${day}?`), orders: [b.o], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_crew", date: g(b.date, day) })]) },
        expected: person(["change", "unclear"]),
      };
    },
  },
  ...([["no venue", "P24"], ["unknown venue", "P25"], ["no end time", "G11"], ["13 crew", "P17"]] as const).map(([what, branch]): Template => ({
    name: `new booking, ${what}`, branch, rules: ["P1.R5"], n: what === "13 crew" ? 5 : 10, build: (ctx) => {
      const { r } = ctx;
      const b = newBooking(ctx);
      const m = b.input.message, o = b.input.oracle, rq = o.requests[0];
      if (what === "no venue") { const v = rq.venue!.value; m.body = String(m.body).replace(` at ${v}`, "").replace(`${v} on `, "").replace(` ${v}`, ""); m.subject = "Crew booking"; rq.venue = null; }
      if (what === "unknown venue") { const v = rq.venue!.value; const nv = pick(r, ["Harbour Hall", "Kings Place", "The Grand Room, Bermondsey"]); m.body = String(m.body).split(v).join(nv); m.subject = "Crew booking"; rq.venue = g(nv, nv); }
      if (what === "no end time") { const endTok = rq.end!.quote; const text = String(m.body); const at = text.indexOf(endTok); m.body = text.slice(0, at).replace(/(\s*(-|till|to)\s*)$/, "") + " onwards" + text.slice(at + endTok.length); rq.end = null; }
      if (what === "13 crew") { const q = rq.crew!.quote; m.body = String(m.body).replace(q, q.replace(/\d+/, "13")); rq.crew = g(13, q.replace(/\d+/, "13")); }
      return { ...b, expected: person(["booking"]) };
    },
  })),
  {
    name: "crew change crossing the crew-chief line", branch: "P16", rules: ["P1.R16"], n: 10, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx, int(r, 2, 3));
      const total = int(r, 4, 6), day = dayWords(b.date, r), q = `${total} crew`;
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, "Crew numbers", `Can we increase to ${q} on ${day}?`), orders: [b.o], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_crew", date: g(b.date, day), crew: g(total, q) })]) },
        expected: person(["change"]),
      };
    },
  },
  {
    name: "booking from a personal address", branch: "P1", rules: [], n: 10, build: (ctx) => {
      const b = newBooking(ctx);
      const m = b.input.message;
      const name = m.from_address.replace(/ <.*/, "");
      m.from_address = `${name} <${name.toLowerCase().replace(/\s+/g, ".")}@gmail.com>`;
      return { ...b, input: { ...b.input, company_id: null }, expected: person(["booking"]) };
    },
  },
  {
    name: "booking from a shared domain", branch: "P1", rules: [], n: 5, build: (ctx) => {
      const b = newBooking(ctx);
      const atlas = COMPANIES.find((c) => c.id === 9011)!;
      b.input.message.from_address = `Rachel Cole <rachel@${atlas.domain}>`;
      return { ...b, input: { ...b.input, company_id: null }, expected: person(["booking"]) };
    },
  },
  {
    name: "another client's R number", branch: "P3", rules: [], n: 15, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      const other = pick(r, CLIENTS.filter((c) => c.id !== b.s.c.id));
      const theirs = order(ctx, 1, other.id, [{ date: b.date, ...shiftTimes(r), crew: 3, place: b.place }]);
      const t = shiftTimes(r), day = dayWords(b.date, r), rg = rangeWords(t.start, t.end, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, `Re: R${theirs.number}`, `Could we change the times for ${day} (R${theirs.number}) to ${rg.text} please?`), orders: [b.o, theirs], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: day, date: g(b.date, day), start: null } })]) },
        expected: person(["change"]),
      };
    },
  },
  {
    name: "two R numbers", branch: "P2", rules: [], n: 5, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      const o2 = order(ctx, 1, b.s.c.id, [{ date: addDays(b.date, 2), ...shiftTimes(r), crew: 3, place: b.place }]);
      const t = shiftTimes(r), rg = rangeWords(t.start, t.end, r), day = dayWords(b.date, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, `R${b.o.number} / R${o2.number}`, `For R${b.o.number} and R${o2.number}, could the shift on ${day} be ${rg.text}?`), orders: [b.o, o2], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: day, date: g(b.date, day), start: null } })]) },
        expected: person(["change"]),
      };
    },
  },
  {
    name: "two orders that day, no venue", branch: "P8", rules: [], n: 10, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      const other = pick(r, UNIQUE_PLACES.filter((p) => p.id !== b.place.id));
      const o2 = order(ctx, 1, b.s.c.id, [{ date: b.date, ...shiftTimes(r), crew: 2, place: other }]);
      const t = shiftTimes(r), rg = rangeWords(t.start, t.end, r), day = dayWords(b.date, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, "Times", `Could we change the times for ${day} to ${rg.text} please?`), orders: [b.o, o2], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: day, date: g(b.date, day), start: null } })]) },
        expected: person(["change"]),
      };
    },
  },
  {
    name: "change on a day with no booking", branch: "P9", rules: [], n: 10, build: (ctx) => {
      const { r } = ctx;
      const b = booked(ctx);
      const date = addDays(b.date, 3), t = shiftTimes(r), rg = rangeWords(t.start, t.end, r), day = dayWords(date, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, b.s, "Times", `Could we change the times for ${day} to ${rg.text} please?`), orders: [b.o], threadOrderId: null, company_id: b.s.c.id,
          oracle: ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: day, date: g(date, day), start: null } })]) },
        expected: person(["change"]),
      };
    },
  },
  {
    name: "PO with no order named", branch: "P29", rules: ["P1.R12"], n: 10, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), po = String(int(r, 10000, 99999)), q = pick(r, [`PO number is ${po}`, `PO: ${po}`]);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, "PO", `Our ${q}, please add it to our booking.`), orders: [], threadOrderId: null, company_id: s.c.id, oracle: ex("info_only", [], g(po, q)) },
        expected: person(["info_only"]),
      };
    },
  },
  // ---- nothing to do ----------------------------------------------------------------------
  {
    name: "thanks", branch: "X1", rules: ["P1.R11"], n: 50, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r);
      const text = pick(r, ["Thanks, that's all confirmed.", "Great, thank you!", "Perfect, see you then.", "Thanks Dan, much appreciated.", "Received, thank you."]);
      return { template: "", branch: "", rules: [], input: { message: mail(ctx, s, "Re: Crew booking", text), orders: [], threadOrderId: null, company_id: s.c.id, oracle: ex("info_only", []) }, expected: none(["info_only"]) };
    },
  },
  {
    name: "booking only in the quoted history", branch: "X11", rules: ["P1.R4"], n: 20, build: (ctx) => {
      const { r } = ctx;
      const old = newBooking(ctx);
      const s = sender(r);
      const oldText = String(old.input.message.body).split("\n").map((l) => `> ${l}`).join("\n");
      const msg = mail(ctx, s, "Re: Crew booking", pick(r, ["Thanks, that works for us.", "Lovely, thanks Dan."]), false);
      msg.body = `${msg.body}\n\nOn Tue, 6 Oct 2026 at 09:14, ${s.person} <${s.addr}> wrote:\n${oldText}`;
      return { template: "", branch: "", rules: [], input: { message: msg, orders: [], threadOrderId: null, company_id: s.c.id, oracle: ex("info_only", []) }, expected: none(["info_only"]) };
    },
  },
  {
    name: "contacts and meeting point", branch: "X1", rules: ["P1.R11"], n: 25, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), place = pick(r, UNIQUE_PLACES);
      const text = pick(r, [
        `The meeting point is the loading bay at ${place.name}. Contact on the day is ${s.person} on 07700 900${int(r, 100, 999)}.`,
        `Parking is available on site, please report to security at ${place.name} on arrival.`,
        "Please can the crew bring their own PPE (steel toe caps and hi-vis).",
      ]);
      return { template: "", branch: "", rules: [], input: { message: mail(ctx, s, "Info for the crew", text), orders: [], threadOrderId: null, company_id: s.c.id, oracle: ex("info_only", []) }, expected: none(["info_only"]) };
    },
  },
  {
    name: "already booked", branch: "P22", rules: [], n: 20, build: (ctx) => {
      const b = newBooking(ctx);
      const op = b.expected.ops[0] as Extract<Op, { kind: "create_order" }>;
      const sh = op.shifts[0];
      const place = PLACES.find((p) => String(p.id) === sh.place_id)!;
      const existing = order(ctx, 0, Number(op.company_id), [{ date: sh.date, start: sh.start, end: sh.end, crew: sh.positions.reduce((a, p) => a + p.size, 0), place }]);
      return { ...b, input: { ...b.input, orders: [existing] }, expected: none(["booking"]) };
    },
  },
];

export const TEMPLATE_COUNT = TEMPLATES.reduce((a, t) => a + t.n, 0);

/** The simulated set: `total` cases spread over the templates in proportion, from one seed. */
export function generate(total = 500, seed = 20261010): SpartanCase[] {
  const out: SpartanCase[] = [];
  const base = Date.parse("2026-10-12T07:30:00Z");
  let i = 0;
  for (const t of TEMPLATES) {
    const n = Math.round((t.n * total) / TEMPLATE_COUNT);
    for (let k = 0; k < n; k++, i++) {
      const r = mulberry32(seed + i * 7919);
      // Sent during a working fortnight, 07:30-17:30 London on weekdays and some evenings.
      const sent = new Date(base + Math.floor(i / 40) * 864e5 + ((i * 37) % (10 * 60)) * 60_000).toISOString();
      const ctx: Ctx = { i, r, sent, today: londonDay(sent), idBase: 800000 + i * 4 };
      const b = t.build(ctx);
      out.push({ ...b, id: `S${String(i).padStart(4, "0")}`, template: t.name, branch: t.branch, rules: t.rules, source: "synthetic-by-construction" });
    }
  }
  return out;
}
