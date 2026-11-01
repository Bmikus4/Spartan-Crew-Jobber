// ============================================================================
// The language layer (ADDENDUM §14.5): the forms a client writes each fact in, and the mail around them, weighted
// by counts of the production reader's quotes of 1,088 client emails since 9 Oct (.tmp-v2/langshapes.ts; shapes
// counted, no text copied: harness/DATA_POLICY.md). Every function returns the exact words it wrote, so the oracle's
// quote is always in the email and the expected answer stays exact whatever the wording.
//
// It draws from its own stream (setLanguage), never the case's: a case's job is the same in plain and rich words, so
// a failure that appears only in rich words is the wording's.
// ============================================================================
import { pick, int, weighted, rng, type Place, type Rng } from "./grammar";

let L: Rng = rng(1);
let rich = true;
// A client keeps one way of writing a date, a time and a crew count through an email, and one set of words for a
// venue: the form is drawn once per case and kept (a form that cannot be used for a given day is drawn afresh).
let styles = new Map<string, number>();
const venues = new Map<number, string>();
/** `seed`: the case's; `on`: false keeps the plain templates (the baseline the rich words are compared with). */
export function setLanguage(seed: number, on: boolean) { L = rng(seed ^ 0x5eed1a); rich = on; styles = new Map(); venues.clear(); }
/** The case's form for `key`: drawn by weight once, then kept; 15% of clients mix their forms. */
function styled<T>(key: string, table: ReadonlyArray<readonly [T, number]>): T {
  const r = L;
  if (styles.has(key) && r() > 0.15) return table[styles.get(key)!][0];
  const total = table.reduce((a, [, w]) => a + w, 0);
  let x = r() * total, k = 0;
  for (; k < table.length - 1 && (x -= table[k][1]) >= 0; k++);
  if (!styles.has(key)) styles.set(key, k);
  return table[k][0];
}
export const isRich = () => rich;

const DAY = 864e5;
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const pad = (n: number) => String(n).padStart(2, "0");

// ---- a day ---------------------------------------------------------------------------------------------------
/**
 * Measured (636 date quotes): weekday + day + month 26%, day + month 26%, dd/mm/yy 16%, today or tomorrow 9%,
 * weekday + day 5%, dd/mm 4%, the weekday alone 3%, a bare day 2%, month first 1%. "next Friday" (1%) is left out:
 * in British use it is this coming Friday or the one after, and ground.ts and the pick check read it two ways.
 * A range ("16th-18th", 2%) is left out until a ruling says how a range of days is read.
 */
export function sayDay(day: string, today: string): string {
  const r = L;
  const d = new Date(`${day}T12:00:00Z`), t = new Date(`${today}T12:00:00Z`);
  const ahead = Math.round((d.getTime() - t.getTime()) / DAY);
  const wd = WD[d.getUTCDay()], n = d.getUTCDate(), mi = d.getUTCMonth(), m = MO[mi], y = d.getUTCFullYear();
  if (y !== t.getUTCFullYear()) return pick(r, [`${n} ${m.slice(0, 3)} ${y}`, `${pad(n)}/${pad(mi + 1)}/${y}`, `${wd} ${ord(n)} ${m} ${y}`]);
  // A short form is written only when it fits one day, as a reader counts from the sent day: a bare "the 9th" is
  // the first 9th on or after it this month or next (one up to 7 days back is that recent day); "Thursday 11th" is
  // the first month from the sent one whose 11th is a Thursday. Otherwise a client would have written the month.
  const td = t.getUTCDate(), tm = t.getUTCMonth();
  const bareOk = ahead >= 1 && ((mi === tm && n >= td) || (mi === (tm + 1) % 12 && n < td - 7));
  const wdOk = (() => {
    for (let k = 0; k < 12; k++) {
      const c = new Date(Date.UTC(y, tm + k, n, 12));
      if (c.getUTCDate() !== n || c.getTime() < t.getTime() - 7 * DAY) continue;
      if (c.getUTCDay() === d.getUTCDay()) return c.toISOString().slice(0, 10) === day;
    }
    return false;
  })();
  const forms: Array<readonly [() => string | null, number]> = [
    [() => pick(r, [`${wd} ${ord(n)} ${m}`, `${wd.slice(0, 3)} ${ord(n)} ${m.slice(0, 3)}`, `${wd} ${n} ${m}`, `${wd}, ${ord(n)} ${m}`, `${wd.slice(0, 3)} ${n} ${m.slice(0, 3)}`]), 26],
    [() => pick(r, [`${ord(n)} ${m}`, `${n} ${m.slice(0, 3)}`, `${ord(n)} of ${m}`, `${n} ${m}`]), 26],
    [() => pick(r, [`${pad(n)}/${pad(mi + 1)}/${String(y).slice(2)}`, `${pad(n)}/${pad(mi + 1)}/${y}`, `${n}/${mi + 1}/${String(y).slice(2)}`]), 16],
    [() => (ahead === 1 ? "tomorrow" : null), 9],
    [() => (wdOk ? pick(r, [`${wd} ${ord(n)}`, `${wd.slice(0, 3)} ${ord(n)}`, `${wd} the ${ord(n)}`]) : null), 5],
    [() => `${pad(n)}/${pad(mi + 1)}`, 4],
    [() => (ahead >= 1 && ahead <= 6 ? wd : null), 3],
    [() => (bareOk ? `the ${ord(n)}` : null), 2],
    [() => `${m} ${ord(n)}`, 1],
  ];
  const w = styled("date", forms)();
  if (w) return w;
  for (;;) { const x = weighted(r, forms)(); if (x) return x; }
}

