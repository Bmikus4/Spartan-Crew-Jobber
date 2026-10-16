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

export const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

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
  // Wraps both ways: "an hour earlier" on a 00:30 call is 23:30, never "-1:-30".
  const t = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// --- crew counts -------------------------------------------------------------------

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/**
 * One person written as a word: "a carpenter", "someone to assist". Measured 10-11: Wall to
 * Wall's "add a carpenter" and ILEC's "I require someone" were both refused for having no
 * digit. "a crew" is a team of unknown size and "a couple" or "a few" are not numbers, so
 * "a"/"an" count only before a word for ONE person. "him"/"her" never count: "add him as a
 * third person if he's available" (We Are Family, 10-09) names one person, on a condition,
 * and read as +1 it wrote 4 crew and a chief over the 3 ops booked.
 */
const PERSON = "(?:person|man|guy|lad|chap|carpenter|chippie|joiner|driver|tech|technician|operator|labourer|rigger|hand|crew ?member|crew ?chief|chief|steward|electrician|engineer)";
export function oneIn(raw: string): boolean {
  const q = norm(raw);
  return new RegExp(`(?:^|\\b(?:add|need|require|book|get|want|and|plus|also)\\s+)(?:someone|somebody|(?:a|an|one|1)\\s+(?:extra\\s+|more\\s+|additional\\s+|other\\s+)?${PERSON}s?\\b)`).test(q) && !/\b(couple|few)\b/.test(q);
}

/** The number in an increase or decrease ("add 2", "another 3", "add a carpenter", "stand down one"). */
export function amountIn(raw: string): number | null {
  const q = norm(raw);
  const d = /(\d{1,3})/.exec(q);
  if (d) return Number(d[1]) || null;
  const w = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.exec(q);
  if (w) return WORDS[w[1]];
  // "add him as a third person" (We Are Family 10-09; ops added one) is one more person.
  return oneIn(q) || /\b(add|stand down|release|remove|drop)\s+(?:someone|somebody|him|her)\b/.test(q) ? 1 : null;
}

