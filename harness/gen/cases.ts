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
import * as lang from "./language";

const H = 3600e3, MIN = 60e3, DAY = 864e5;

export type Email = { at: number; subject: string; body: string; from: string; oracle: Extraction };
export type StaffStep = { at: number; note: string; act: (orders: any[]) => void };
export type Look = { at: number; label: string; state: "open" | "done" | "possibly" | "absent" | "reply"; kind?: "needs-created" | "needs-updated"; name?: string; days?: string[] };
/** `email`: which of the case's emails is judged (default the first); `order`: which of its orders a change must touch. */
export type Expected = { decision: "write" | "handoff" | "none"; reason?: RegExp; calls?: Call[]; change?: "times" | "crew" | "cancel" | "add" | "po"; email?: number; order?: number };
export type GenCase = {
  id: string; category: string; variant: string; client: Client; sender: string; today: string; t0: number;
  orders: Array<{ calls: Call[]; po?: string | null; by: number; title?: string; number?: string }>;
  emails: Email[]; staff: StaffStep[]; looks: Look[]; expect: Expected;
  /** Windows (ms from t0) in which OnSinch answers every read with a 500. */
  faults?: Array<{ from: number; to: number }>;
};

type Ctx = { r: Rng; n: number; client: Client; contact: Client["contacts"][number]; t0: number; today: string };

// ---- words -------------------------------------------------------------------------------------------------
/** The sent year of the case being made (generate sets it). A day in another year is written with its year: no year
 * written is the sent year (O22, 31 Oct), so a client meaning next year must say so. */
let sentYear = 0, sentDay = "";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Each word helper draws its plain template from the case's stream first, rich words or not, so the job drawn after
// it is the same in both (language.ts).
function dayOf(day: string, r: Rng): string {
  let plain: string;
  if (Number(day.slice(0, 4)) === sentYear) plain = dayWords(day, r);
  else {
    const [y, m, d] = day.split("-").map(Number);
    plain = pick(r, [`${d} ${MON[m - 1]} ${y}`, `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`, `${MON[m - 1]} ${d} ${y}`]);
  }
  return lang.isRich() ? lang.sayDay(day, sentDay) : plain;
}
const rgOf = (start: string, end: string, r: Rng): lang.Times => {
  const plain = rangeWords(start, end, r);
  return lang.isRich() ? lang.sayTimes(start, end) : { ...plain, dur: null };
};
/** A call's times as the reader quotes them: a start and an end, or a start and a length. */
const timeFields = (start: string, end: string, t: lang.Times) =>
  ({ start: g(start, t.a), end: t.b ? g(end, t.b) : null, duration_minutes: t.dur ? g(t.dur.mins, t.dur.q) : null });
const callWords = (c: Call, r: Rng) => {
  const day = dayOf(c.date, r), rg = rgOf(c.start, c.end, r);
  const plainWho = c.trade.profession ? `${c.crew} ${pick(r, c.trade.words)}` : crewWords(c.crew, r);
  const who = lang.isRich() && !c.trade.profession ? lang.sayCrew(c.crew) : plainWho;
  const at = lang.isRich() ? lang.sayVenue(c.place) : c.place.name;
  return { day, rg, who, at };
};
const reqOf = (c: Call, w: ReturnType<typeof callWords>, action: RawRequest["action"] = "new_shift"): RawRequest =>
  req({ action, date: g(c.date, w.day), ...timeFields(c.start, c.end, w.rg), crew: g(c.crew, w.who), venue: g(c.place.name, w.at),
    ...(c.trade.profession ? { trade: g(w.who.replace(/^\d+\s*/, ""), w.who.replace(/^\d+\s*/, "")) } : {}) });
