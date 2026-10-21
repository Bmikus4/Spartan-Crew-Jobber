// ============================================================================
// From a model's extraction to requests whose every value this code read for itself.
// A field whose quote is not in the newest message, or does not parse to the stated value,
// is dropped and named in `problems`. A request with problems produces no write.
// ============================================================================
import type { Extraction, Grounded, RawRequest } from "./extract";
import { addMinutes, amountIn, countsIn, datesIn, durationsIn, londonDay, norm, oneIn, parseCount, parseDate, parseDuration, parseNewDate, parseTime, poAfterLabel, quoteIn, subjectDate, timesIn } from "./ground";
import { quotable, type ReadContext } from "./context";

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
  /** The booking and shift the reader picked from those it was shown, checked here (context.ts). */
  order_id?: number;
  order?: string;
  shift_id?: number;
  /** A venue from the client's own venues, by its OnSinch place id. */
  place_id?: number;
  /**
   * None of its values is in the client's own newest words: it comes from the thread's history
   * (a quoted email, a reply's subject, the earlier request a confirmation brings back). Never new
   * work: the planner only checks that an order holds it (Ben approved 10-20). Of the 6 shifts the
   * bot added from 9 to 20 Oct, 4 were such requests written beside staff's own identical shift.
   */
  history?: boolean;
  problems: string[];
};

/** problems block the email (no write); notes are kept with the decision and block nothing. */
export type Interpretation = { intent: Extraction["intent"]; po?: string; requests: Request[]; problems: string[]; notes?: string[]; order_id?: number; company_name?: string };

/**
 * What the thread itself already says. A reply that refers back ("Please may this be booked",
 * "also for 2 hours at 21:30") is about the request it answers: Ben 10-06, "Never infer from
 * history unless explicitly requested and the job can be found". Here the client's own words
 * ask for it and the job is the client's own earlier request on the same thread, so it is
 * found, never guessed. Measured on the shadow emails 10-09..10-11: 6 of the 44 hand-offs
 * were replies whose day, venue or whole booking was in the client's previous message.
 */
export type GroundContext = { subject?: string; prior?: Request[]; read?: ReadContext; linkedOrderId?: number | null };

/** A reply that books what was asked before, in the client's words. */
const CONFIRM = /\b(please (?:may|can|could) (?:this|that|it|these|they) be booked|please (?:book|confirm)(?: (?:this|that|it|these|them|in))?\b|(?:happy|ok|okay|good) to (?:go ahead|proceed|book|confirm)|please go ahead|go ahead (?:and|with)|let'?s (?:confirm|book|go ahead)|(?:can|could) (?:i|we) (?:please )?confirm|we(?:'d| would) like to (?:confirm|book|go ahead)|confirm(?:ing)? (?:the|this|that|our) (?:booking|job|order|quote))\b/i;
/**
 * CONFIRM, except where the client asks US to confirm: "PO will be raised when you can confirm
 * the quote amount?" (Premier PR, 10-13) brought back the earlier booking and the bot wrote a
 * second 06:00-10:00 beside staff's. "can you please confirm", "if you could confirm" are the same.
 */
