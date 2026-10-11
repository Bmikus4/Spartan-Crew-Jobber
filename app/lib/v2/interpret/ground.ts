// ============================================================================
// Grounding: every day, time and crew count the system writes must be READ by this code
// from words the client wrote. A model proposes a value and the words it took it from; the
// words must appear in the email, and parsing them here must give the same value. If either
// fails the value does not exist, and the request is "unclear": no write.
//
// Ben, 10-06: "Never infer from history unless explicitly requested and the job can be
// found." and a vague request "shouldn't do anything". These parsers therefore accept only
// the shapes clients were measured writing (fixtures in test/v2Ground.ts) and return null on
// anything else, rather than guessing.
// ============================================================================

/** The newest part of an email: quoted history and forwarded headers below it are dropped. */
export function latestText(body: string): string {
  const lines = body.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^>/.test(t)) break;
    if (/^On .{4,120}wrote:?$/i.test(t)) break;
    if (/^-{2,}\s*(Original|Forwarded) Message/i.test(t)) break;
    if (/^From:\s.+/i.test(t) && out.some((l) => l.trim())) break;
    if (/^_{8,}$/.test(t)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

/** Does the quote appear in the text, ignoring case, spacing and dash/quote styles? */
export function quoteIn(text: string, quote: string | null | undefined): boolean {
  if (!quote || norm(quote).length < 1) return false;
  return norm(text).includes(norm(quote));
}

// --- times ---------------------------------------------------------------------

/**
 * "9.30am", "15:30pm" (a 24h time with a redundant suffix), "8AM", "midday", "noon",
 * "1800", "18:30hrs", "7pm", "0830" -> "HH:MM". Null for anything else ("TBC", "evening").
 */
export function parseTime(raw: string): string | null {
  // "@ 18:30", "starting midday", "from 9am": the lead-in word carries no time (measured 10-09).
  const q = norm(raw).replace(/\s+/g, "").replace(/^(@|at|from|starting(at|from)?|start(ing)?(at)?)(?=\d|mid|noon)/, "");
  if (/^(midday|noon|12noon)$/.test(q)) return "12:00";
  if (q === "midnight") return "00:00";
  // "0800 AM" (Wall to Wall, 10-09) as well as "9.30am".
  let m = /^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm)$/.exec(q);
  if (m) {
    let h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h > 23 || mi > 59) return null;
    if (h <= 12) {
      if (m[3] === "pm" && h !== 12) h += 12;
      if (m[3] === "am" && h === 12) h = 0;
    }
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  m = /^(\d{1,2})[:.](\d{2})(?:hrs?|h)?$/.exec(q);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) return `${m[1].padStart(2, "0")}:${m[2]}`;
  m = /^(\d{2})(\d{2})(?:hrs?|h)?$/.exec(q);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) return `${m[1]}:${m[2]}`;
  return null;
}

// --- durations -------------------------------------------------------------------

/** "3hr call", "4hrs", "2-hour", "6 hours", "2.5 hrs" -> minutes. */
export function parseDuration(raw: string): number | null {
  // Booking forms put the label first: "Call hours: 4" (EMS, measured 10-09).
  const m = /(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|h)\b/.exec(norm(raw)) ?? /\b(?:call\s+)?(?:hours|hrs)\s*[:\-]\s*(\d+(?:\.\d+)?)\b/.exec(norm(raw));
  if (!m) return null;
  const mins = Math.round(Number(m[1]) * 60);
  return mins > 0 && mins <= 24 * 60 ? mins : null;
}

