// ============================================================================
// The generated business, by category (ADDENDUM §14.6). Each case is a client, the orders it already has, the
// emails it sends, what staff do in OnSinch and when, and what the TV must show at each look. The job is drawn
// from the measured grammar (grammar.ts); the email is written from the job, never the reverse, with the
// reading a perfect reader would give beside it (the oracle). The expected outcome is the business answer,
// stated from the job: a gap between it and what the code does is a finding, which is the point.
// ============================================================================
import type { Extraction, RawRequest } from "../../app/lib/v2/interpret/extract";
import { dayWords, rangeWords, crewWords, GREET, signoff, quotedHistory, g, req, ex } from "../adapters/spartan/generate";
import { addDays, drawJob, drawTimes, int, pick, rng, weighted, TRADES, type Call, type Job, type Rng } from "./grammar";
import { PLACES, makeClient, type Client } from "./world";
import * as staff from "./staff";

const H = 3600e3, MIN = 60e3, DAY = 864e5;

export type Email = { at: number; subject: string; body: string; from: string; oracle: Extraction };
export type StaffStep = { at: number; note: string; act: (orders: any[]) => void };
export type Look = { at: number; label: string; state: "open" | "done" | "possibly" | "absent" | "reply"; kind?: "needs-created" | "needs-updated"; name?: string; days?: string[] };
export type Expected = { decision: "write" | "handoff" | "none"; reason?: RegExp; calls?: Call[]; change?: "times" | "crew" | "cancel" | "add" | "po" };
export type GenCase = {
  id: string; category: string; variant: string; client: Client; sender: string; today: string; t0: number;
  orders: Array<{ calls: Call[]; po?: string | null; by: number; title?: string; number?: string }>;
  emails: Email[]; staff: StaffStep[]; looks: Look[]; expect: Expected;
};

type Ctx = { r: Rng; n: number; client: Client; contact: Client["contacts"][number]; t0: number; today: string };

// ---- words -------------------------------------------------------------------------------------------------
/** The sent year of the case being made (generate sets it). A day in another year is written with its year: no year
 * written is the sent year (O22, 31 Oct), so a client meaning next year must say so. */
let sentYear = 0;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayOf(day: string, r: Rng): string {
  if (Number(day.slice(0, 4)) === sentYear) return dayWords(day, r);
  const [y, m, d] = day.split("-").map(Number);
  return pick(r, [`${d} ${MON[m - 1]} ${y}`, `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`, `${MON[m - 1]} ${d} ${y}`]);
}
const callWords = (c: Call, r: Rng) => {
  const day = dayOf(c.date, r), rg = rangeWords(c.start, c.end, r);
  const who = c.trade.profession ? `${c.crew} ${pick(r, c.trade.words)}` : crewWords(c.crew, r);
  return { day, rg, who };
};
const reqOf = (c: Call, w: ReturnType<typeof callWords>, action: RawRequest["action"] = "new_shift"): RawRequest =>
  req({ action, date: g(c.date, w.day), start: g(c.start, w.rg.a), end: g(c.end, w.rg.b), crew: g(c.crew, w.who), venue: g(c.place.name, c.place.name),
    ...(c.trade.profession ? { trade: g(w.who.replace(/^\d+\s*/, ""), w.who.replace(/^\d+\s*/, "")) } : {}) });
function letter(ctx: Ctx, text: string, noise = false): string {
  return `${pick(ctx.r, GREET)}\n\n${text}\n\n${signoff(`${ctx.contact.name} ${ctx.contact.surname}`, ctx.client.name, ctx.r)}${noise ? quotedHistory(ctx.r) : ""}`;
}
const lines = (calls: Call[], r: Rng) => {
  const ws = calls.map((c) => callWords(c, r));
  const byPlace = new Set(calls.map((c) => c.place.id)).size > 1;
  const text = calls.length === 1
    ? pick(r, [`Could we please book ${ws[0].who} for ${ws[0].day}, ${ws[0].rg.text} at ${calls[0].place.name}?`, `We need ${ws[0].who} at ${calls[0].place.name} on ${ws[0].day}, ${ws[0].rg.text}.`,
      `Please can I request ${ws[0].who} on ${ws[0].day} at ${calls[0].place.name}. Times are ${ws[0].rg.text}.`])
    : `Could we book the following${byPlace ? "" : ` at ${calls[0].place.name}`} please:\n\n${calls.map((c, k) => `${ws[k].day}: ${ws[k].rg.text}, ${ws[k].who}${byPlace ? ` at ${c.place.name}` : ""}`).join("\n")}`;
  return { text, reqs: calls.map((c, k) => reqOf(c, ws[k])) };
};
const poLine = (po: string, r: Rng) => { const q = pick(r, [`PO: ${po}`, `PO number: ${po}`, `Our PO is ${po}`]); return { q, line: `\n\n${q}` }; };