export function confirms(text: string): boolean {
  for (const m of text.matchAll(new RegExp(CONFIRM.source, "gi"))) {
    if (!/\b(?:you|u)\b[\s\w']{0,20}$/i.test(text.slice(Math.max(0, m.index! - 30), m.index))) return true;
  }
  return false;
}
const CANCELS = /\b(cancel(l?ed|l?ing|lation)?|no longer (?:need|required|needed|going ahead)|not (?:be )?(?:needed|required)|filled (?:it )?elsewhere|(?:sorted|covered) (?:this |it )?(?:internally|elsewhere)|(?:do not|don'?t) need (?:the|this|that|them|it)|won'?t (?:be )?need(?:ed|ing)?)\b/i;
const REFERS_BACK = /\b(also|as well|same day|that day|too)\b/i;

/** Does the email name this day, by date or by weekday ("let's confirm Monday")? */
function dayNamedIn(text: string, day: string, sentIso: string): boolean {
  const wd = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(day + "T12:00:00Z").getUTCDay()];
  if (new RegExp(`\\b${wd}\\b`, "i").test(text)) return true;
  return (text.match(/\b\d{1,2}(?:st|nd|rd|th)?(?:[/.]\d{1,2}(?:[/.]\d{2,4})?|\s+[a-z]{3,9})?\b/gi) ?? []).some((t) => parseDate(t, sentIso) === day);
}

const complete = (r: Request) => r.action === "new_shift" && !r.problems.length && !!(r.date && r.start && r.end && r.crew);

export function ground(x: Extraction, newest: string, sentIso: string, ctx: GroundContext = {}): Interpretation {
  // Values may be quoted from the whole thread the reader was shown; the PO stays the newest's.
  const all = ctx.read ? quotable(ctx.subject ?? "", ctx.read, newest) : newest;
  const problems: string[] = [];
  const notes: string[] = [];
  const prior = (ctx.prior ?? []).filter(complete);
  const fromSubject = ctx.subject ? subjectDate(ctx.subject, sentIso) : null;
  // A value stands when its words are in the thread and THIS code reads that value in them:
  // the whole quote parsing to it, or it being among the values the quote holds ("4 - 6pm").
  // WHAT A CHANGE CHANGES IS THE CLIENT'S NEWEST WORDS. Earlier messages may say which shift it
  // is, and may give a new booking's details ("please book this" after Spartan's proposal), but
  // a new time or crew count for a booked shift taken from history rewrites the booking to an
  // old figure: "Happy to go ahead with this booking" set Wall to Wall R11486 to the 4 of the
  // quote it accepted (replay 10-13).
  const mine = `${ctx.subject ?? ""}\n${newest}`;
  // THE CLIENT'S OWN WORDS in this email: the newest message, and the subject only when it is
  // this email's own. A reply's subject ("Re: 4 x crew for 6am - 10am Wednesday 14th") is the
  // thread's first email, so a request whose every value is there or in the quoted thread is
  // history (Request.history). process.ts puts the subject on the newest message's first line.
  const body = ctx.subject != null && newest.startsWith(`${ctx.subject}\n`) ? newest.slice(ctx.subject.length + 1) : newest;
  const ownWords = /^\s*(re|fw|fwd|aw)\s*:/i.test(ctx.subject ?? "") ? body : `${ctx.subject ?? ""}\n${body}`;
  const check = <T>(name: string, g: Grounded<T> | undefined, parse: (q: string) => T | null, among?: (q: string) => Set<T>, text = all): T | undefined => {
    if (!g) return undefined;
    if (typeof g !== "object" || typeof g.quote !== "string") { problems.push(`${name}: a value with no words quoted for it`); return undefined; }
    if (!quoteIn(text, g.quote)) { problems.push(`${name}: "${g.quote}" is not in the email`); return undefined; }
    const v = parse(g.quote);
    if (v !== null && v === g.value) return v;
    if (among && among(g.quote).has(g.value)) return g.value;
    // "Arrival: 12:00 instead of 13:00", "today instead of yesterday": the new value comes
    // before "instead of", the old one after it. A target is the old one. Measured 10-15 on
    // Sol's readings: 3 of 10 refusals were a quote holding both values.
    const sides = /^(.*?)\b(?:instead of|rather than)\b(.*)$/i.exec(g.quote);
    if (sides) {
      // Each side without a label or emphasis: "Arrival: 12:00*" is 12:00.
      const side = (/target/.test(name) ? sides[2] : sides[1]).replace(/^[^:\d]*:\s*(?=\d)/, "").replace(/[*_~]+/g, "").trim();
      const w = side ? parse(side) : null;
      if ((w !== null && w === g.value) || (among && side && among(side).has(g.value))) return g.value;
    }
    problems.push(`${name}: "${g.quote}" reads as ${JSON.stringify(v)}, not ${JSON.stringify(g.value)}`);
    return undefined;
  };

  const requests: Request[] = (x.requests ?? []).map((r, i) => {
    const before = problems.length;
    const tag = `request ${i + 1}`;
    let date = check(`${tag} date`, r.date, (q) => parseNewDate(q, sentIso));
    // "04.11.25" in an email of 14 Oct 2026 (Event Concept's November requests; ops booked them
    // in 2026): last year's date, whose day comes round within 120 days, is that coming day.
    if (date && Number(date.slice(0, 4)) === Number(londonDay(sentIso).slice(0, 4)) - 1) {
      const next = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
      const ahead = (Date.parse(`${next}T12:00:00Z`) - Date.parse(`${londonDay(sentIso)}T12:00:00Z`)) / 864e5;
      if (ahead >= 0 && ahead <= 120) { notes.push(`${tag}: the email gives ${date.slice(0, 4)} for ${next.slice(5)}; read as ${next}, the coming one`); date = next; }
    }
    const where = r.action === "new_shift" ? all : mine;
    let start = check(`${tag} start`, r.start, parseTime, timesIn, where);
    const dur = check(`${tag} duration`, r.duration_minutes, parseDuration, durationsIn, where);
    // A finish the reader worked out from a length ("2hr at 07:00" -> 09:00) is grounded when the
    // quote holds a length that, from the grounded start, ends there. A finish with no words of
    // its own is the start plus the length when there is one.
    const s0 = start;
    const endAmong = (q: string) => new Set([...timesIn(q), ...(s0 ? [...durationsIn(q)].map((d) => addMinutes(s0, d)) : [])]);
    const endQuoted = !!r.end && typeof r.end === "object" && typeof r.end.quote === "string";
    let end = endQuoted || !(start && dur) ? check(`${tag} end`, r.end, parseTime, endAmong, where) : undefined;
    if (!end && start && dur) end = addMinutes(start, dur);
    let crew = check(`${tag} crew`, r.crew, parseCount, countsIn, where);
    // An increase must SAY it is one ("add 2", "2 more"): a bare "2 crew" is a total.
    const add = check(`${tag} crew increase`, r.crew_add, (q) => (/\b(add|extra|more|another|additional|plus)\b/i.test(q) ? amountIn(q) : null), undefined, where);
    // A decrease must SAY it is one ("stand down 2", "2 fewer"), as an increase must.
    const less = check(`${tag} crew decrease`, r.crew_remove ?? undefined, (q) => (/\b(stand(ing)? down|fewer|less|release|reduce|drop|remove)\b/i.test(q) ? amountIn(q) : null), undefined, where);
    // Letters and digits only: "London Intercontinental Park Lane\nOne Hamilton Place" quoted
    // across lines and given back with commas was refused as "no venue" (O Films, 10-09).
    const bare = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    let venue = r.venue && quoteIn(all, r.venue.quote) && bare(r.venue.quote).includes(bare(String(r.venue.value))) ? String(r.venue.value) : undefined;
    const chief = check(`${tag} crew chief`, r.crew_chief, (q) => (/chief|crew ?boss|supervisor/i.test(q) ? true : null));
    const trade = r.trade && quoteIn(all, r.trade.quote) ? r.trade.value : undefined;
    // "5 crew and a carpenter" read as two requests: the carpenter's is one person, in its words.
    if (r.action === "new_shift" && crew === undefined && trade && r.trade && (oneIn(r.trade.quote) || new RegExp(String.raw`\b(?:a|an|one)\s+${String(trade).toLowerCase().replace(/[^a-z ]/g, "").trim()}\b`).test(norm(where)))) {
      crew = 1;
      const k = problems.findIndex((p) => p.startsWith(`${tag} crew:`));
      if (k >= 0) problems.splice(k, 1);
    }
    // The model sometimes gives the target's day or time as a bare value, its words being the
    // target's own quote ("the derig on Friday 3rd December 2027"). That quote is then what
    // is parsed: still the client's words, read here.
    const inTarget = <T>(v: Grounded<T> | T | null | undefined): Grounded<T> | undefined =>
      v == null ? undefined : typeof v === "object" ? (v as Grounded<T>) ?? undefined : { value: v as T, quote: r.target!.quote };
    const targetProblemsFrom = problems.length;
    let target: Request["target"] = r.target && quoteIn(all, r.target.quote)
      ? { quote: r.target.quote, date: check(`${tag} target date`, inTarget<string>(r.target.date), (q) => parseDate(q, sentIso), (q) => datesIn(q, sentIso)), start: check(`${tag} target start`, inTarget<string>(r.target.start), parseTime, timesIn) }
      : undefined;
    // The booking and shift the reader picked: only from those it was shown, and only when
    // the shift's day agrees with any day the email gives for it. A pick that fails either is
    // dropped and the request is planned as if none was made.
    let order_id: number | undefined, order: string | undefined, shift_id: number | undefined, place_id: number | undefined;
    const bookings = ctx.read?.bookings ?? [];
    const sid = Number(r.shift_id) || 0;
    const b = bookings.find((k) => k.order === String(r.order ?? "").replace(/^r?/i, "R")) ?? (sid ? bookings.find((k) => k.shifts.some((s) => s.shift_id === sid)) : undefined);
    if (b) {
      const sh = sid ? b.shifts.find((s) => s.shift_id === sid) : undefined;
      const day = target?.date ?? (r.action !== "new_shift" ? date : undefined);
      if (sid && !sh) notes.push(`${tag}: shift ${sid} is not on ${b.order}; the pick is dropped`);
      else if (sh && day && day !== sh.date && !(date && target?.date)) notes.push(`${tag}: ${b.order} shift ${sh.shift_id} is on ${sh.date}, the email says ${day}; the pick is dropped`);
      // A new day on a picked shift is a move only when the client says so: "We need 2 x Crew
      // for 10hours on 11th October" was read as moving Blackout's 13th (10-09); ops made an order.
      else if (sh && date && date !== sh.date && r.action !== "new_shift" && !/\b(move|moving|moved|bring|push|swap|change (?:it |the date |the day )?to|instead)\b/i.test(mine)) notes.push(`${tag}: ${b.order} shift ${sh.shift_id} is on ${sh.date}, the email asks for ${date} without moving it; the pick is dropped`);
      // A PICK MUST BE BORNE OUT BY THE CLIENT'S OWN WORDS or by the thread's own link: the
      // shift's day, its start, its venue or the R number in the email, or the thread already
      // being about that order. "Please can I extend the below booking to 4x4hr at 18:00" (Event
      // Concept 10-12) named a booking pasted as an image; the reader guessed R11195 and the
      // change would have gone on the wrong job. Code and model must agree (Ben, 10-03).
      else if (!(ctx.linkedOrderId === b.order_id
        || new RegExp(String.raw`\b${b.order.slice(1)}\b`).test(mine)
        || (sh && ((day && day === sh.date) || datesIn(mine, sentIso).has(sh.date) || timesIn(mine).has(sh.start) || (sh.venue && bare(mine).includes(bare(sh.venue).slice(0, 12)))))
        || (!sh && b.shifts.some((s) => datesIn(mine, sentIso).has(s.date) || (s.venue && bare(mine).includes(bare(s.venue).slice(0, 12)))))))
        notes.push(`${tag}: nothing in the client's words or the thread's link bears out ${b.order}; the pick is dropped`);
      else {
        order_id = b.order_id; order = b.order;
        if (sh) {
          shift_id = sh.shift_id;
          target = { quote: target?.quote ?? sh.name, date: target?.date ?? sh.date, start: target?.start ?? sh.start };
          if (!date && r.action !== "new_shift") date = sh.date;
          // The picked shift's own day and start stand for the target: the reader's words for
          // it ("the evening call", "the below booking") need not parse to them.
          problems.splice(targetProblemsFrom);
        }
      }
    } else if (r.order) notes.push(`${tag}: ${r.order} is not among the client's current bookings; the pick is dropped`);
    // Times written against the booking: "finishing an hour earlier", "forward by 30mins",
    // "the same timings". With the booking picked they are read from its shift here, and stand
    // only when that reading is the reader's value.
    if (b) {
      const sh = shift_id ? b.shifts.find((s) => s.shift_id === shift_id) : undefined;
      const same = b.shifts.length && b.shifts.every((s) => s.start === b.shifts[0].start && s.end === b.shifts[0].end) ? b.shifts[0] : undefined;
      const relative = (q: string, base: string | undefined): string | null => {
        if (!base) return null;
        // "extend the AM call by 1hr" / "cut it short by 30 mins": the finish moves.
        const ext = /\b(extend|extended|extending|longer|cut|shorten|shortened|reduce)\b[^.]*?\bby\s+(an?|one|half an?|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|mins?|minutes?)\b/.exec(norm(q));
        if (ext) { const n = /half/.test(ext[2]) ? 0.5 : /^(an?|one)$/.test(ext[2]) ? 1 : Number(ext[2]); const mm = Math.round(n * (/^h/.test(ext[3]) ? 60 : 1)); return addMinutes(base, /cut|shorten|reduce/.test(ext[1]) ? -mm : mm); }
        const m = /\b(an?|one|half an?|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|mins?|minutes?)\b[^.]*?\b(earlier|later|early|late|forward|back|before|after)\b/.exec(norm(q)) ?? /\b(earlier|later|forward|back)\s+(?:by\s+)?(an?|one|half an?|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|mins?|minutes?)\b/.exec(norm(q));
        if (!m) return null;
        const [amt, unit, dir] = /\d|an?|one|half/.test(m[1]) && !/earlier|later|forward|back/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[3], m[1]];
        const n = /half/.test(amt) ? 0.5 : /^(an?|one)$/.test(amt) ? 1 : Number(amt);
        const mins = Math.round(n * (/^h/.test(unit) ? 60 : 1));
        return addMinutes(base, /earlier|early|forward|before/.test(dir) ? -mins : mins);
      };
      const fix = (field: "start" | "end", g: Grounded<string> | undefined, base: string | undefined): string | undefined => {
        if (!g || typeof g !== "object" || typeof g.quote !== "string" || !quoteIn(where, g.quote)) return undefined;
        const v = relative(g.quote, base) ?? (/\bsame\s+(times?|timings?|hours?)\b/.test(norm(g.quote)) && same ? same[field] : null);
        if (v !== g.value) return undefined;
        const i = problems.findIndex((p) => p.startsWith(`${tag} ${field}:`));
        if (i >= 0) problems.splice(i, 1);
        return v;
      };
      if (!start) start = fix("start", r.start ?? undefined, sh?.start ?? same?.start);
      if (!end) end = fix("end", r.end ?? undefined, sh?.end ?? same?.end) ?? (start && dur ? addMinutes(start, dur) : undefined);
    }
    if (r.venue_id && typeof r.venue_id === "object") {
      const v = (ctx.read?.venues ?? []).find((x) => x.place_id === Number(r.venue_id!.value));
      if (v && quoteIn(all, r.venue_id.quote)) { place_id = v.place_id; venue = venue ?? v.name; }
      else notes.push(`${tag}: venue ${r.venue_id.value} is not one the client uses, or its words are not in the email`);
    }
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
    // "a half shift - starting midday" (Bearded Kitten 10-09, booked 4 hours): Spartan's 4-hour call.
    if (!end && start && /\bhalf (?:a )?(?:shift|day)\b/i.test(mine)) { end = addMinutes(start, 240); notes.push(`${tag}: a half shift is 4 hours`); }
    // A change on "tonight"/"today"/"tomorrow" with no day given: that day, counted from sending.
    if (!date && !target?.date && r.action !== "new_shift") { const d = /\b(tonight|today|tomorrow)\b/i.exec(mine); if (d) date = parseDate(d[1], sentIso) ?? undefined; }
    // "2x2hr at 16:30" added to a booking is a new CALL of 2 crew for 2 hours at 16:30, not two
    // more people on a booked shift: Event Concept writes every extra call this way (10-09
    // "Changes", Guildhall), and the reader keeps giving it as an increase.
    let action = r.action;
    const call = r.action === "change_crew" && add === undefined && r.crew_add && typeof r.crew_add === "object" && typeof r.crew_add.quote === "string" && quoteIn(mine, r.crew_add.quote)
      ? /\b(\d{1,3})\s*x\s*(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\s+(?:at|from|@)\s*(\d{1,2}[:.]?\d{2})\b/i.exec(r.crew_add.quote) : null;
    const callStart = call ? parseTime(call[3]) : null;
    if (call && callStart) {
      action = "new_shift"; crew = Number(call[1]); start = callStart; end = addMinutes(callStart, Math.round(Number(call[2]) * 60));
      if (!date && target?.date) date = target.date;
      for (const list of [own, problems]) for (let k = list.length - 1; k >= 0; k--) if (list[k].startsWith(`${tag} crew increase`)) list.splice(k, 1);
      notes.push(`${tag}: "${call[0]}" is a new call of ${crew} crew, ${start}-${end}`);
    }
    const need = (cond: boolean, what: string) => { if (!cond) own.push(`${tag}: no ${what} the client wrote`); };
    switch (action) {
      // A new shift with no times is booked at assumed ones (Ben, 10-15; assume.ts), as the old
      // engine booked 08:00 when no start was given. A day and a headcount cannot be assumed.
      case "new_shift": need(!!date, "day"); need(!!crew, "crew count"); break;
      // A move to another day is a change by itself: "move Tuesday's shift to Wednesday, same times".
      case "change_times": need(!!(date || target?.date), "day"); need(!!(start || end || dur || (date && target?.date && date !== target.date)), "new time or length"); break;
      case "change_crew": need(!!(date || target?.date), "day"); need(!!(crew || add || less), "crew count"); break; // a total AND an increase must agree with the shift: plan.ts checks
      // A whole shift is cancelled only on words that cancel it: "stand down on the 2nd man for
      // Tuesday" (Carrier, 10-09) is one person fewer, and read as a cancel it lost the shift.
      case "cancel_shift": need(!!(date || target?.date), "day"); if (!CANCELS.test(mine)) own.push(`${tag}: no words cancelling the whole shift`); break;
      // "Could you also send over a quote for Mackenzie" beside a time change (Creative
      // Technology 10-12) is for the inbox; the time change is still made.
      default: if ((x.requests ?? []).some((q) => q.action !== "other")) notes.push(`${tag}: "${r.target?.quote ?? "a request"}" is not a booking change and is left for the inbox`); else own.push(`${tag}: not an operation the system performs`);
    }
    // History when the values it SETS have words and none of them is the client's own. Which
    // shift a change or a cancellation is about may well come from the thread: "I'll not be
    // needing this call now" (RG Jones R11549) and "no thank you" (Bearded Kitten R11545) name
    // their day only in the quoted email, and are the client's own cancellations, so a cancel and
    // an ask the system does not perform are never history. A trade ("crew") or a chief says
    // nothing about which email asked, so they do not count either way.
    const sets = r.action === "new_shift" ? [r.date, r.start, r.end, r.crew, r.venue]
      : r.action === "change_times" ? [r.start, r.end, r.duration_minutes]
      : r.action === "change_crew" ? [r.crew, r.crew_add, r.crew_remove] : [];
    const quotes = sets
      .map((g) => (g && typeof g === "object" && typeof (g as { quote?: unknown }).quote === "string" ? (g as { quote: string }).quote : null))
      .filter((x): x is string => !!x && !!x.trim());
    const history = quotes.length > 0 && !quotes.some((x) => quoteIn(ownWords, x)) && !(call && quoteIn(ownWords, call[0]));
    return { action, date, start, end, duration: start || end ? undefined : dur, crew, crew_add: add, crew_remove: less, venue, crew_chief: chief, trade, target, order_id, order, shift_id, place_id, ...(history ? { history: true } : {}), problems: own };
  });

  // "Can I also add 3 people for the load out on Sunday 25th, this would be the same timings"
  // (We Are Family 10-09): a new shift with no times of its own takes the times of the other
  // shift the same email is about, when there is exactly one.
  for (const [k, q] of requests.entries()) {
    if (q.action !== "new_shift" || (q.start && q.end) || !/\bsame (?:times?|timings?|hours?)\b/i.test(mine)) continue;
    const others = requests.filter((o, j) => j !== k && (o.target?.start || o.start));
    const sib = others.length === 1 ? others[0] : undefined;
    const sh = sib?.shift_id ? (ctx.read?.bookings ?? []).flatMap((b) => b.shifts).find((s) => s.shift_id === sib.shift_id) : undefined;
    const st = sh?.start ?? sib?.start, en = sh?.end ?? sib?.end;
    if (!st || !en) continue;
    q.start = st; q.end = en;
    const gone = q.problems.filter((p) => /no (start time|end time or duration) the client wrote|(start|end): /.test(p));
    q.problems = q.problems.filter((p) => !gone.includes(p));
    for (const p of gone) { const i = problems.indexOf(p); if (i >= 0) problems.splice(i, 1); }
    if (sib?.order_id && !q.order_id) { q.order_id = sib.order_id; q.order = sib.order; }
    notes.push(`request ${k + 1}: "the same timings" are ${st}-${en}, from the other shift in this email`);
  }
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
  // What it brings back is the thread's history: never written again, only found (plan.ts).
  if (!reqs.length && intent !== "cancellation" && intent !== "change" && prior.length && confirms(newest)) {
    const named = new Set(prior.map((p) => p.date!).filter((d) => dayNamedIn(newest, d, sentIso)));
    const take = named.size ? prior.filter((p) => named.has(p.date!)) : prior;
    reqs = take.map((p) => ({ ...p, problems: [], history: true }));
    intent = "booking";
    notes.push(`confirms the booking asked for earlier in this thread (${[...new Set(take.map((p) => p.date))].join(", ")})`);
  }
  // The booking a PO or a request-less message is about, only from those the reader was shown.
  const whole = x.order ? (ctx.read?.bookings ?? []).find((k) => k.order === String(x.order).replace(/^r?/i, "R")) : undefined;
  const company_name = x.company && typeof x.company === "object" && quoteIn(all, x.company.quote) && String(x.company.value ?? "").trim() ? String(x.company.value).trim().slice(0, 80) : undefined;
  return { intent, po, requests: reqs, problems: problems.filter((p) => !requests.some((r) => r.problems.includes(p))), notes, ...(whole ? { order_id: whole.order_id } : {}), ...(company_name ? { company_name } : {}) };
}