export function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// --- crew counts -------------------------------------------------------------------

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** "3 x Crew", "x3", "X2 Crew", "2 crew", "4 x 2hr crew", "6x2hr", "four crew" -> 3/3/2/2/4/6/4. */
export function parseCount(raw: string): number | null {
  const q = norm(raw);
  // "No. of crew: 3", "Crew required: 4", "Crew Size: 2": a booking form's labelled field
  // (EMS and Wall to Wall, measured 10-09). "6x2hr" is six crew for two hours (Event Concept).
  let m = /^x\s*(\d{1,3})\b/.exec(q) ?? /\b(\d{1,3})\s*x(?:\b|(?=\s*\d+(?:\.\d+)?\s*(?:hours?|hrs?|h)\b))/.exec(q) ?? /^(\d{1,3})\b/.exec(q)
    ?? /^(?:no\.?\s*of|number\s+of)?\s*(?:crew|staff|hands)\s*(?:required|needed|size)?\s*[:\-]\s*(\d{1,3})\b/.exec(q)
    // "increase to 5 crew", "make it 6", "take it up to 4": a total after its verb (harness,
    // 10-11: the model quoted "increase to 5 crew" in 6 of 10 such emails, all refused before).
    ?? /^(?:increase|increasing|go|going|bump|bumping|up|make|making|take|taking|change|changing|raise|raising)\s+(?:it\s+|us\s+|that\s+)?(?:up\s+)?to\s+(\d{1,3})\b/.exec(q)
    ?? /^(?:make|making)\s+it\s+(\d{1,3})\b/.exec(q);
  if (m) { const n = Number(m[1]); return n > 0 && n <= 200 ? n : null; }
  m = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.exec(q);
  return m ? WORDS[m[1]] : null;
}

// --- dates ------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A client's date, resolved against the day the email was SENT (never "today"):
 * "17th September", "13th Oct", "Thursday 8th October 26", "14/10", "10/10/2026", "30th",
 * "Friday 9th". No year written: the first such day on or after the sent date (a date up to
 * 7 days before it is read as that recent past day, e.g. a late-arriving confirmation).
 * A weekday that contradicts the date is null: one of the two is wrong and neither is chosen.
 */
/** The day an email was sent, in London: 23:30 UTC in summer is already tomorrow there. */
export function londonDay(sentIso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(sentIso));
}

/**
 * A PO is a single reference written straight after a PO label: "PO 48963", "Job code -
 * FH0730", "ref:2871". Measured 10-09: "find attached PO for Legal Geek - Truman Brewery
 * 12/10/26" names an event, and "Price quote - R11221" is Spartan's own order number.
 */
