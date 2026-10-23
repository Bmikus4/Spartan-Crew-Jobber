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
  /** R numbers ("R11549", "order 11549") the client wrote in the newest words, without the R. */
  r: string[];
  /** J numbers (OnSinch job ids) the client wrote in the newest words, without the J. */
  j: string[];
  /**
   * R and J numbers in the subject only. Kept apart: a subject is usually our own quote's ("Price
   * quote - R10931 ...") carried on every reply, so it names the thread's first job, not
   * necessarily this email's (Wall to Wall, 10 Sep: R10931 in the subject, R10909 in the words).
   */
  subjectR: string[];
  subjectJ: string[];
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
 * An HTML body as text, cut at its first quoted part: Apple Mail's <blockquote>, Gmail's
 * gmail_quote, Outlook's reply block. 131 of 3,514 client bodies are HTML (gold set, 23 Oct) and
 * line-based quote cutting never sees inside them: Harbour Scenic's quoted R10950 read as new.
 */
export function htmlText(body: string): string {
  if (!/<(html|body|div|br|p|table|span)[\s>/]/i.test(body.slice(0, 4000))) return body;
  let h = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const cut = h.search(/<blockquote|<div[^>]*class=["']?[^"'>]*\b(gmail_quote|moz-cite-prefix|yahoo_quoted)|<div[^>]*id=["']?(appendonsend|divRplyFwdMsg)/i);
  if (cut > 0) h = h.slice(0, cut);
  return h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/**
 * The client's own newest words. latestText stops at a quote header written on one line; Gmail
 * often breaks "On Tue, 21 Jul 2026 at 15:16, Bookings Spartan Crew <" over two, and the whole
 * quoted email then read as new: its "Tue" and "21 Jul" became days the client asked for (We
 * Are Family, 3 Aug, gold set). The signature after a "--" line and links carry no request.
 */
export function newestWords(body: unknown): string {
  const lines = latestText(htmlText(String(body ?? ""))).split("\n");
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
  const inWords = refsIn(newest), head = refsIn(subj);
  return {
    newest,
    subject: subj,
    ...refsIn(words),
    r: inWords.r,
    j: inWords.j,
    subjectR: head.r.filter((x) => !inWords.r.includes(x)),
    subjectJ: head.j.filter((x) => !inWords.j.includes(x)),
    days: daysIn(words, sentIso),
    times: [...timesIn(newest)].sort(),
    counts: [...countsIn(newest)].sort((a, b) => a - b),
  };
}

/** A code as an order's PO or name holds it, for exact comparison: case, spaces, dashes and leading zeros do not count. */
export const codeKey = (s: unknown) => String(s ?? "").toUpperCase().replace(/[\s-]+/g, "").replace(/^0+(?=\d)/, "");
