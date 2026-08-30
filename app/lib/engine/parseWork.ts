// ============================================================================
// Read crew counts, dates and shift times out of the email text, in code.
// ----------------------------------------------------------------------------
// The 18:00 finish was a PROMPT INSTRUCTION, and prompt instructions drift. It
// survived months and put a defaulted finish on 4 of 10 real threads, because nothing
// measured it and the order looked identical either way. A rule written here holds
// until someone edits this file and a test tells them what they broke.
//
// This does NOT replace the model. The shapes Spartan's clients write in are regular —
//   "09:00 - 16:00"   "until 15:30"   "6x3hr at 17:00"   "x4 locals"   "crew of 6"
// — and a parser is exact on those and silent on everything else. The model handles
// prose. The division of labour is:
//
//   the parser FILLS a field the model left blank, and
//   the parser DISAGREEING with the model is a reason to escalate, never to overrule.
//
// The second half matters more than the first. A parser that overrules a model it
// disagrees with is a second, worse extractor; a parser that raises its hand is a
// check on the one we have. Every function here returns null rather than a guess.
// ============================================================================

export interface ParsedTimes {
  start?: string;  // HH:MM, 24h
  end?: string;    // HH:MM, 24h
  /** true when the end came from a duration ("3hrs from 17:00") rather than a stated time. */
  endFromDuration?: boolean;
}