function letter(ctx: Ctx, text: string, noise = false): string {
  const plain = `${pick(ctx.r, GREET)}\n\n${text}\n\n${signoff(`${ctx.contact.name} ${ctx.contact.surname}`, ctx.client.name, ctx.r)}${noise ? quotedHistory(ctx.r) : ""}`;
  return lang.isRich() ? lang.letter({ first: ctx.contact.name, last: ctx.contact.surname, company: ctx.client.name, domain: ctx.client.domain }, text, noise) : plain;
}
const lines = (calls: Call[], r: Rng) => {
  const ws = calls.map((c) => callWords(c, r));
  const byPlace = new Set(calls.map((c) => c.place.id)).size > 1;
  let text = calls.length === 1
    ? pick(r, [`Could we please book ${ws[0].who} for ${ws[0].day}, ${ws[0].rg.text} at ${ws[0].at}?`, `We need ${ws[0].who} at ${ws[0].at} on ${ws[0].day}, ${ws[0].rg.text}.`,
      `Please can I request ${ws[0].who} on ${ws[0].day} at ${ws[0].at}. Times are ${ws[0].rg.text}.`])
    : `Could we book the following${byPlace ? "" : ` at ${ws[0].at}`} please:\n\n${calls.map((c, k) => `${ws[k].day}: ${ws[k].rg.text}, ${ws[k].who}${byPlace ? ` at ${ws[k].at}` : ""}`).join("\n")}`;
  if (lang.isRich()) {
    if (calls.length === 1 && lang.useForm()) {
      text = `${lang.pickL(["Could we book the following please:", "Booking request:", "Please can we book:", "Details below:"])}\n\n${lang.formOf([["Date", ws[0].day], [ws[0].rg.dur ? "Time" : "Times", ws[0].rg.text], ["Crew", ws[0].who], ["Venue", ws[0].at]])}`;
    } else if (calls.length === 1) {
      const w = ws[0];
      text = lang.pickL([text, `${w.day} at ${w.at}: ${w.who}, ${w.rg.text} please.`, `Can we get ${w.who} at ${w.at}, ${w.day}, ${w.rg.text}?`, `Looking for ${w.who} on ${w.day} (${w.rg.text}) at ${w.at}.`]);
    }
  }
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
  const which = { R: `R${number} on ${w.day}`, po: `${w.day} (${poQ})`, venue: `${w.day} at ${w.at}`, start: `the ${w.rg.a} start on ${w.day}`, day: w.day }[anchor];
  const named = (x: RawRequest): RawRequest => ({ ...x, ...(anchor === "venue" ? { venue: g(c.place.name, w.at) } : {}),
    ...(anchor === "start" && kind !== "cancel-all" && x.target ? { target: { ...x.target, start: g(c.start, w.rg.a) } } : {}) });
  const target = { quote: w.day, date: g(c.date, w.day), start: null };
  let text = "", rqs: RawRequest[] = [], after: (o: any) => void, moved: string | null = null;
  const by = pick(r, staff.STAFF);
  if (kind === "times") {
    let t = drawTimes(r);
    // New times equal to the booked ones are no change at all ("already as asked").
    while (t.start === c.start && t.end === c.end) t = drawTimes(r);
    const rg = rgOf(t.start, t.end, r);
    text = pick(r, [`Can we change ${which} to ${rg.text} please?`, `Small change for ${which}: the times are now ${rg.text}.`]);
    rqs = [req({ action: "change_times", date: g(c.date, w.day), ...timeFields(t.start, t.end, rg), target })];
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
    const ref = { R: ` R${number}`, po: ` (${poQ})`, venue: ` at ${w.at}`, start: "", day: "" }[anchor];
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
    // Refused by the finder ("no order is named") or, when the reader named the order, by the pick check (interpret.ts).
    expect: refused ? { decision: "handoff", reason: /no order is named|nothing more does not single out/ }
      : { decision: "write", change: kind.startsWith("cancel") ? "cancel" : kind.startsWith("crew") ? "crew" : "times" },
  };
}