export function poAfterLabel(text: string, value: string): boolean {
  if (!/^[a-z0-9][a-z0-9\-\/_.]*$/i.test(value) || !/\d/.test(value)) return false;
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const label = "(p\\.?o\\.?|purchase order|job (code|no\\.?|number|ref)|ref(erence)?)";
  // Measured 10-09, each set by ops by hand: "PO number is EAV6274", "UKPO26-13426 Will be the
  // PO number", "attached PO-UK000018983" (the reference carries its own label).
  return new RegExp(`\\b${label}\\s*(number|no\\.?)?\\s*(is|will be|=)?\\s*[:#\\-]?\\s*${esc}(?![a-z0-9])`, "i").test(text)
    || new RegExp(`(?<![a-z0-9])${esc}\\s*(is|will be)\\s+(the|our)\\s+${label}\\b`, "i").test(text)
    // "The PO for R40012 is 37463": the label, the order it is for, then the reference
    // (harness, 10-11: dropped before, 6 of 15 PO emails).
    || new RegExp(`\\b${label}\\s*(number|no\\.?)?\\s+for\\s+(job\\s+|order\\s+)?#?[a-z]{0,3}\\d{3,6}\\s*(is|will be|=|:)\\s*${esc}(?![a-z0-9])`, "i").test(text)
    || (/^p\.?o[-#]?\d|^p\.?o-[a-z]/i.test(value) && new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i").test(text));
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** A weekday's first three letters, from a whole weekday word only: "Monsoon at Christie's" is not a Monday. */
const weekdayIn = (q: string): string | null =>
  /\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/.exec(q)?.[1].slice(0, 3) ?? null;

/**
 * A weekday with no date, "Monday" or "the Tuesday shift": the first such day after the sent
 * day. Measured 10-09: four bookable changes in one day were written this way and ops made
 * each one. Refused when it could be either of two days: the sent day's own weekday (today, or
 * a week today), and "next Friday" (this coming one, or the one after, in British use).
 */
function weekdayAlone(q: string, weekday: string, sent: Date): string | null {
  if (/\d/.test(q) || /\b(next|last|following|previous)\b/.test(q)) return null;
  const gap = (WEEKDAYS.indexOf(weekday) - sent.getUTCDay() + 7) % 7;
  return gap === 0 ? null : new Date(sent.getTime() + gap * 864e5).toISOString().slice(0, 10);
}

export function parseDate(raw: string, sentIso: string): string | null {
  const q = norm(raw).replace(/,/g, " ");
  const sentDay = londonDay(sentIso);
  // "today" / "tomorrow" are the client's own words counted from the day they sent them.
  // Anything else in the same quote must agree, or the date does not exist.
  const rel = /\b(today|tonight|tomorrow)\b/.exec(q);
  if (rel) {
    const day = new Date(Date.parse(sentDay + "T12:00:00Z") + (rel[1] === "tomorrow" ? 864e5 : 0));
    const iso = day.toISOString().slice(0, 10);
    const rest = q.replace(rel[0], " ");
    const wd = weekdayIn(rest);
    if (wd && ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][day.getUTCDay()] !== wd) return null;
    if (/\d/.test(rest.replace(/\b\d{1,2}([:.]\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/g, ""))) {
      const other = parseDate(rest, sentIso);
      if (other !== iso) return null;
    }
    return iso;
  }
  const sent = new Date(sentDay + "T12:00:00Z");
  const weekday = weekdayIn(q);
  let d: number, mo: number | null = null, y: number | null = null;
  let m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?\b/.exec(q);
  if (m) {
    d = Number(m[1]); mo = Number(m[2]) - 1; if (m[3]) y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  } else {
    m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b(?:\s+'?(\d{2}|\d{4})\b)?/.exec(q);
    let mi = m ? MONTHS.indexOf(m[2].slice(0, 3)) : -1;
    // "November 4th", "October 8 2026": month first. Read before the bare "4th" fallback,
    // which would otherwise take the day and put it in the sent month (measured 10-08).
    const mf = mi < 0 ? /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s+(\d{4})\b)?/.exec(q) : null;
    const mfi = mf ? MONTHS.indexOf(mf[1].slice(0, 3)) : -1;
    if (m && mi >= 0) {
      d = Number(m[1]); mo = mi; if (m[3]) y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    } else if (mf && mfi >= 0) {
      d = Number(mf[2]); mo = mfi; if (mf[3]) y = Number(mf[3]);
    } else {
      m = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(q);
      if (!m) return weekday ? weekdayAlone(q, weekday, sent) : null;
      d = Number(m[1]);
    }
  }
  if (d < 1 || d > 31 || (mo !== null && (mo < 0 || mo > 11))) return null;
  const candidates: Date[] = [];
  const y0 = sent.getUTCFullYear();
  for (const yy of y !== null ? [y] : [y0, y0 + 1]) {
    for (const mm of mo !== null ? [mo] : [sent.getUTCMonth(), sent.getUTCMonth() + 1]) {
      const c = new Date(Date.UTC(yy, mm, d, 12));
      if (c.getUTCDate() === d) candidates.push(c);
    }
  }
  const floor = sent.getTime() - 7 * 864e5;
  const dayName = (c: Date) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][c.getUTCDay()];
  const open = y !== null ? candidates.slice(0, 1) : candidates.filter((c) => c.getTime() >= floor).sort((a, b) => a.getTime() - b.getTime());
  // A weekday written with a bare day picks between the months it could be: "Monday the
  // 16th" sent on Friday 23 October is 16 November, not the 16 October a week before. With no
  // candidate on that weekday, the words contradict each other and there is no date.
  const pick = weekday ? open.find((c) => dayName(c) === weekday) : open[0];
  if (!pick) return null;
  return pick.toISOString().slice(0, 10);
}