/** "9", "9am", "9.30", "09:30", "9:30pm" -> "HH:MM", or null. */
function toHHMM(raw: string, meridiem?: string): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const mer = (meridiem || "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  // A BARE hour with no meridiem: 1-7 in a work context means the afternoon
  // ("crew from 8 till 5" is 08:00-17:00, not 05:00). 8-23 are taken literally.
  //
  // Bare is the whole condition, and getting it wrong is not cosmetic: applied to any
  // 1-7 it turned "on site at 07:30" into 19:30 and "call time 06:45" into 18:45 —
  // a night shift instead of a morning one. Minutes ("7:30") or a leading zero ("07")
  // mean the writer was reading a clock, so the hour is literal.
  const bare = !m[2] && !/^0/.test(raw.trim());
  if (!mer && bare && h >= 1 && h <= 7) h += 12;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const HOUR = "(\\d{1,2}(?:[:.]\\d{2})?)\\s*(am|pm)?";

/**
 * A stated shift. Only patterns where BOTH ends are explicit, or one end plus a
 * duration, count — "from 8am" alone gives a start and no end, which is exactly the
 * case the 18:00 default was quietly filling.
 */
export function parseTimes(text: string): ParsedTimes | null {
  const t = text.replace(/–|—/g, "-");   // en/em dash -> hyphen

  // "6x3hr at 17:00" / "3 hours from 17:00" / "17:00 for 3hrs"
  const durAt = new RegExp(`(\\d{1,2}(?:\\.\\d)?)\\s*(?:hr|hrs|hour|hours)\\s*(?:from|at|starting)\\s*${HOUR}`, "i").exec(t)
    || new RegExp(`${HOUR}\\s*(?:for)\\s*(\\d{1,2}(?:\\.\\d)?)\\s*(?:hr|hrs|hour|hours)`, "i").exec(t);
  if (durAt) {
    // The two shapes put the duration on opposite sides; detect which matched.
    const durFirst = /^\d/.test(durAt[1]) && /hr|hour/i.test(durAt[0].slice(0, durAt[0].search(/from|at|starting/i)));
    const hours = Number(durFirst ? durAt[1] : durAt[3]);
    const start = durFirst ? toHHMM(durAt[2], durAt[3]) : toHHMM(durAt[1], durAt[2]);
    if (start && Number.isFinite(hours) && hours > 0 && hours <= 24) {
      const [h, m] = start.split(":").map(Number);
      const endMin = h * 60 + m + Math.round(hours * 60);
      if (endMin < 24 * 60) {
        return { start, end: `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`, endFromDuration: true };
      }
      return { start, endFromDuration: true };
    }
  }

  // "09:00 - 16:00" / "9am-5pm" / "9 til 5" / "between 8 and 6"
  const range = new RegExp(`${HOUR}\\s*(?:-|to|till|til|until|thru|through)\\s*${HOUR}`, "i").exec(t);
  if (range) {
    // A shared meridiem written once at the end applies to both ends: "9-5pm".
    const start = toHHMM(range[1], range[2] || (range[4] && Number(range[1].split(/[:.]/)[0]) < Number(range[3].split(/[:.]/)[0]) ? range[4] : undefined));
    const end = toHHMM(range[3], range[4]);
    if (start && end) return { start, end };
  }

  // A finish on its own: "until 15:30", "finish by 6pm", "off site by 17:00".
  const endOnly = new RegExp(`(?:until|till|til|finish(?:ing|ed)?(?:\\s+by)?|done by|off site by|end(?:s|ing)?\\s+at)\\s*${HOUR}`, "i").exec(t);
  const startOnly = new RegExp(`(?:from|start(?:ing|s)?(?:\\s+at)?|on site (?:at|from)|arrive(?:\\s+at)?|call time)\\s*${HOUR}`, "i").exec(t);
  const out: ParsedTimes = {};
  if (startOnly) { const s = toHHMM(startOnly[1], startOnly[2]); if (s) out.start = s; }
  if (endOnly) { const e = toHHMM(endOnly[1], endOnly[2]); if (e) out.end = e; }
  return out.start || out.end ? out : null;
}

export interface ParsedCrew { size: number; hint?: string }

/** Words that name a crew type, mapped to the hint compose.ts already understands. */
const ROLE_WORDS: Array<[RegExp, string]> = [
  [/crew chiefs?|chiefs?|crew leads?|crew leaders?/i, "crew chief"],
  [/cscs/i, "CSCS"],
  [/drivers?|driving/i, "driver"],
  [/carpenters?|chippies|chippys?/i, "carpenter"],
  [/telehandlers?/i, "telehandler"],
  [/forklifts?|counterbalance/i, "forklift"],
  [/av techs?|av technicians?|audio techs?|\bav\b/i, "AV"],
  [/riggers?/i, "rigger"],
  [/locals?|crew|staff|hands|labourers?|technicians?|guys|men|people|bodies/i, ""],
];

function hintFor(word: string): string | undefined {
  for (const [re, hint] of ROLE_WORDS) if (re.test(word)) return hint || undefined;
  return undefined;
}

/**
 * Crew asked for. Handles the three shapes Spartan actually receives:
 *   "6 crew" / "6 x crew" / "6no crew"      number then role
 *   "x4 locals" / "x 4 CSCS"                 x then number then role
 *   "crew of 6" / "team of 12"               role then number
 *
 * Returns every distinct request found, because "4 crew and 2 drivers" is two slot
 * teams, and collapsing it to one is the difference between a right and a wrong order.
 */
export function parseCrew(text: string): ParsedCrew[] {
  const found: ParsedCrew[] = [];
  const seen = new Set<string>();
  const push = (size: number, word: string) => {
    if (!Number.isFinite(size) || size < 1 || size > 500) return;
    const hint = hintFor(word);
    const key = `${size}|${hint ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(hint ? { size, hint } : { size });
  };

  const ROLE = "(crew chiefs?|chiefs?|crew leads?|cscs|drivers?|carpenters?|chippies|telehandlers?|forklifts?|counterbalance|av techs?|av technicians?|audio techs?|riggers?|locals?|crew|staff|hands|labourers?|technicians?|guys|men|people|bodies)";

  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,3})\\s*(?:x|no\\.?|of)?\\s*${ROLE}\\b`, "gi"))) {
    push(Number(m[1]), m[2]);
  }
  for (const m of text.matchAll(new RegExp(`\\bx\\s*(\\d{1,3})\\s*${ROLE}\\b`, "gi"))) {
    push(Number(m[1]), m[2]);
  }
  for (const m of text.matchAll(new RegExp(`\\b${ROLE}\\s*(?:of|:)\\s*(\\d{1,3})\\b`, "gi"))) {
    push(Number(m[2]), m[1]);
  }
  return found;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * THE NEXT-OCCURRENCE RULE, and the one business number in this file.
 *
 * "8th March" written on 24 August means next March. The engine read it as this
 * March — a work date five months in the past — on 19 of 100 cases in the corpus
 * study, and every one of the 19 was this single error: day and month right, year
 * the year of the email. Nothing anywhere states that a booking cannot be in the
 * past, so both the model and this parser satisfied "infer the year from
 * surrounding context" with the wrong answer.
 *
 * The rule is not "add a year" — it is "the FIRST occurrence of this day and month
 * that is not already well past", and it therefore works in both directions. An
 * email arriving 2 January about "28th December" means the December five days gone,
 * not the one eleven months out, and reading it as next December is the same class
 * of error in the opposite direction. Only one rule can be right for both, and this
 * is it.
 *
 * The grace period is where the two meet. Fourteen days is proposed rather than
 * measured: comfortably longer than any lag between a job and the email chasing it,
 * far shorter than the months of lead time a real forward booking carries. IT IS A
 * BUSINESS RULE AND BEN OWNS THE NUMBER; change it here and the tests in
 * test/dateYear.ts state exactly what moves.
 *
 * Applied ONLY where the year was not written down. An explicit year in the past is
 * a client deliberately referring to last year's job and is left alone.
 */
