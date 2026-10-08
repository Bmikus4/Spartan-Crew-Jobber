// ============================================================================
// From a model's extraction to requests whose every value this code read for itself.
// A field whose quote is not in the newest message, or does not parse to the stated value,
// is dropped and named in `problems`. A request with problems produces no write.
// ============================================================================
import type { Extraction, Grounded, RawRequest } from "./extract";
import { addMinutes, parseCount, parseDate, parseDuration, parseTime, quoteIn } from "./ground";

export type Request = {
  action: RawRequest["action"];
  date?: string;
  start?: string;
  end?: string;
  crew?: number;
  crew_add?: number;
  venue?: string;
  crew_chief?: boolean;
  trade?: string;
  target?: { quote: string; date?: string; start?: string };
  problems: string[];
};

export type Interpretation = { intent: Extraction["intent"]; po?: string; requests: Request[]; problems: string[] };

/** Trades the bot has been benched on, by the words clients use. Anything else goes to ops. */
const BENCHED_TRADES = /^(general )?(crew|crew members?|labou?rers?|hands?|stagehands?|local crew|crewing)$/i;

export function ground(x: Extraction, newest: string, sentIso: string): Interpretation {
  const problems: string[] = [];
  const check = <T>(name: string, g: Grounded<T> | undefined, parse: (q: string) => T | null): T | undefined => {
    if (!g) return undefined;
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
    const target = r.target && quoteIn(newest, r.target.quote)
      ? { quote: r.target.quote, date: check(`${tag} target date`, r.target.date, (q) => parseDate(q, sentIso)), start: check(`${tag} target start`, r.target.start, parseTime) }
      : undefined;
    const own = problems.slice(before);
    if (trade && !BENCHED_TRADES.test(trade.trim())) own.push(`${tag}: trade "${trade}" is not one the system books`);
    const need = (cond: boolean, what: string) => { if (!cond) own.push(`${tag}: no ${what} the client wrote`); };
    switch (r.action) {
      case "new_shift": need(!!date, "day"); need(!!start, "start time"); need(!!end, "end time or duration"); need(!!crew, "crew count"); break;
      case "change_times": need(!!(date || target?.date), "day"); need(!!(start || end), "new time"); break;
      case "change_crew": need(!!(date || target?.date), "day"); need(!!(crew || add), "crew count"); if (crew && add) own.push(`${tag}: both a total and an increase`); break;
      case "cancel_shift": need(!!(date || target?.date), "day"); break;
      default: own.push(`${tag}: not an operation the system performs`);
    }
    return { action: r.action, date, start, end, crew, crew_add: add, venue, crew_chief: chief, trade, target, problems: own };
  });

  let po: string | undefined;
  if (x.po) {
    if (quoteIn(newest, x.po.quote) && x.po.quote.includes(x.po.value) && /\d/.test(x.po.value)) po = x.po.value;
    else problems.push(`PO "${x.po.value}" is not grounded in the email or has no digit`);
  }
  return { intent: x.intent, po, requests, problems: problems.filter((p) => !requests.some((r) => r.problems.includes(p))) };
}
