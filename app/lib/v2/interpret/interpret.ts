// ============================================================================
// From a model's extraction to requests whose every value this code read for itself.
// A field whose quote is not in the newest message, or does not parse to the stated value,
// is dropped and named in `problems`. A request with problems produces no write.
// ============================================================================
import type { Extraction, Grounded, RawRequest } from "./extract";
import { addMinutes, parseCount, parseDate, parseDuration, parseTime, poAfterLabel, quoteIn } from "./ground";

export type Request = {
  action: RawRequest["action"];
  date?: string;
  start?: string;
  end?: string;
  /** A new length with no time: "increase hours to 8". The planner keeps the start. */
  duration?: number;
  crew?: number;
  crew_add?: number;
  venue?: string;
  crew_chief?: boolean;
  trade?: string;
  target?: { quote: string; date?: string; start?: string };
  problems: string[];
};

/** problems block the email (no write); notes are kept with the decision and block nothing. */
export type Interpretation = { intent: Extraction["intent"]; po?: string; requests: Request[]; problems: string[]; notes?: string[] };

/** Trades the bot has been benched on, by the words clients use. Anything else is left for a person. */
const BENCHED_TRADES = /^(general )?(crew|crew members?|labou?rers?|hands?|stagehands?|local crew|crewing)$/i;

export function ground(x: Extraction, newest: string, sentIso: string): Interpretation {
  const problems: string[] = [];
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
    const date = check(`${tag} date`, r.date, (q) => parseDate(q, sentIso));
    const start = check(`${tag} start`, r.start, parseTime);
    let end = check(`${tag} end`, r.end, parseTime);
    const dur = check(`${tag} duration`, r.duration_minutes, parseDuration);
    if (!end && start && dur) end = addMinutes(start, dur);
    const crew = check(`${tag} crew`, r.crew, parseCount);
    // An increase must SAY it is one ("add 2", "2 more"): a bare "2 crew" is a total.
    const add = check(`${tag} crew increase`, r.crew_add, (q) => (/\b(add|extra|more|another|additional|plus)\b/i.test(q) ? Number(/(\d{1,3})/.exec(q)?.[1]) || null : null));
    const venue = r.venue && quoteIn(newest, r.venue.quote) && r.venue.quote.toLowerCase().includes(String(r.venue.value).toLowerCase()) ? String(r.venue.value) : undefined;
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
    if (trade && !BENCHED_TRADES.test(trade.trim())) own.push(`${tag}: trade "${trade}" is not one the system books`);
    const need = (cond: boolean, what: string) => { if (!cond) own.push(`${tag}: no ${what} the client wrote`); };
    switch (r.action) {
      case "new_shift": need(!!date, "day"); need(!!start, "start time"); need(!!end, "end time or duration"); need(!!crew, "crew count"); break;
      case "change_times": need(!!(date || target?.date), "day"); need(!!(start || end || dur), "new time or length"); break;
      case "change_crew": need(!!(date || target?.date), "day"); need(!!(crew || add), "crew count"); break; // a total AND an increase must agree with the shift: plan.ts checks
      case "cancel_shift": need(!!(date || target?.date), "day"); break;
      default: own.push(`${tag}: not an operation the system performs`);
    }
    return { action: r.action, date, start, end, duration: start || end ? undefined : dur, crew, crew_add: add, venue, crew_chief: chief, trade, target, problems: own };
  });

  // A PO is cosmetic (Ben: 1 in 50): one that is not proven is left off with a note, and
  // never blocks the booking it came with. EMS writes its job number unlabelled ("J46250 -
  // 13/10/26 @ ..."); refusing the booking for that would hand ops a booking the bot can do.
  let po: string | undefined;
  const notes: string[] = [];
  if (x.po) {
    // The label is looked for in the whole newest message: a model quotes "UKPO26-13426"
    // alone when the client wrote "Will be the PO number" on the next line.
    if (quoteIn(newest, x.po.quote) && quoteIn(x.po.quote, x.po.value) && poAfterLabel(newest, x.po.value)) po = x.po.value;
    else notes.push(`PO "${x.po.value}" left off: not a single reference after a PO label`);
  }
  return { intent: x.intent, po, requests, problems: problems.filter((p) => !requests.some((r) => r.problems.includes(p))), notes };
}