// ---- references, threads, questions, bespoke jobs, adversarial wording, OnSinch faults ---------------------------
const ONE = { trades: false, venues: 1, days: 1, callsPerDay: 1 } as const;
/** Two orders of the client's on different days at different venues; the email is about the second. */
function pair(ctx: Ctx): [Call, Call] {
  const a = drawJob(ctx.r, ctx.today, PLACES, ONE).calls[0];
  let b = drawJob(ctx.r, ctx.today, PLACES, ONE).calls[0];
  if (b.date === a.date) b = { ...b, date: addDays(b.date, 2) };
  if (b.place.id === a.place.id) b = { ...b, place: PLACES.find((p) => p.id !== a.place.id)! };
  return [a, b];
}
/** Every call moved later until the first is more than two weeks out, so the planner's write is what is judged. */
const far = (ctx: Ctx, job: Job): Job => {
  const first = job.calls.map((c) => c.date).sort()[0];
  const gap = Math.round((Date.parse(`${first}T12:00:00Z`) - Date.parse(`${ctx.today}T12:00:00Z`)) / DAY);
  return gap > 14 ? job : { ...job, calls: job.calls.map((c) => ({ ...c, date: addDays(c.date, 15 - gap + int(ctx.r, 0, 20)) })) };
};

/** G: which order a reference names, among two of the client's. */
function reference(ctx: Ctx, kind: "po on two orders" | "R quoted from an old message" | "R OnSinch does not hold"): Omit<GenCase, "id" | "category"> {
  const { r } = ctx;
  const [a, b] = pair(ctx);
  const w = callWords(b, r), t = drawTimes(r), rg = rgOf(t.start, t.end, r);
  const numA = String(71000 + ctx.n), numB = String(72000 + ctx.n);
  const po = kind === "po on two orders" ? `${pick(r, ["PO", "SC", "4500"])}${int(r, 10000, 99999)}` : null;
  const by = pick(r, staff.STAFF);
  const rq = req({ action: "change_times", date: g(b.date, w.day), ...timeFields(t.start, t.end, rg), target: { quote: w.day, date: g(b.date, w.day), start: null } });
  let text = "", tail = "", oPo: Extraction["po"] = null, expect: Expected;
  if (kind === "po on two orders") {
    // One PO on both orders (O18): the day picks the one holding it.
    const q = `PO ${po}`;
    text = `For ${q}, can we change ${w.day} to ${rg.text} please?`;
    oPo = g(po!, q);
    expect = { decision: "write", change: "times", order: 1 };
  } else if (kind === "R quoted from an old message") {
    // An R in the quoted history is the old order's, not this email's.
    text = `Can we change ${w.day} at ${w.at} to ${rg.text} please?`;
    tail = `\n\nOn ${dayWords(addDays(ctx.today, -20), r)}, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:\n> Hi, R${numA} is booked in for you.\n> Thanks, Dan`;
    rq.venue = g(b.place.name, w.at);
    expect = { decision: "write", change: "times", order: 1 };
  } else {
    // A number OnSinch does not hold is said, never passed over for a weaker find (plan.ts findOrder).
    text = `Can we change R${90000 + ctx.n} on ${w.day} at ${w.at} to ${rg.text} please?`;
    rq.venue = g(b.place.name, w.at);
    expect = { decision: "handoff", reason: /not found/ };
  }
  return {
    variant: kind, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0,
    orders: [{ calls: [a], by, po, number: numA }, { calls: [b], by, po, number: numB }],
    emails: [{ at: 0, subject: pick(r, ["Change to booking", "Booking change", "Times"]), body: letter(ctx, text) + tail, from: ctx.contact.email, oracle: ex("change", [rq], oPo) }],
    staff: [{ at: 2 * H, note: "staff change the times on the order meant", act: (os) => staff.setTimes(os[1], 0, b.date, t.start, t.end, by) }],
    looks: [
      { at: 2 * MIN, label: "after the email", state: "open", kind: "needs-updated", name: ctx.client.name, days: [b.date] },
      { at: 2 * H + 2 * MIN, label: "after staff", state: "done" },
    ],
    expect,
  };
}