/** "3 x Crew", "x3", "X2 Crew", "2 crew", "4 x 2hr crew", "6x2hr", "four crew" -> 3/3/2/2/4/6/4. */
export function parseCount(raw: string): number | null {
  // "another 3 crew" on a new shift is that shift's 3 (Bearded Kitten, 10-09).
  const q = norm(raw).replace(/^(?:another|an extra|extra|additional)\s+(?=\d|one|two|three|four|five|six|seven|eight|nine|ten)/, "");
  if (oneIn(q) && !/\d/.test(q)) return 1;
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

/**
 * The day a request is FOR. "shift the Wednesday 14th de-rig shift to Tuesday 13th" names two
 * days; the one after "to" is the new day and the other is the shift's (its target). Measured
 * 10-11 (The Events House): read as the first day, it was refused as 14th, not 13th. Only a
 * moving verb splits the quote: "12th to 14th" alone is a range and stays unread.
 */
export function parseNewDate(raw: string, sentIso: string): string | null {
  const q = norm(raw);
  const m = /\b(?:move|moving|moved|shift|shifting|change|changing|bring|bringing|push|pushing|swap|swapping|pull|pulling)\b[\s\S]*\bto\s+([\s\S]+)$/.exec(q);
  if (m) { const to = parseDate(m[1], sentIso); if (to) return to; }
  return parseDate(raw, sentIso);
}

/**
 * The one date a SUBJECT carries ("Crew availability 13/10", "J46464 - 14/10/26 @ Roundhouse"),
 * or null when it has none or several. A reply that names no day is about its subject's day:
 * Encore's "2 x crew also for 2 hours at 21:30" and "change the evening call" (10-09, 10-11)
 * were both refused for "no day", under the subject "Crew availability 13/10".
 */
export function subjectDate(subject: string, sentIso: string): string | null {
  const s = norm(subject).replace(/^((re|fw|fwd)\s*:\s*)+/g, "");
  // "today"/"tomorrow" in a subject count from the day the SUBJECT was first written, which a
  // reply's sent date does not give, so a subject carrying one has no date here.
  if (/\b(today|tonight|tomorrow)\b/.test(s)) return null;
  const tokens = s.match(/\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b|\b\d{1,2}(?:st|nd|rd|th)\b(?:\s+(?:of\s+)?[a-z]{3,9})?/g) ?? [];
  if (tokens.length !== 1) return null;
  return parseDate(tokens[0], sentIso);
}

export function parseDate(raw: string, sentIso: string): string | null {
  const q = norm(raw).replace(/,/g, " ");
  const sentDay = londonDay(sentIso);
  // "next Friday": the first such day AFTER the sent day. Bearded Kitten wrote it on Fri 9 Oct
  // and again on Mon 12 Oct, both for Fri 16 Oct, which ops booked (R11507).
  const nx = /^(?:on\s+)?next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.exec(q.trim());
  if (nx) {
    const sent = new Date(sentDay + "T12:00:00Z").getUTCDay();
    const want = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(nx[1]);
    const ahead = ((want - sent + 7) % 7) || 7;
    return new Date(Date.parse(sentDay + "T12:00:00Z") + ahead * 864e5).toISOString().slice(0, 10);
  }
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
  // A year is 2020-2099, or two digits that are not the start of a time: '2 Nov 0900' read the
  // 24-hour time as the year 900 (O Films, 10-15) and '2 Nov 09:00' as 2009. All three forms.
  let m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}(?![:.]\d)|20[2-9]\d))?\b/.exec(q);
  if (m) {
    d = Number(m[1]); mo = Number(m[2]) - 1; if (m[3]) y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  } else {
    m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b(?:\s+'?(\d{2}(?![:.]\d)|20[2-9]\d)\b)?/.exec(q);
    let mi = m ? MONTHS.indexOf(m[2].slice(0, 3)) : -1;
    // "November 4th", "October 8 2026": month first. Read before the bare "4th" fallback,
    // which would otherwise take the day and put it in the sent month (measured 10-08).
    const mf = mi < 0 ? /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s+(20[2-9]\d)\b)?/.exec(q) : null;
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

// --- every value a quote can give --------------------------------------------------
// A quote is often wider than one token: "4 - 6pm", "10-2", "Now 4x 4hr 11:00", "2x2hr at
// 16:30". Requiring the whole quote to parse to the one value refused all of them though the
// model read each right (9-13 Oct, measured against what ops then booked). A value is grounded
// when THIS code finds it among the values the quoted words hold; it is never taken on trust.

const hm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** Every time the words hold, a range's two ends included ("4 - 6pm" -> 16:00, 18:00; "10-2" -> 10:00, 14:00). */
export function timesIn(raw: string): Set<string> {
  const q = norm(raw);
  const out = new Set<string>();
  const one = parseTime(raw);
  if (one) out.add(one);
  const range = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|to|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/g;
  for (const m of q.matchAll(range)) {
    let a = Number(m[1]), b = Number(m[4]);
    const am = Number(m[2] ?? 0), bm = Number(m[5] ?? 0);
    if (a > 23 || b > 23 || am > 59 || bm > 59) continue;
    const sa = m[3], sb = m[6];
    if (sb === "pm" && b < 12) b += 12;
    if (sa === "pm" && a < 12) a += 12;
    // "4 - 6pm": the suffix covers both ends when the first is earlier on the same clock.
    if (!sa && sb === "pm" && a < 12 && a + 12 < b + (b < 12 ? 12 : 0) + 1) a += 12;
    // "10-2" with no suffix: a day shift crossing noon.
    if (!sa && !sb && b < a && b < 12 && a <= 12) b += 12;
    if (a <= 23 && b <= 23) { out.add(hm(a, am)); out.add(hm(b, bm)); }
  }
  for (const tok of q.split(/[\s,;()/]+|(?<=\d)-(?=\d)/)) { const t = parseTime(tok); if (t) out.add(t); }
  return out;
}

const WORD_N = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
/** Every crew count the words hold ("Now 4x 4hr 11:00" -> 4; "at least two bodies" -> 2). */
export function countsIn(raw: string): Set<number> {
  const q = norm(raw);
  const out = new Set<number>();
  const one = parseCount(raw);
  if (one) out.add(one);
  if (oneIn(q)) out.add(1);
  for (const m of q.matchAll(/\b(\d{1,3})\s*x\b|\bx\s*(\d{1,3})\b|\b(\d{1,3})\s*x(?=\s*\d)/g)) out.add(Number(m[1] ?? m[2] ?? m[3]));
  const who = "(?:crew|staff|people|persons?|bodies|hands|guys|men|lads|helpers|labourers|stagehands|riggers|carpenters?|drivers?|techs?|technicians?|stewards?|workers?)";
  for (const m of q.matchAll(new RegExp(String.raw`\b(\d{1,3}|${WORD_N})\s+(?:x\s+)?(?:more\s+|extra\s+|additional\s+)?(?:local\s+|general\s+)?${who}\b`, "g"))) out.add(/\d/.test(m[1]) ? Number(m[1]) : WORDS[m[1]]);
  for (const m of q.matchAll(new RegExp(String.raw`\bat least\s+(\d{1,3}|${WORD_N})\b`, "g"))) out.add(/\d/.test(m[1]) ? Number(m[1]) : WORDS[m[1]]);
  if (/\b(?:man|driver) and (?:a )?van\b|\bvan and (?:a )?(?:driver|man)\b/.test(q)) out.add(1);
  out.delete(0);
  return out;
}

/** Every length the words hold, in minutes ("2x2hr" -> 120; a bare "6" in an hours field -> 360). */
export function durationsIn(raw: string): Set<number> {
  const q = norm(raw);
  const out = new Set<number>();
  const one = parseDuration(raw);
  if (one) out.add(one);
  for (const m of q.matchAll(/(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|h)\b/g)) { const n = Math.round(Number(m[1]) * 60); if (n > 0 && n <= 1440) out.add(n); }
  // A range is a length too: "3:30pm - 4:30pm" is an hour, "0600 - 1000" four (10-12/13).
  const ts = [...timesIn(raw)];
  if (ts.length === 2) { const [a, b] = ts.map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3))); const d = (b - a + 1440) % 1440; if (d > 0) out.add(d); }
  // "a half shift" / "half day": Spartan's 4-hour call (Bearded Kitten R11507, booked 4 hours).
  if (/\bhalf (?:a )?(?:shift|day)\b/.test(q)) out.add(240);
  const bare = /^(\d{1,2}(?:\.\d)?)$/.exec(q);
  if (bare) { const n = Math.round(Number(bare[1]) * 60); if (n > 0 && n <= 1440) out.add(n); }
  return out;
}

/** Every day the words name: a date token or a weekday ("the Monday shift 08:00-12:00" -> that Monday). */
export function datesIn(raw: string, sentIso: string): Set<string> {
  const out = new Set<string>();
  const one = parseDate(raw, sentIso);
  if (one) out.add(one);
  const q = norm(raw);
  for (const m of q.matchAll(/\b(mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b(?:\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?:\s+[a-z]{3,9})?)?/g)) { const d = parseDate(m[0], sentIso); if (d) out.add(d); }
  for (const m of q.matchAll(/\b\d{1,2}(?:st|nd|rd|th)?(?:[/.]\d{1,2}(?:[/.]\d{2,4})?|\s+(?:of\s+)?[a-z]{3,9}(?:\s+\d{2,4})?)\b/g)) { const d = parseDate(m[0].replace(/\bof\s+/, ""), sentIso); if (d) out.add(d); }
  return out;
}