// ---- shapes of case ------------------------------------------------------------------------------------------
const lead14 = (ctx: Ctx, calls: Call[]) => (Date.parse(`${calls.map((c) => c.date).sort()[0]}T12:00:00Z`) - Date.parse(`${ctx.today}T12:00:00Z`)) / DAY <= 14;
const nameOf = (ctx: Ctx, calls: Call[]) => `${ctx.client.name} @ ${calls[0].place.name}`;
const lastDay = (calls: Call[]) => calls.map((c) => c.date).sort().reverse()[0];
const after = (day: string, t0: number) => Date.parse(`${addDays(day, 1)}T12:00:00Z`) - t0;

/** A new booking: the email, staff making the order a few hours later, and the TV open, then done, then gone. */
function booking(ctx: Ctx, job: Job, opts: { variant: string; staffDo?: "book" | "nothing" | "wrong-order" | "part"; noise?: boolean } ): Omit<GenCase, "id" | "category"> {
  const { r } = ctx;
  const w = lines(job.calls, r);
  const po = job.po ? poLine(job.po, r) : null;
  const subject = pick(r, [`Crew request - ${job.calls[0].place.name}`, "Crew booking", `Booking for ${job.calls[0].place.name}`, "Crew needed", "Labour request"]);
  const email: Email = { at: 0, subject, body: letter(ctx, w.text + (po?.line ?? ""), opts.noise), from: ctx.contact.email, oracle: ex("booking", w.reqs, po ? g(job.po!, po.q) : null) };
  const days = [...new Set(job.calls.map((c) => c.date))].sort();
  const near = lead14(ctx, job.calls);
  const doing = opts.staffDo ?? "book";
  const steps: StaffStep[] = [];
  const by = pick(r, staff.STAFF);
  if (doing === "book") steps.push({ at: 3 * H, note: "staff make the order as asked", act: (os) => { os.push(staff.createOrder(ctx.client, job.calls, by, job.po)); } });
  if (doing === "part") steps.push({ at: 3 * H, note: "staff make the order with the first call only", act: (os) => { os.push(staff.createOrder(ctx.client, job.calls.slice(0, 1), by, job.po)); } });
  return {
    variant: opts.variant, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0, orders: [], emails: [email], staff: steps,
    looks: [
      { at: 2 * MIN, label: "after the email", state: "open", kind: "needs-created", name: ctx.client.name, days },
      { at: 3 * H + 2 * MIN, label: "after staff", state: doing === "book" ? "done" : "open" },
      { at: after(lastDay(job.calls), ctx.t0), label: "after the job", state: "absent" },
    ],
    expect: near ? { decision: "handoff", reason: /within \d+ days of the email/ } : { decision: "write", calls: job.calls },
  };
}

/**
 * How a change names the booking it is for. The planner never takes the day alone (DECISIONS V1: a second job
 * that day would be rewritten), so "day" is a handoff by rule. Weights from the 10-21 count of changes to
 * existing orders (identity/index.ts: 12 by PO or reference, 8 by R number, 39 by the day and one more fact).
 */
type Anchor = "R" | "po" | "venue" | "start" | "day";
const ANCHORS = [["R", 8], ["po", 12], ["venue", 22], ["start", 17], ["day", 8]] as const;