/** H: a thread's later email: a correction, a thanks, the missing detail. */
function thread(ctx: Ctx, kind: "correction" | "confirmation" | "missing crew sent later" | "withdrawn"): Omit<GenCase, "id" | "category"> {
  const { r } = ctx;
  const by = pick(r, staff.STAFF);
  if (kind === "missing crew sent later") {
    const job = drawJob(r, ctx.today, PLACES, ONE), c = job.calls[0], w = callWords(c, r);
    const first = `Could we get some crew on ${w.day}, ${w.rg.text} at ${w.at}?`;
    const rq1 = req({ action: "new_shift", date: g(c.date, w.day), ...timeFields(c.start, c.end, w.rg), venue: g(c.place.name, w.at) });
    const second = `Sorry, forgot to say: ${w.who} please.`;
    const rq2 = { ...rq1, crew: g(c.crew, w.who) };
    return {
      variant: kind, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0, orders: [],
      emails: [
        { at: 0, subject: "Crew", body: letter(ctx, first), from: ctx.contact.email, oracle: ex("booking", [rq1]) },
        { at: 3 * H, subject: "Re: Crew", body: letter(ctx, second), from: ctx.contact.email, oracle: ex("booking", [rq2]) },
      ],
      staff: [{ at: 6 * H, note: "staff make the order", act: (os) => { os.push(staff.createOrder(ctx.client, job.calls, by)); } }],
      looks: [
        { at: 2 * MIN, label: "after the first email", state: "reply" },
        { at: 3 * H + 2 * MIN, label: "after the crew count", state: "open", kind: "needs-created", name: ctx.client.name, days: [c.date] },
        { at: 6 * H + 2 * MIN, label: "after staff", state: "done" },
      ],
      expect: lead14(ctx, job.calls) ? { decision: "handoff", reason: /within \d+ days of the email/, email: 1 } : { decision: "write", calls: job.calls, email: 1 },
    };
  }
  const job = drawJob(r, ctx.today, PLACES, ONE), c = job.calls[0], w = callWords(c, r);
  if (kind === "confirmation") {
    const text = pick(r, [`Thanks, that's all confirmed for ${w.day} at ${w.at}.`, `Perfect, thanks for confirming ${w.day}.`, "Great, thank you!"]);
    return {
      variant: kind, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0,
      orders: [{ calls: job.calls, by, number: String(73000 + ctx.n) }],
      emails: [{ at: 0, subject: `Re: Booking ${c.place.name}`, body: letter(ctx, text), from: ctx.contact.email, oracle: ex("info_only", []) }],
      staff: [], looks: [{ at: 2 * MIN, label: "after the thanks", state: "absent" }],
      expect: { decision: "none" },
    };
  }
  if (kind === "withdrawn") {
    // The client takes its own change back before staff act: nothing is owed, so the need leaves the TV (O27).
    let t = drawTimes(r);
    while (t.start === c.start && t.end === c.end) t = drawTimes(r);
    const rg = rgOf(t.start, t.end, r);
    const target = { quote: w.day, date: g(c.date, w.day), start: null };
    const back = lang.isRich() ? lang.pickL(["Sorry, please ignore my last email, we'll keep it as it is.", "Actually scrap that, keep it as it was. Apologies!", "Please disregard my previous email, no change needed."])
      : "Sorry, please ignore my last email, we'll keep it as it is.";
    return {
      variant: kind, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0,
      orders: [{ calls: job.calls, by, number: String(73000 + ctx.n) }],
      emails: [
        { at: 0, subject: "Change to booking", body: letter(ctx, `Can we change ${w.day} at ${w.at} to ${rg.text} please?`), from: ctx.contact.email,
          oracle: ex("change", [req({ action: "change_times", date: g(c.date, w.day), ...timeFields(t.start, t.end, rg), venue: g(c.place.name, w.at), target })]) },
        { at: H, subject: "Re: Change to booking", body: letter(ctx, back), from: ctx.contact.email, oracle: ex("info_only", []) },
      ],
      staff: [],
      looks: [
        { at: 2 * MIN, label: "after the change", state: "open", kind: "needs-updated", name: ctx.client.name, days: [c.date] },
        { at: H + 2 * MIN, label: "after the client takes it back", state: "absent" },
      ],
      expect: { decision: "write", change: "times", order: 0 },
    };
  }
  const t1 = drawTimes(r), rg1 = rgOf(t1.start, t1.end, r);
  let t2 = drawTimes(r);
  if (t2.start === t1.start) t2 = { start: t1.start === "09:00" ? "10:00" : "09:00", end: t1.end };
  const rg2 = rgOf(t2.start, t2.end, r);
  const target = { quote: w.day, date: g(c.date, w.day), start: null };
  return {
    variant: kind, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0,
    orders: [{ calls: job.calls, by, number: String(73000 + ctx.n) }],
    emails: [
      { at: 0, subject: "Change to booking", body: letter(ctx, `Can we change ${w.day} at ${w.at} to ${rg1.text} please?`), from: ctx.contact.email,
        oracle: ex("change", [req({ action: "change_times", date: g(c.date, w.day), ...timeFields(t1.start, t1.end, rg1), venue: g(c.place.name, w.at), target })]) },
      { at: DAY, subject: "Re: Change to booking", body: letter(ctx, `Sorry, my mistake: can ${w.day} be ${rg2.text} instead?`), from: ctx.contact.email,
        oracle: ex("change", [req({ action: "change_times", date: g(c.date, w.day), ...timeFields(t2.start, t2.end, rg2), target })]) },
    ],
    staff: [
      { at: 2 * H, note: "staff make the first change", act: (os) => staff.setTimes(os[0], 0, c.date, t1.start, t1.end, by) },
      { at: DAY + 2 * H, note: "staff make the correction", act: (os) => staff.setTimes(os[0], 0, c.date, t2.start, t2.end, by) },
    ],
    looks: [
      { at: 2 * H + 2 * MIN, label: "after the first change", state: "done" },
      { at: DAY + 2 * MIN, label: "after the correction", state: "open", kind: "needs-updated", name: ctx.client.name, days: [c.date] },
      { at: DAY + 2 * H + 2 * MIN, label: "after staff correct it", state: "done" },
    ],
    expect: { decision: "write", change: "times", order: 0, email: 1 },
  };
}

