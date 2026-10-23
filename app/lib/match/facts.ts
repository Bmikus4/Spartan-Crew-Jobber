// ============================================================================
// What an email's own words give the matcher, read by code: its newest words, the references
// it writes (R and J numbers, PO and job codes), postcodes, and the days, times and counts the
// grounding check already reads (ground.ts). No model: the reader's values arrive separately
// and win where present; these are what a link can still be judged on without one.
// ============================================================================
import { latestText, datesIn, timesIn, countsIn, parseDate } from "../v2/interpret/ground";

export type Facts = {
  newest: string;
  subject: string;
  /** R numbers ("R11549", "order 11549"), without the R. */
  r: string[];
  /** J numbers (OnSinch job ids), without the J. */
  j: string[];
  /** PO and job codes: tokens of 4 or more characters holding 3 or more digits, upper-cased. */
  codes: string[];
  /** UK postcodes, "SW1X 7LA". */
  postcodes: string[];
  days: string[];
  times: string[];
  counts: number[];
};

const R_RE = /\b(?:R|order\s*(?:no\.?|number|#)?\s*)[\s#:-]?(1\d{4})\b/gi;
const J_RE = /\bJ[\s#:-]?(1\d{4,5})\b/g;
const CODE_RE = /\b(?=[A-Z0-9-]*\d{3})[A-Z0-9][A-Z0-9-]{3,}\b/gi;
const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;

/** "Re: Fwd: Crew" -> "Crew". */
export const bareSubject = (s: unknown) => String(s ?? "").replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/gi, "").trim();

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** References and postcodes anywhere in a text, quoted history included. */
export function refsIn(text: string): Pick<Facts, "r" | "j" | "codes" | "postcodes"> {
  return {
    r: uniq([...text.matchAll(R_RE)].map((m) => m[1])),
    j: uniq([...text.matchAll(J_RE)].map((m) => m[1])),
    codes: uniq([...text.matchAll(CODE_RE)].map((m) => m[0].toUpperCase().replace(/-+$/, ""))),
    postcodes: uniq([...text.matchAll(POSTCODE_RE)].map((m) => `${m[1]} ${m[2]}`.toUpperCase())),
  };
}

/**
 * The client's own newest words. latestText stops at a quote header written on one line; Gmail
 * often breaks "On Tue, 21 Jul 2026 at 15:16, Bookings Spartan Crew <" over two, and the whole
 * quoted email then read as new: its "Tue" and "21 Jul" became days the client asked for (We
 * Are Family, 3 Aug, gold set). The signature after a "--" line and links carry no request.
 */
export function newestWords(body: unknown): string {
  const lines = latestText(String(body ?? "")).split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim().replace(/^\*+/, "");
    if (/^On\s/i.test(t) && /^On\s.{4,240}\swrote:?\*?$/i.test(`${t} ${(lines[i + 1] ?? "").trim()}`)) break;
    if (/^(Sent from my|Get Outlook for)\b/i.test(t) || /^--\s*$/.test(t)) break;
    out.push(lines[i]);
  }
  return out.join("\n").replace(/<https?:[^>]*>|https?:\/\/\S+/g, " ").trim();
}

const MONTH_WORD = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/;

/**
 * Every day the words name: what the grounding check reads (datesIn), a bare "on 10th", and each
 * day of a range in one month ("11th-16th October", "Aug 3rd-7th"), at most 14 days.
 */
export function daysIn(text: string, sentIso: string): string[] {
  const out = new Set(datesIn(text, sentIso));
  const q = text.toLowerCase();
  for (const m of q.matchAll(/\b\d{1,2}(?:st|nd|rd|th)\b/g)) { const d = parseDate(m[0], sentIso); if (d) out.add(d); }
  const ranges = [
    ...[...q.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/g)].map((m) => [m[1], m[2], m[3]]),
    ...[...q.matchAll(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?:st|nd|rd|th)?\b/g)].map((m) => [m[2], m[3], m[1]]),
  ];
  for (const [a, b, mon] of ranges) {
    if (!MONTH_WORD.test(mon)) continue;
    const lo = Number(a), hi = Number(b);
    if (!(hi > lo && hi - lo <= 14)) continue;
    for (let d = lo; d <= hi; d++) { const day = parseDate(`${d} ${mon}`, sentIso); if (day) out.add(day); }
  }
  return [...out].sort();
}

export function factsOf(subject: unknown, body: unknown, sentIso: string): Facts {
  const newest = newestWords(body);
  const subj = bareSubject(subject);
  const words = `${subj}\n${newest}`;
  return {
    newest,
    subject: subj,
    ...refsIn(words),
    days: daysIn(words, sentIso),
    times: [...timesIn(newest)].sort(),
    counts: [...countsIn(newest)].sort((a, b) => a - b),
  };
}

/** A code as an order's PO or name holds it, for exact comparison: case, spaces, dashes and leading zeros do not count. */
export const codeKey = (s: unknown) => String(s ?? "").toUpperCase().replace(/[\s-]+/g, "").replace(/^0+(?=\d)/, "");