/** An order the client already has, then an email changing it, staff making the change, the TV open then done. */
function change(ctx: Ctx, kind: "times" | "crew-add" | "crew-total" | "move" | "cancel" | "cancel-all", anchor: Anchor = weighted(ctx.r, ANCHORS)): Omit<GenCase, "id" | "category"> {
  const { r } = ctx;
  const job = drawJob(r, ctx.today, PLACES, { trades: false, venues: 1, days: kind === "cancel-all" ? int(r, 2, 3) : 1, callsPerDay: 1 });
  const c = job.calls[0];
  const w = callWords(c, r);
  const number = String(70000 + ctx.n);
  const po = anchor === "po" ? `${pick(r, ["PO", "SC", "P", "4500"])}${int(r, 10000, 99999)}` : null;
  const poQ = po ? pick(r, [`PO ${po}`, `our PO ${po}`, `PO: ${po}`]) : "";
  // The booking as the email names it, and what a perfect reader takes from those words.
  const which = { R: `R${number} on ${w.day}`, po: `${w.day} (${poQ})`, venue: `${w.day} at ${c.place.name}`, start: `the ${w.rg.a} start on ${w.day}`, day: w.day }[anchor];
  const named = (x: RawRequest): RawRequest => ({ ...x, ...(anchor === "venue" ? { venue: g(c.place.name, c.place.name) } : {}),
    ...(anchor === "start" && kind !== "cancel-all" && x.target ? { target: { ...x.target, start: g(c.start, w.rg.a) } } : {}) });
  const target = { quote: w.day, date: g(c.date, w.day), start: null };
  let text = "", rqs: RawRequest[] = [], after: (o: any) => void, moved: string | null = null;
  const by = pick(r, staff.STAFF);
  if (kind === "times") {
    const t = drawTimes(r);
    const rg = rangeWords(t.start, t.end, r);
    text = pick(r, [`Can we change ${which} to ${rg.text} please?`, `Small change for ${which}: the times are now ${rg.text}.`]);
    rqs = [req({ action: "change_times", date: g(c.date, w.day), start: g(t.start, rg.a), end: g(t.end, rg.b), target })];
    after = (o) => staff.setTimes(o, 0, c.date, t.start, t.end, by);
  } else if (kind === "crew-add") {
    const add = int(r, 1, 3), total = c.crew + add;
    const q = pick(r, [`${add} more crew`, `an extra ${add} crew`, `another ${add} crew`]);
    text = `Could we add ${q} for ${which} please, making it ${total}?`;
    rqs = [req({ action: "change_crew", date: g(c.date, w.day), crew_add: g(add, q), crew: g(total, `making it ${total}`), target })];
    after = (o) => staff.setCrew(o, 0, total - (total >= 4 ? 1 : 0), by);
  } else if (kind === "crew-total") {
    const total = Math.max(1, c.crew + pick(r, [-1, 1, 2]));
    const q = `${total} crew`;
    text = pick(r, [`Can we make it ${q} for ${which} please?`, `Please change ${which} to ${q}.`]);
    rqs = [req({ action: "change_crew", date: g(c.date, w.day), crew: g(total, q), target })];
    after = (o) => staff.setCrew(o, 0, total - (total >= 4 ? 1 : 0), by);
  } else if (kind === "move") {
    const to = addDays(c.date, int(r, 1, 3)), wd = dayOf(to, r);
    moved = to;
    text = `We need to move ${which} to ${wd}, same times please.`;
    rqs = [req({ action: "change_times", date: g(to, wd), target })];
    after = (o) => staff.setTimes(o, 0, to, c.start, c.end, by);
  } else if (kind === "cancel") {
    text = pick(r, [`Unfortunately we need to cancel ${which}.`, `Please cancel the crew for ${which}, the event is off.`]);
    rqs = [req({ action: "cancel_shift", date: g(c.date, w.day), target })];
    after = (o) => staff.cancelCall(o, 0, by);
  } else {
    const ws = job.calls.map((x) => dayOf(x.date, r));
    const ref = { R: ` R${number}`, po: ` (${poQ})`, venue: ` at ${c.place.name}`, start: "", day: "" }[anchor];
    text = `We have to cancel the whole booking${ref} (${ws.join(", ")}), sorry.`;
    rqs = job.calls.map((x, k) => req({ action: "cancel_shift", date: g(x.date, ws[k]), target: { quote: ws[k], date: g(x.date, ws[k]), start: null } }));
    after = (o) => staff.cancelOrder(o, by);
  }
  rqs = rqs.map(named);
  // A move's card holds the day it leaves and the day it goes to.
  const days = [...new Set([...job.calls.map((x) => x.date), ...(moved ? [moved] : [])])].sort();
  // Every day of a whole booking listed is still the day alone: no venue, start or reference.
  const refused = anchor === "day" || (anchor === "start" && kind === "cancel-all");
  return {
    variant: `${kind} by ${anchor}`, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0,
    orders: [{ calls: job.calls, by, po, number }],
    emails: [{ at: 0, subject: pick(r, anchor === "R" ? [`Re: R${number}`, `R${number} change`] : ["Change to booking", `Update - ${w.day}`, "Booking change"]), body: letter(ctx, text), from: ctx.contact.email,
      oracle: ex(kind.startsWith("cancel") ? "cancellation" : "change", rqs, po ? g(po, poQ) : null) }],
    staff: [{ at: 2 * H, note: `staff make the ${kind}`, act: (os) => after(os[0]) }],
    looks: [
      { at: 2 * MIN, label: "after the email", state: "open", kind: "needs-updated", name: ctx.client.name, days },
      { at: 2 * H + 2 * MIN, label: "after staff", state: "done" },
    ],
    expect: refused ? { decision: "handoff", reason: /no order is named/ }
      : { decision: "write", change: kind.startsWith("cancel") ? "cancel" : kind.startsWith("crew") ? "crew" : "times" },
  };
}