/**
 * I: a price or a question. A quote naming its shifts is booked as an order, as ops book it (plan.ts: of the quote
 * requests 9-13 Oct that named their shifts, ops raised an order for every one), its card saying to price it; one
 * naming none (a rate card) is a reply the client is owed.
 */
function question(ctx: Ctx, kind: "quote for a job" | "rates"): Omit<GenCase, "id" | "category"> {
  const { r } = ctx;
  const job = drawJob(r, ctx.today, PLACES, ONE), c = job.calls[0], w = callWords(c, r);
  const near = lead14(ctx, job.calls);
  const text = kind === "rates" ? pick(r, ["What are your rates for crew at weekends, and is there a minimum call?", "Could you send over your current rate card please?"])
    : pick(r, [`Could you send me a quote for ${w.who} on ${w.day}, ${w.rg.text} at ${w.at}?`, `How much would ${w.who} be for ${w.day}, ${w.rg.text} at ${w.at}?`]);
  return {
    variant: kind, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0, orders: [],
    emails: [{ at: 0, subject: pick(r, ["Quote", "Pricing", "Rates"]), body: letter(ctx, text), from: ctx.contact.email, oracle: ex("quote_request", kind === "rates" ? [] : [reqOf(c, w)]) }],
    staff: [], looks: [kind === "rates" ? { at: 2 * MIN, label: "after the email", state: "reply" } : { at: 2 * MIN, label: "after the email", state: "open", kind: "needs-created", name: ctx.client.name, days: [c.date] }],
    expect: kind === "rates" ? { decision: "handoff", reason: /quote/ } : near ? { decision: "handoff", reason: /within \d+ days of the email/ } : { decision: "write", calls: job.calls },
  };
}