// ---- times -----------------------------------------------------------------------------------------------------
/** Measured (855 time quotes): hh:mm 35% and more inside ranges, 12h 18%, hhmm 5%, midnight or noon 1%. */
export function sayTime(hhmm: string): string {
  const r = L;
  const [h, mi] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12, ap = h < 12 ? "am" : "pm";
  if (hhmm === "00:00" && r() < 0.5) return "midnight";
  if (hhmm === "12:00" && r() < 0.3) return pick(r, ["midday", "noon"]);
  return styled("time", [
    [() => hhmm, 45],
    [() => (mi ? `${h12}${pick(r, [".", ":"])}${pad(mi)}${ap}` : `${h12}${ap}`), 25],
    [() => `${pad(h)}${pad(mi)}`, 6],
    [() => (mi ? `${h12}:${pad(mi)} ${ap.toUpperCase()}` : `${h12}${ap.toUpperCase()}`), 6],
    [() => `${hhmm}hrs`, 3],
  ] as const)();
}

export type Times = { text: string; a: string; b: string | null; dur: { mins: number; q: string } | null };
/**
 * A call's times. Measured (582 calls with times): half give a start and a length with no end (237 of 292
 * lengths had no end quoted), the rest a start and an end, in one phrase or two.
 */
export function sayTimes(start: string, end: string): Times {
  const r = L;
  const a = sayTime(start);
  const [sh, sm] = start.split(":").map(Number), [eh, em] = end.split(":").map(Number);
  const mins = ((eh * 60 + em - sh * 60 - sm) % 1440 + 1440) % 1440;
  if (mins % 60 === 0 && mins > 0 && styled("length", [[true, 45], [false, 55]] as const)) {
    const h = mins / 60;
    const q = pick(r, [`${h} hours`, `${h}hrs`, `${h} hrs`, `${h}hr call`, `${h} hour call`, ...(h <= 12 ? [`${NUM[h]} hours`] : [])]);
    const text = pick(r, [`${a} for ${q}`, `${a} start, ${q}`, `from ${a} for ${q}`, `${q} from ${a}`, `${a} (${q})`]);
    return { text, a, b: null, dur: { mins, q } };
  }
  const b = sayTime(end);
  return { text: pick(r, [`${a} - ${b}`, `${a}-${b}`, `${a} till ${b}`, `from ${a} to ${b}`, `${a} to ${b}`, `${a} until ${b}`, `start ${a}, finish ${b}`]), a, b, dur: null };
}

// ---- crew and venue ----------------------------------------------------------------------------------------------
/** Measured (504 crew quotes): "4 x crew" / "x4" 52%, "4 crew" 20%, a trade word 12% (the trades' own), words 4%, people 3%. */
export function sayCrew(n: number): string {
  const r = L;
  return styled("crew", [
    [() => styled("crew x", [[`${n} x crew`, 1], [`x${n} crew`, 1], [`${n}x crew`, 1], [`${n} x Crew`, 1], [`x${n}`, 1]] as const), 52],
    [() => styled("crew n", [[`${n} crew`, 1], [`${n} crew members`, 1], [`${n} Crew`, 1]] as const), 20],
    [() => (n <= 12 ? `${NUM[n]} crew` : `${n} crew`), 4],
    [() => (n > 1 ? styled("people", [[`${n} guys`, 1], [`${n} people`, 1], [`${n} hands`, 1], [`${n} staff`, 1]] as const) : "1 person"), 3],
  ] as const)();
}

/**
 * Measured (496 venue quotes): a place's exact name 28%, its name inside more words or a part of it 51%, a name
 * OnSinch has not got 18% (new places, spellings: left out, since what a misspelt known venue should become is not
 * ruled). The reader's value is the place's name; the quote is the words around it.
 */
export function sayVenue(p: Place): string {
  const r = L;
  if (!venues.has(p.id)) venues.set(p.id, weighted(r, [
    [p.name, 28],
    [pick(r, [`${p.name}, ${p.address}`, `${p.name}, London`, ...(/^the /i.test(p.name) ? [] : [`the ${p.name}`])]), 51],
  ] as const));
  return venues.get(p.id)!;
}