// ---- the categories --------------------------------------------------------------------------------------------
type Maker = (ctx: Ctx) => Omit<GenCase, "id" | "category">;
export const CATEGORIES: Record<string, { title: string; make: Maker }> = {
  A: { title: "Simple new booking", make: (ctx) => booking(ctx, drawJob(ctx.r, ctx.today, PLACES, { days: 1, callsPerDay: 1, venues: 1, trades: false }), { variant: "one call" }) },
  B: { title: "Multi-day and multi-call", make: (ctx) => booking(ctx, drawJob(ctx.r, ctx.today, PLACES, { days: weighted(ctx.r, [[2, 628], [3, 113], [4, 45], [5, 34], [6, 20]] as const), venues: 1, trades: false }), { variant: "several days" }) },
  C: { title: "Multi-venue", make: (ctx) => booking(ctx, drawJob(ctx.r, ctx.today, PLACES, { venues: pick(ctx.r, [2, 2, 3]), days: pick(ctx.r, [1, 2, 3]), trades: false }), { variant: "several venues" }) },
  D: { title: "Trades and roles", make: (ctx) => {
    const job = drawJob(ctx.r, ctx.today, PLACES, { days: 1, venues: 1, callsPerDay: pick(ctx.r, [1, 2]) });
    const t = TRADES[int(ctx.r, 1, TRADES.length - 1)][0];
    job.calls[0] = { ...job.calls[0], trade: t, crew: int(ctx.r, 1, 4) };
    return booking(ctx, job, { variant: t.label });
  } },
  E: { title: "Changes to a booking", make: (ctx) => change(ctx, pick(ctx.r, ["times", "crew-add", "crew-total", "move"] as const)) },
  F: { title: "Cancellations", make: (ctx) => change(ctx, pick(ctx.r, ["cancel", "cancel", "cancel-all"] as const)) },
  J: { title: "Incomplete and ambiguous", make: (ctx) => {
    const job = drawJob(ctx.r, ctx.today, PLACES, { days: 1, callsPerDay: 1, venues: 1, trades: false });
    const c = job.calls[0], w = callWords(c, ctx.r);
    const miss = pick(ctx.r, ["crew", "times", "venue", "day"] as const);
    const parts = { crew: miss === "crew" ? "some crew" : w.who, when: miss === "times" ? "" : `, ${w.rg.text}`, at: miss === "venue" ? "" : ` at ${c.place.name}`, day: miss === "day" ? "soon" : `on ${w.day}` };
    const text = `Could we get ${parts.crew} ${parts.day}${parts.when}${parts.at}?`;
    const rq = req({ action: "new_shift", ...(miss === "day" ? {} : { date: g(c.date, w.day) }), ...(miss === "times" ? {} : { start: g(c.start, w.rg.a), end: g(c.end, w.rg.b) }),
      ...(miss === "crew" ? {} : { crew: g(c.crew, w.who) }), ...(miss === "venue" ? {} : { venue: g(c.place.name, c.place.name) }) });
    // No crew or no day: the client is asked (a reply card, off the TV). No venue: asked too, unless the two-week
    // rule hands the booking to staff first (a missing crew count is asked either way). No times: assumed, 08:00 for
    // 4 hours with no history (DECISIONS V15), and booked as any other.
    const near = miss !== "day" && lead14(ctx, [c]);
    const ask = miss === "crew" || miss === "day" || (miss === "venue" && !near);
    const assumed = { ...c, start: "08:00", end: "12:00" };
    return {
      variant: `no ${miss}`, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0, orders: [],
      emails: [{ at: 0, subject: "Crew", body: letter(ctx, text), from: ctx.contact.email, oracle: ex("booking", [rq]) }], staff: [],
      looks: [ask ? { at: 2 * MIN, label: "after the email", state: "reply" } : { at: 2 * MIN, label: "after the email", state: "open", kind: "needs-created", name: ctx.client.name, days: [c.date] }],
      expect: ask ? { decision: "handoff", reason: miss === "crew" ? /crew count/ : miss === "venue" ? /venue/ : /day|date/ }
        : near ? { decision: "handoff", reason: /within \d+ days of the email/ }
        : { decision: "write", calls: [assumed] },
    };
  } },
  K: { title: "Staff behaviour (the TV's truth)", make: (ctx) => {
    const job = drawJob(ctx.r, ctx.today, PLACES, { days: 1, callsPerDay: 1, venues: 1, trades: false });
    const doing = pick(ctx.r, ["book", "nothing", "wrong-order", "part"] as const);
    const base = booking(ctx, job, { variant: `staff ${doing}`, staffDo: doing === "wrong-order" ? "nothing" : doing === "part" ? "book" : doing });
    if (doing === "wrong-order") {
      // Another job of the client's, the same day at another venue, worked by staff: the need must not clear.
      const other = { ...job.calls[0], place: PLACES.find((p) => p.id !== job.calls[0].place.id)!, start: "06:00", end: "08:00" };
      base.orders.push({ calls: [other], by: staff.STAFF[0] });
      base.staff.push({ at: 3 * H, note: "staff change the crew on the client's other job that day", act: (os) => staff.setCrew(os[0], 0, other.crew + 1, staff.STAFF[1]) });
      base.looks[1].state = "open";
    }
    return base;
  } },
  M: { title: "Out-of-rule controls", make: (ctx) => {
    const kind = pick(ctx.r, ["past day", "unknown sender"] as const);
    const job = drawJob(ctx.r, ctx.today, PLACES, { days: 1, callsPerDay: 1, venues: 1, trades: false });
    if (kind === "past day") job.calls[0] = { ...job.calls[0], date: addDays(ctx.today, -int(ctx.r, 1, 4)) };
    const base = booking(ctx, job, { variant: kind, staffDo: "nothing" });
    if (kind === "unknown sender") { base.sender = `someone@unknown-${ctx.n}.example.com`; base.emails[0].from = base.sender; }
    base.expect = { decision: "handoff" };
    base.looks = kind === "past day" ? [{ at: 2 * MIN, label: "after the email", state: "absent" }] : [{ at: 2 * MIN, label: "after the email", state: "open" }];
    return base;
  } },
};