/** L: rare jobs inside the rules, more than two weeks out so the write itself is judged. */
function bespoke(ctx: Ctx, kind: "6 days at 2 venues with trades" | "a 4am call" | "11-20 crew on one call" | "overnight call"): Omit<GenCase, "id" | "category"> {
  const { r } = ctx;
  let job: Job;
  if (kind === "6 days at 2 venues with trades") {
    job = drawJob(r, ctx.today, PLACES, { days: 6, venues: 2, trades: false, callsPerDay: 1 });
    const t = TRADES[int(r, 1, TRADES.length - 1)][0];
    job.calls = job.calls.map((c, k) => (k % 3 === 2 ? { ...c, trade: t, crew: int(r, 1, 3) } : c));
  } else {
    job = drawJob(r, ctx.today, PLACES, ONE);
    const c = job.calls[0];
    job.calls[0] = kind === "a 4am call" ? { ...c, start: "04:00", end: "08:00" } : kind === "overnight call" ? { ...c, start: "22:00", end: "06:00" } : { ...c, crew: int(r, 11, 20) };
  }
  return booking(ctx, far(ctx, job), { variant: kind });
}

/** N: the booking wrapped in what real mail wraps it in. */
function adversarial(ctx: Ctx, kind: "forwarded" | "signature full of numbers" | "PO inside a link" | "out of office" | "quoted history"): Omit<GenCase, "id" | "category"> {
  const { r } = ctx;
  if (kind === "out of office") {
    const back = dayWords(addDays(ctx.today, int(r, 2, 9)), r);
    return {
      variant: kind, client: ctx.client, sender: ctx.contact.email, today: ctx.today, t0: ctx.t0, orders: [],
      emails: [{ at: 0, subject: "Automatic reply: Crew booking", from: ctx.contact.email, oracle: ex("info_only", []),
        body: `Thank you for your email. I am out of the office until ${back} with limited access to email. For anything urgent please call the office on 020 7946 0${int(r, 100, 999)}.` }],
      staff: [], looks: [{ at: 2 * MIN, label: "after the auto-reply", state: "absent" }],
      expect: { decision: "none" },
    };
  }
  const job = far(ctx, drawJob(r, ctx.today, PLACES, ONE));
  if (kind === "PO inside a link") job.po = `PO${int(r, 10000, 99999)}`;
  const base = booking(ctx, job, { variant: kind, noise: kind === "quoted history" });
  const e = base.emails[0];
  if (kind === "forwarded") {
    const fwd = pick(r, ctx.client.contacts.filter((x) => x.email !== ctx.contact.email).concat(ctx.client.contacts));
    e.body = `Hi,\n\nPlease see below, can you book this in?\n\nThanks\n${ctx.contact.name}\n\n---------- Forwarded message ---------\nFrom: ${fwd.name} ${fwd.surname} <${fwd.email}>\nSubject: ${e.subject}\n\n${e.body}`;
  }
  if (kind === "signature full of numbers") e.body += `\nUnit ${int(r, 2, 40)}, ${int(r, 10, 99)}-${int(r, 100, 199)} Mill Lane, London E3 2AB\nT: 020 7946 0${int(r, 100, 999)} | M: 07700 900${int(r, 100, 999)}\nRegistered in England and Wales No. 0${int(r, 1000000, 9999999)}`;
  if (kind === "PO inside a link" && e.oracle.po) {
    e.body = e.body.replace(e.oracle.po.quote, `PO here: https://portal.${ctx.client.domain}/po/view?ref=${job.po}`);
    e.oracle = { ...e.oracle, po: g(job.po!, job.po!) };
  }
  return base;
}