// ---- the letter around it ----------------------------------------------------------------------------------------
type Register = "terse" | "chatty" | "formal" | "rushed";
const OPEN: Record<Register, string[]> = {
  terse: [""],
  chatty: ["Hope you're well.", "Hope you had a good weekend.", "Hope all is good with you.", "Thanks again for the crew last week, all went really well."],
  formal: ["Please see our requirements below.", "Please find details of our next job below.", "I would like to place the following booking."],
  rushed: [""],
};
const CLOSE: Record<Register, string[]> = {
  terse: ["", "Thanks."],
  chatty: ["Let me know if you need anything else.", "Any questions give me a shout.", "Thanks so much, speak soon."],
  formal: ["Please confirm once booked.", "We look forward to your confirmation.", "Please let me know if you require anything further."],
  rushed: ["", "thx", "pls confirm asap"],
};
const DISCLAIMER = (co: string, r: Rng) => pick(r, [
  `This email and any attachments are confidential and intended solely for the addressee. If you have received it in error please notify the sender and delete it. ${co} is registered in England and Wales, company no. 0${int(r, 1000000, 9999999)}.`,
  `CONFIDENTIALITY NOTICE: The information in this message is privileged and may be confidential. If you are not the intended recipient, any use, disclosure or copying is prohibited.`,
  `Please consider the environment before printing this email.\nThe views expressed here are the sender's own and not necessarily those of ${co}.`,
]);
const HISTORY = (r: Rng) => pick(r, [
  `On ${pick(r, ["Mon", "Tue", "Wed", "Thu", "Fri"])}, ${int(r, 1, 28)} Oct 2026 at ${pad(int(r, 8, 17))}:${pad(int(r, 0, 59))}, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:\n> Hi, thanks for your email, we will get this booked in.\n> Thanks, Dan`,
  `-----Original Message-----\nFrom: Bookings <bookings@spartancrew.co.uk>\nSent: ${pad(int(r, 1, 28))} October 2026 ${pad(int(r, 8, 17))}:${pad(int(r, 0, 59))}\nSubject: RE: Crew\n\nThanks, all noted on our side.`,
  `From: Spartan Crew Bookings <bookings@spartancrew.co.uk>\nSent: ${pick(r, ["Monday", "Tuesday", "Thursday"])}, ${int(r, 1, 28)} October 2026 ${pad(int(r, 9, 17))}:${pad(int(r, 0, 59))}\nSubject: Re: Crew booking\n\nHi, that's all confirmed, thanks.\n\nSpartan Crew`,
]);

export type Sender = { first: string; last: string; company: string; domain: string };
/**
 * The client's email around its facts. Measured over the same 1,088 bodies: a greeting 65%, a phone number 90%, a
 * link 90%, an image or attachment marker 66%, a disclaimer 54%, quoted history 73% (most on replies), sent from a
 * phone 1%. Registers are weighted to give the greeting rate; nothing here holds a day, a time or a crew count.
 */
export function letter(s: Sender, text: string, history: boolean): string {
  const r = L;
  const reg = weighted(r, [["terse", 25], ["chatty", 35], ["formal", 25], ["rushed", 15]] as const);
  const greet = reg === "rushed" || (reg === "terse" && r() < 0.6) ? "" : pick(r, ["Hi,", "Hi team,", "Hello,", "Morning all,", "Hi Dan,", "Good afternoon,", "Hi guys,", "Dear Spartan Crew,"]);
  const open = pick(r, OPEN[reg]), close = pick(r, CLOSE[reg]);
  const phone = r() < 0.9 ? pick(r, [`M: 07700 900${int(r, 100, 999)}`, `T: 020 7946 0${int(r, 100, 999)} | M: 07700 900${int(r, 100, 999)}`, `Mob: +44 (0)7700 900${int(r, 100, 999)}`]) : "";
  const link = r() < 0.9 ? pick(r, [`www.${s.domain}`, `https://www.${s.domain}`, `https://www.${s.domain} | https://www.instagram.com/${s.domain.split(".")[0]}`]) : "";
  const image = r() < 0.66 ? pick(r, [`[cid:image00${int(r, 1, 9)}.png@01DB2C3A.5F1E8A40]`, `[image: ${s.company} logo]`, `[image001.jpg]`]) : "";
  const title = pick(r, ["Production Manager", "Project Manager", "Operations Coordinator", "Event Manager", "Head of Production", ""]);
  const sign = reg === "rushed" ? (r() < 0.5 ? s.first : `${s.first}\n\nSent from my iPhone`)
    : [pick(r, ["Thanks,", "Kind regards,", "Many thanks", "Cheers,", "Best,", "Regards,"]), `${s.first} ${s.last}`, title && `${title} | ${s.company}`, !title && s.company, phone, link, image].filter(Boolean).join("\n");
  const disclaimer = reg !== "rushed" && r() < 0.54 ? `\n\n${DISCLAIMER(s.company, r)}` : "";
  const hist = history || r() < 0.4 ? `\n\n${HISTORY(r)}` : "";
  return [greet, open, text, close].filter(Boolean).join("\n\n") + `\n\n${sign}${disclaimer}${hist}`;
}

/** Facts in a form ("Date: ...") or a sentence. Measured: 54% of bodies list 3 or more short lines with figures. */
export function formOf(parts: Array<readonly [string, string]>): string {
  const r = L;
  const xs = parts.slice();
  if (r() < 0.5) for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  return xs.map(([k, v]) => `${k}: ${v}`).join("\n");
}
export const useForm = () => L() < 0.4;
export const pickL = <T>(xs: readonly T[]): T => pick(L, xs);