/**
 * The set: n cases per category, each seeded so it can be rerun alone. Every case runs on an empty world of its own
 * (run.mts), but time only moves forward: each case starts the morning after the last look of the one before. The
 * app keeps OnSinch's answers in memory for minutes by the clock (replan.ts cached), and a clock that went back
 * served one case's client list to the next ("no single client company", 223 of 270 on 31 Oct).
 */
export function generate(categories: string[], n: number, seed = 31_10_2026, from = Date.parse("2026-11-02T09:30:00Z")): GenCase[] {
  const out: GenCase[] = [];
  let k = 0, cursor = from;
  for (const cat of categories) for (let i = 0; i < n; i++, k++) {
    const r = rng(seed * 100 + k);
    const client = makeClient(r, k);
    const t0 = cursor + int(r, 0, 8) * H;
    const today = new Date(t0).toISOString().slice(0, 10);
    sentYear = Number(today.slice(0, 4));
    const made = CATEGORIES[cat].make({ r, n: k, client, contact: pick(r, client.contacts), t0, today });
    out.push({ id: `${cat}${String(i + 1).padStart(3, "0")}`, category: cat, ...made });
    const end = t0 + Math.max(...made.looks.map((l) => l.at), ...made.staff.map((x) => x.at));
    cursor = Date.parse(`${new Date(end + DAY).toISOString().slice(0, 10)}T09:30:00Z`);
  }
  return out;
}