/** O: OnSinch answers 500 to every read for a while; nothing may be written on what was not read. */
function fault(ctx: Ctx, kind: "OnSinch down when the email comes" | "OnSinch down when staff act"): Omit<GenCase, "id" | "category"> {
  const base = change(ctx, "times", "venue");
  base.variant = kind;
  const at = kind === "OnSinch down when the email comes" ? -MIN : 2 * H - MIN;
  base.faults = [{ from: at, to: at + 20 * MIN }];
  // A plan that could not read OnSinch is a card, never a guess (a failed read or plan becomes a card).
  if (kind === "OnSinch down when the email comes") base.expect = { decision: "handoff", reason: /could not plan/ };
  // Read once OnSinch answers again: the TV's later looks move past the fault.
  base.looks = base.looks.map((l) => ({ ...l, at: l.at + 25 * MIN }));
  return base;
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
    const parts = { crew: miss === "crew" ? "some crew" : w.who, when: miss === "times" ? "" : `, ${w.rg.text}`, at: miss === "venue" ? "" : ` at ${w.at}`, day: miss === "day" ? "soon" : `on ${w.day}` };
    const text = `Could we get ${parts.crew} ${parts.day}${parts.when}${parts.at}?`;
    const rq = req({ action: "new_shift", ...(miss === "day" ? {} : { date: g(c.date, w.day) }), ...(miss === "times" ? {} : timeFields(c.start, c.end, w.rg)),
      ...(miss === "crew" ? {} : { crew: g(c.crew, w.who) }), ...(miss === "venue" ? {} : { venue: g(c.place.name, w.at) }) });
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
  G: { title: "References", make: (ctx) => reference(ctx, pick(ctx.r, ["po on two orders", "R quoted from an old message", "R OnSinch does not hold"] as const)) },
  H: { title: "Thread dynamics", make: (ctx) => thread(ctx, pick(ctx.r, ["correction", "confirmation", "missing crew sent later", "withdrawn"] as const)) },
  I: { title: "Quotes and questions", make: (ctx) => question(ctx, pick(ctx.r, ["quote for a job", "quote for a job", "rates"] as const)) },
  L: { title: "Bespoke but buildable", make: (ctx) => bespoke(ctx, pick(ctx.r, ["6 days at 2 venues with trades", "a 4am call", "11-20 crew on one call", "overnight call"] as const)) },
  N: { title: "Adversarial language", make: (ctx) => adversarial(ctx, pick(ctx.r, ["forwarded", "signature full of numbers", "PO inside a link", "out of office", "quoted history"] as const)) },
  O: { title: "OnSinch faults", make: (ctx) => fault(ctx, pick(ctx.r, ["OnSinch down when the email comes", "OnSinch down when staff act"] as const)) },
};

/**
 * The set: n cases per category, each seeded so it can be rerun alone. Every case runs on an empty world of its own
 * (run.mts), but time only moves forward: each case starts the morning after the last look of the one before. The
 * app keeps OnSinch's answers in memory for minutes by the clock (replan.ts cached), and a clock that went back
 * served one case's client list to the next ("no single client company", 223 of 270 on 31 Oct).
 */
export function generate(categories: string[], n: number, seed = 31_10_2026, from = Date.parse("2026-11-02T09:30:00Z"), rich = true): GenCase[] {
  const out: GenCase[] = [];
  let k = 0, cursor = from;
  for (const cat of categories) for (let i = 0; i < n; i++, k++) {
    const r = rng(seed * 100 + k);
    const client = makeClient(r, k);
    const t0 = cursor + int(r, 0, 8) * H;
    const today = new Date(t0).toISOString().slice(0, 10);
    sentYear = Number(today.slice(0, 4)); sentDay = today;
    lang.setLanguage(seed * 100 + k, rich);
    const made = CATEGORIES[cat].make({ r, n: k, client, contact: pick(r, client.contacts), t0, today });
    out.push({ id: `${cat}${String(i + 1).padStart(3, "0")}`, category: cat, ...made });
    const end = t0 + Math.max(...made.looks.map((l) => l.at), ...made.staff.map((x) => x.at));
    cursor = Date.parse(`${new Date(end + DAY).toISOString().slice(0, 10)}T09:30:00Z`);
  }
  return out;
}