export const YEAR_ROLL_GRACE_DAYS = 14;

/** Whole days from `reference` to the ISO date — negative when it is in the past. */
function daysFrom(reference: Date, iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(
    reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()
  )) / 86400000);
}

/**
 * Roll a year-inferred date forward to its next occurrence. Returns the date
 * unchanged when it is not far enough in the past to be a mistake.
 *
 * Years, not one year: 29 February only occurs in a leap year, so a bare "29 Feb"
 * read against 2026 has to climb to 2028 rather than land on a day that does not
 * exist.
 */
export function nextOccurrence(
  month: number, day: number, reference: Date, graceDays = YEAR_ROLL_GRACE_DAYS
): string | null {
  // Start a year BEHIND the reference, so the rule works in both directions: an
  // email on 2 January saying "28th December" gets the December five days gone, not
  // the one eleven months out. Climbing to +8 costs nothing and covers 29 February,
  // which only exists every fourth year and would otherwise be dropped as an
  // impossible date rather than moved to a year that has one.
  const from = reference.getUTCFullYear() - 1;
  for (let y = from; y <= from + 8; y++) {
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const t = new Date(`${iso}T00:00:00Z`);
    if (t.getUTCDate() !== day || t.getUTCMonth() + 1 !== month) continue;
    if (daysFrom(reference, iso) >= -graceDays) return iso;
  }
  return null;
}

/** The same rule applied to a date somebody has already put a year on. */
export function rollYearForward(iso: string, reference: Date, graceDays = YEAR_ROLL_GRACE_DAYS): string {
  const [, mo, d] = iso.split("-").map(Number);
  return nextOccurrence(mo, d, reference, graceDays) ?? iso;
}

export interface ParsedDate {
  iso: string;
  /** The year was WRITTEN in the text. False means it was inferred and rolled. */
  yearStated: boolean;
}

/**
 * Dates, as YYYY-MM-DD. UK order throughout: 12/09 is 12 September, never 9 December —
 * this mailbox is a London crew supplier and every date in it is written day-first.
 *
 * `reference` is the message's own timestamp, not the clock: a thread swept from last
 * October must parse against October. Where the text writes no year, the date is the
 * NEXT occurrence from that reference, not the reference's own year — see
 * rollYearForward.
 */
