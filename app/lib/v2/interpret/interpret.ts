// ============================================================================
// From a model's extraction to requests whose every value this code read for itself.
// A field whose quote is not in the newest message, or does not parse to the stated value,
// is dropped and named in `problems`. A request with problems produces no write.
// ============================================================================
import type { Extraction, Grounded, RawRequest } from "./extract";
import { addMinutes, amountIn, parseCount, parseDate, parseDuration, parseNewDate, parseTime, poAfterLabel, quoteIn, subjectDate } from "./ground";

export type Request = {
  action: RawRequest["action"];
  date?: string;
  start?: string;
  end?: string;
  /** A new length with no time: "increase hours to 8". The planner keeps the start. */
  duration?: number;
  crew?: number;
  crew_add?: number;
  crew_remove?: number;
  venue?: string;
  crew_chief?: boolean;
  trade?: string;
  target?: { quote: string; date?: string; start?: string };
  problems: string[];
};

/** problems block the email (no write); notes are kept with the decision and block nothing. */
export type Interpretation = { intent: Extraction["intent"]; po?: string; requests: Request[]; problems: string[]; notes?: string[] };

/**
 * What the thread itself already says. A reply that refers back ("Please may this be booked",
 * "also for 2 hours at 21:30") is about the request it answers: Ben 10-06, "Never infer from
 * history unless explicitly requested and the job can be found". Here the client's own words
 * ask for it and the job is the client's own earlier request on the same thread, so it is
 * found, never guessed. Measured on the shadow emails 10-09..10-11: 6 of the 44 hand-offs
 * were replies whose day, venue or whole booking was in the client's previous message.
 */
export type GroundContext = { subject?: string; prior?: Request[] };

/** A reply that books what was asked before, in the client's words. */
const CONFIRM = /\b(please (?:may|can|could) (?:this|that|it|these|they) be booked|please (?:book|confirm)(?: (?:this|that|it|these|them|in))?\b|(?:happy|ok|okay|good) to (?:go ahead|proceed|book|confirm)|please go ahead|go ahead (?:and|with)|let'?s (?:confirm|book|go ahead)|(?:can|could) (?:i|we) (?:please )?confirm|we(?:'d| would) like to (?:confirm|book|go ahead)|confirm(?:ing)? (?:the|this|that|our) (?:booking|job|order|quote))\b/i;
const REFERS_BACK = /\b(also|as well|same day|that day|too)\b/i;

/** Does the email name this day, by date or by weekday ("let's confirm Monday")? */
function dayNamedIn(text: string, day: string, sentIso: string): boolean {
  const wd = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(day + "T12:00:00Z").getUTCDay()];
  if (new RegExp(`\\b${wd}\\b`, "i").test(text)) return true;
  return (text.match(/\b\d{1,2}(?:st|nd|rd|th)?(?:[/.]\d{1,2}(?:[/.]\d{2,4})?|\s+[a-z]{3,9})?\b/gi) ?? []).some((t) => parseDate(t, sentIso) === day);
}

const complete = (r: Request) => r.action === "new_shift" && !r.problems.length && !!(r.date && r.start && r.end && r.crew);