export function parseDatesDetailed(text: string, reference: Date): ParsedDate[] {
  const out: ParsedDate[] = [];
  const refYear = reference.getUTCFullYear();
  const add = (y: number, mo: number, d: number, yearStated: boolean) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
    // The `,?` tolerance below lets a year-shaped 4-digit number ride in after a
    // comma or a month name - and this mailbox is full of those that are not years:
    // "12 October, 1000 guests", "5 June, 2500 pax", "3 May, 2000 sqm". A capture
    // outside a plausible calendar range is not a stated year; fall back to no year
    // stated so the date still resolves via next-occurrence instead of being
    // pinned to a bogus year or losing the roll.
    if (yearStated && (y < 2000 || y > 2100)) yearStated = false;
    let iso: string | null;
    if (yearStated) {
      iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      // Reject impossible days (31 February) by round-tripping.
      const probe = new Date(`${iso}T00:00:00Z`);
      if (probe.getUTCDate() !== d || probe.getUTCMonth() + 1 !== mo) return;
    } else {
      // The year is the ENGINE's when the client did not write one — and choosing
      // it is also what makes 29 February survive. Validity used to be checked
      // against the reference's own year, so a bare "29 Feb" read in 2026 was
      // rejected as an impossible date and the request lost its date entirely.
      iso = nextOccurrence(mo, d, reference);
      if (!iso) return;
    }
    if (!out.some((x) => x.iso === iso)) out.push({ iso, yearStated });
  };

  /**
   * Spans an earlier pattern has already claimed. Without this the day-first
   * pattern reads "03-08" out of the middle of "2027-03-08" and reports a second,
   * invented date — which is worse than useless, because reconcileRequests only
   * fills or challenges a request when the text yields EXACTLY ONE date, so an ISO
   * date in the email silently switched the whole date check off.
   */
  const claimed: Array<[number, number]> = [];
  const free = (m: RegExpMatchArray) => {
    const a = m.index ?? 0, b = a + m[0].length;
    if (claimed.some(([x, y]) => a < y && b > x)) return false;
    claimed.push([a, b]);
    return true;
  };

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (free(m)) add(+m[1], +m[2], +m[3], true);
  }

  // 12/09/2026, 12-09-26, 12.9.2026 — day first.
  for (const m of text.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/g)) {
    if (!free(m)) continue;
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : refYear;
    if (y < 100) y += 2000;
    // Guard the ambiguous pair: 09/12 with no year could be either order. Day-first is
    // the house rule, but a first number above 12 proves it, and that is worth keeping
    // separate from a guess — both are added as day-first, which is the stated rule.
    add(y, mo, d, !!m[3]);
  }

  // "12 September", "12th Sept 2026", "Sat 12 Sep"
  //
  // The year may trail a comma — "October 12, 2027" — which is not whitespace, so
  // without the optional `,?` the year is never captured and the date is treated
  // as bare even though the client wrote it. That silent miss, not just the set
  // arithmetic in bareMonthDays, is what let order 15611's dated summary line
  // lose its year.
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?/gi)) {
    if (!free(m)) continue;
    add(m[3] ? +m[3] : refYear, MONTHS[m[2].toLowerCase()], +m[1], !!m[3]);
  }
  // "September 12", "Sept 12th 2026"
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/gi)) {
    if (!free(m)) continue;
    add(m[3] ? +m[3] : refYear, MONTHS[m[1].toLowerCase()], +m[2], !!m[3]);
  }
  return out;
}

/** The dates alone, for callers that do not care how the year was arrived at. */
export function parseDates(text: string, reference: Date): string[] {
  return parseDatesDetailed(text, reference).map((d) => d.iso);
}

/**
 * The (month, day) pairs the text writes with NO year beside them.
 *
 * This is how the model's own dates get the same roll. The model returns
 * "2026-03-08" and nothing in that string says whether the client wrote the year;
 * the text does. A request date whose month and day appear here bare was inferred,
 * whoever inferred it, and is subject to the next-occurrence rule.
 */
export function bareMonthDays(text: string, reference: Date): Set<string> {
  const bare = new Set<string>();
  const stated = new Set<string>();
  for (const d of parseDatesDetailed(text, reference)) {
    (d.yearStated ? stated : bare).add(d.iso.slice(5));
  }
  /**
   * A MONTH-DAY WRITTEN WITH A YEAR ANYWHERE IS NOT BARE, WHEREVER ELSE IT APPEARS.
   *
   * Without this subtraction the set is per-OCCURRENCE, and a structured enquiry
   * states its dates twice: once in a summary line carrying the year, once in a
   * load-in or load-out sentence without it. The unyeared mention won, so the
   * next-occurrence rule overruled a year the client had written down - live on
   * order 15611, where "October 12, 2027" plus "07:00 AM on October 12th" booked
   * 2026, six weeks out, for a job that is a year later.
   *
   * The guarantee this restores is the one stated at the roll site: a client who
   * writes the year keeps it, in the past or not.
   */
  for (const md of stated) bare.delete(md);
  return bare;
}

// ---------------------------------------------------------------------------

export interface Reconciled {
  /** Fields the parser supplied that the model had left blank. */
  filled: string[];
  /** Where parser and model disagree — a reason for a human to look, not to overrule. */
  conflicts: string[];
  /** Dates whose YEAR the next-occurrence rule moved, and what they were. */
  rolled: string[];
}