export function ground(x: Extraction, newest: string, sentIso: string, ctx: GroundContext = {}): Interpretation {
  const problems: string[] = [];
  const notes: string[] = [];
  const prior = (ctx.prior ?? []).filter(complete);
  const fromSubject = ctx.subject ? subjectDate(ctx.subject, sentIso) : null;
  const check = <T>(name: string, g: Grounded<T> | undefined, parse: (q: string) => T | null): T | undefined => {
    if (!g) return undefined;
    if (typeof g !== "object" || typeof g.quote !== "string") { problems.push(`${name}: a value with no words quoted for it`); return undefined; }
    if (!quoteIn(newest, g.quote)) { problems.push(`${name}: "${g.quote}" is not in the email`); return undefined; }
    const v = parse(g.quote);
    if (v === null || v !== g.value) { problems.push(`${name}: "${g.quote}" reads as ${JSON.stringify(v)}, not ${JSON.stringify(g.value)}`); return undefined; }
    return v;
  };

  const requests: Request[] = (x.requests ?? []).map((r, i) => {
    const before = problems.length;
    const tag = `request ${i + 1}`;
    let date = check(`${tag} date`, r.date, (q) => parseNewDate(q, sentIso));
    const start = check(`${tag} start`, r.start, parseTime);
    let end = check(`${tag} end`, r.end, parseTime);
    const dur = check(`${tag} duration`, r.duration_minutes, parseDuration);
    if (!end && start && dur) end = addMinutes(start, dur);
    const crew = check(`${tag} crew`, r.crew, parseCount);
    // An increase must SAY it is one ("add 2", "2 more"): a bare "2 crew" is a total.
    const add = check(`${tag} crew increase`, r.crew_add, (q) => (/\b(add|extra|more|another|additional|plus)\b/i.test(q) ? amountIn(q) : null));
    // A decrease must SAY it is one ("stand down 2", "2 fewer"), as an increase must.
    const less = check(`${tag} crew decrease`, r.crew_remove ?? undefined, (q) => (/\b(stand(ing)? down|fewer|less|release|reduce|drop|remove)\b/i.test(q) ? amountIn(q) : null));
    let venue = r.venue && quoteIn(newest, r.venue.quote) && r.venue.quote.toLowerCase().includes(String(r.venue.value).toLowerCase()) ? String(r.venue.value) : undefined;
    const chief = check(`${tag} crew chief`, r.crew_chief, (q) => (/chief|crew ?boss|supervisor/i.test(q) ? true : null));
    const trade = r.trade && quoteIn(newest, r.trade.quote) ? r.trade.value : undefined;
    // The model sometimes gives the target's day or time as a bare value, its words being the
    // target's own quote ("the derig on Friday 3rd December 2027"). That quote is then what
    // is parsed: still the client's words, read here.
    const inTarget = <T>(v: Grounded<T> | T | null | undefined): Grounded<T> | undefined =>
      v == null ? undefined : typeof v === "object" ? (v as Grounded<T>) ?? undefined : { value: v as T, quote: r.target!.quote };
    const target = r.target && quoteIn(newest, r.target.quote)
      ? { quote: r.target.quote, date: check(`${tag} target date`, inTarget<string>(r.target.date), (q) => parseDate(q, sentIso)), start: check(`${tag} target start`, inTarget<string>(r.target.start), parseTime) }
      : undefined;
    const own = problems.slice(before);
    // A day the email leaves out: the subject's one date, else (for a reply that says it
    // refers back) the one day the client's earlier requests on this thread were all on.
    if (!date && !target?.date && !own.some((p) => /date/.test(p))) {
      const days = [...new Set(prior.map((p) => p.date!))];
      const back = days.length === 1 && REFERS_BACK.test(newest) ? days[0] : null;
      if (fromSubject || back) { date = (fromSubject ?? back)!; notes.push(`${tag}: the day ${date} is from ${fromSubject ? "the subject" : "the client's earlier email"}`); }
    }
    if (r.action === "new_shift" && !venue) {
      const venues = [...new Set(prior.map((p) => p.venue).filter((v): v is string => !!v))];
      if (venues.length === 1) { venue = venues[0]; notes.push(`${tag}: the venue is from the client's earlier email`); }
    }
    const need = (cond: boolean, what: string) => { if (!cond) own.push(`${tag}: no ${what} the client wrote`); };
    switch (r.action) {
      case "new_shift": need(!!date, "day"); need(!!start, "start time"); need(!!end, "end time or duration"); need(!!crew, "crew count"); break;
      // A move to another day is a change by itself: "move Tuesday's shift to Wednesday, same times".
      case "change_times": need(!!(date || target?.date), "day"); need(!!(start || end || dur || (date && target?.date && date !== target.date)), "new time or length"); break;
      case "change_crew": need(!!(date || target?.date), "day"); need(!!(crew || add || less), "crew count"); break; // a total AND an increase must agree with the shift: plan.ts checks
      case "cancel_shift": need(!!(date || target?.date), "day"); break;
      default: own.push(`${tag}: not an operation the system performs`);
    }
    return { action: r.action, date, start, end, duration: start || end ? undefined : dur, crew, crew_add: add, crew_remove: less, venue, crew_chief: chief, trade, target, problems: own };
  });

  // A PO is cosmetic (Ben: 1 in 50): one that is not proven is left off with a note, and
  // never blocks the booking it came with. EMS writes its job number unlabelled ("J46250 -
  // 13/10/26 @ ..."); refusing the booking for that would hand ops a booking the bot can do.
  let po: string | undefined;
  if (x.po) {
    // The label is looked for in the whole newest message: a model quotes "UKPO26-13426"
    // alone when the client wrote "Will be the PO number" on the next line.
    // A reply's subject is the thread's old subject: "Re: 13/10 British museum ref:2871" is
    // Bespoke's job reference from the first email, and read as new it would have replaced the
    // PO ops had set (1195) on R11430 (10-09). Only the client's newest words give a PO.
    const body = /^\s*(re|fw|fwd)\s*:/i.test(ctx.subject ?? "") ? newest.slice(newest.indexOf("\n") + 1) : newest;
    if (quoteIn(body, x.po.quote) && quoteIn(x.po.quote, x.po.value) && poAfterLabel(body, x.po.value)) po = x.po.value;
    else notes.push(`PO "${x.po.value}" left off: not a single reference after a PO label`);
  }
  // "Please may this be booked" with nothing else: the booking is the client's last complete
  // request on the thread, narrowed to a day this email names ("let's confirm Monday").
  let intent = x.intent;
  let reqs = requests;
  if (!reqs.length && intent !== "cancellation" && intent !== "change" && prior.length && CONFIRM.test(newest)) {
    const named = new Set(prior.map((p) => p.date!).filter((d) => dayNamedIn(newest, d, sentIso)));
    const take = named.size ? prior.filter((p) => named.has(p.date!)) : prior;
    reqs = take.map((p) => ({ ...p, problems: [] }));
    intent = "booking";
    notes.push(`confirms the booking asked for earlier in this thread (${[...new Set(take.map((p) => p.date))].join(", ")})`);
  }
  return { intent, po, requests: reqs, problems: problems.filter((p) => !requests.some((r) => r.problems.includes(p))), notes };
}