export interface RequestLike {
  date?: string;
  start_time?: string;
  end_time?: string;
  size?: number;
  task?: string;
  profession_hint?: string;
}

/**
 * Fill blanks in the model's requests from the text, and report disagreements.
 *
 * Deliberately narrow: times are only filled when the text states EXACTLY ONE shift,
 * and a size only when the text names exactly one crew figure. Two candidates means the
 * text is describing several blocks, and choosing between them is the model's job — the
 * parser has no idea which block it is looking at.
 *
 * Mutates nothing: returns new requests.
 */
export function reconcileRequests(
  text: string,
  requests: RequestLike[],
  reference: Date
): { requests: RequestLike[]; report: Reconciled } {
  const report: Reconciled = { filled: [], conflicts: [], rolled: [] };
  const times = parseTimes(text);
  const crews = parseCrew(text);
  const dates = parseDates(text, reference);
  const bare = bareMonthDays(text, reference);

  const singleShift = times && times.start && times.end ? times : null;
  const out = requests.map((r, i) => {
    const next: RequestLike = { ...r };

    /**
     * THE YEAR IS THE ENGINE'S, NOT THE MODEL'S — the one place this file overrules
     * rather than reports, and it is narrow on purpose. It never touches the day or
     * the month the model read; it applies the next-occurrence rule to a year that
     * was never written down, and it only fires where the TEXT shows that day and
     * month bare. A client who wrote "8 March 2026" keeps 2026, in the past or not.
     *
     * Reporting was not enough. `prompts.ts` tells the model to infer the year from
     * surrounding context, and the surrounding context is the email's own date, so
     * 19 of 100 corpus cases were booked in a month five months gone and the note
     * would have said "DISAGREEMENT" on a thread nobody was reading. A rule that
     * can be stated in code is not a thing to leave to a prompt.
     */
    if (next.date && bare.has(next.date.slice(5))) {
      const [, mo, d] = next.date.split("-").map(Number);
      const settled = nextOccurrence(mo, d, reference);
      if (settled && settled !== next.date) {
        report.rolled.push(`requests[${i}].date ${next.date} -> ${settled} (no year was written; read as the next occurrence)`);
        next.date = settled;
      }
    }

    if (singleShift && requests.length === 1) {
      if (!next.start_time) { next.start_time = singleShift.start; report.filled.push(`requests[${i}].start_time`); }
      else if (next.start_time !== singleShift.start) report.conflicts.push(`requests[${i}].start_time: model ${next.start_time}, text ${singleShift.start}`);
      if (!next.end_time) { next.end_time = singleShift.end; report.filled.push(`requests[${i}].end_time`); }
      else if (next.end_time !== singleShift.end) report.conflicts.push(`requests[${i}].end_time: model ${next.end_time}, text ${singleShift.end}`);
    }

    if (crews.length === 1 && requests.length === 1) {
      if (!next.size) { next.size = crews[0].size; report.filled.push(`requests[${i}].size`); }
      else if (next.size !== crews[0].size) report.conflicts.push(`requests[${i}].size: model ${next.size}, text ${crews[0].size}`);
      if (!next.profession_hint && crews[0].hint) { next.profession_hint = crews[0].hint; report.filled.push(`requests[${i}].profession_hint`); }
    }

    if (dates.length === 1 && requests.length === 1) {
      if (!next.date) { next.date = dates[0]; report.filled.push(`requests[${i}].date`); }
      else if (next.date !== dates[0]) report.conflicts.push(`requests[${i}].date: model ${next.date}, text ${dates[0]}`);
    }

    return next;
  });

  // The model found nothing, but the text plainly states a job. This is the recovery
  // case the study measured: threads carrying a date AND a crew size that were thrown
  // away. One block only — anything more structured is the model's to read.
  if (!requests.length && crews.length === 1 && dates.length === 1) {
    out.push({
      date: dates[0],
      size: crews[0].size,
      ...(crews[0].hint ? { profession_hint: crews[0].hint } : {}),
      ...(times?.start ? { start_time: times.start } : {}),
      ...(times?.end ? { end_time: times.end } : {}),
    });
    report.filled.push("requests[0] (recovered from text — the model returned none)");
  }

  return { requests: out, report };
}
