// ============================================================================
// THE CORPUS. 500 enquiries, declared as bookings first and rendered as mail
// second.
// ----------------------------------------------------------------------------
// THE EMAIL IS NEVER WRITTEN FROM THE ANSWER. Each case declares the booking a
// competent human would take — sizes, dates, windows, the gold profession row,
// the gold place row — and only then renders that declaration into the prose a
// client actually types. The noise goes on the RENDERING; the truth stays in
// fields.
//
// This account has already paid for the other arrangement once. A matcher study
// here measured 98.7% on self-match and 45.9% on real queries because the
// questions had been generated out of the tenant's own records: it was testing
// whether a string could find itself. An enquiry written from the answer tests
// the generator.
//
// Pure and seeded. No I/O, no clock, no unseeded randomness — the same n
// produces the same 500 cases on any machine, which is what makes one run
// comparable to the next and what makes a disagreement worth investigating
// rather than worth re-running.
// ============================================================================
import { GOLD_ROLES, GOLD_VENUES, ROLE_BY_KEY, VENUE_BY_KEY, type GoldRole, type GoldVenue } from "./gold";

export const COMPANY_NAME = "TEST - Eventz";
export const COMPANY_ID = 515;
export const CONTACT = "dani@test-eventz-sim.co.uk";

/** mulberry32 — small, seeded, and good enough to pick between six phrasings. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(xs: readonly T[], r: () => number): T => xs[Math.floor(r() * xs.length)];

// ---------------------------------------------------------------- the truth
/** One block of work, as the client asked for it and as a booker would write it down. */
export interface TruthBlock {
  size: number;
  /** Gold role key — see study/gold.ts. Carries the profession a booker would pick. */
  role: string;
  /** ISO date, or null when the client genuinely did not say. */
  date: string | null;
  /** HH:MM, or null when not stated. The engine's defaults are then under test. */
  start: string | null;
  end: string | null;
  /** Gold venue key. */
  venue: string;
  /**
   * THE WORDS THE CLIENT ACTUALLY USED FOR THIS VENUE.
   *
   * Recorded because a perfect extractor copies what the client wrote — the
   * extraction prompt says so outright, "Copy values verbatim" — and does NOT
   * quietly substitute the tenant's own name for it. The first draft of the
   * scripted reasoner emitted the canonical form for every case, which is not
   * a perfect extractor but a better-than-perfect one that already knows the
   * tenant, and it hid every resolver gap that lives in the gap between what a
   * client calls a building and what the row is called. The model leg found
   * three of them at once — "Ally Pally", "the Vaults", "the o2 north
   * greenwich" — and they had all scored clean under the scripted leg.
   */
  said: string;
  task: string;
}

export type CaseKind = "booking" | "not-a-job" | "confirmation-only";

export interface StudyCase {
  id: string;
  /** The factor cell this case occupies, for the per-axis breakdown. */
  cell: Record<string, string | number | boolean>;
  kind: CaseKind;
  truth: { blocks: TruthBlock[]; po: string | null };
  /**
   * WHEN THE ENQUIRY WAS SENT, and it tracks the work rather than standing still.
   *
   * A bare date carries no year, so "19th January" only means one thing
   * relative to the day it was written — the next occurrence after it. The
   * first draft of this corpus dated every email 2026-09-01 and then booked
   * work out to 2028, so a case declaring 2028-01-19 rendered it bare and a
   * competent reader — and the engine — correctly took 2027-01-19. The case was
   * unanswerable and it scored the engine as wrong for being right.
   *
   * Real enquiries arrive weeks before the job, so the email sits 14-56 days
   * ahead of the work. That makes every bare date unambiguous by construction
   * and the corpus realistic at the same time.
   */
  sentAt: string;
  /** The thread as it arrives. Messages before the client's request are noise. */
  subject: string;
  messages: Array<{ from: "client" | "spartan"; body: string; subject?: string }>;
  amend: null | {
    shape: string;
    subject: string;
    /** The messages appended for the follow-up. */
    messages: Array<{ from: "client" | "spartan"; body: string }>;
    truth: { blocks: TruthBlock[]; po: string | null };
  };
  /** A neighbour's date reused on purpose: the cross-thread hold must fire. */
  twinOf?: string;
}

// ---------------------------------------------------------------- factors
// Crossed, not sampled. Every rule in this engine lives at a boundary, and a
// boundary is not something a sample finds — it is something a design puts a
// case on either side of. The chief bands are 4 / 10 / 20 and every edge below
// is present from both sides.
const SIZES = [1, 2, 3, 4, 5, 9, 10, 11, 19, 20, 21, 30, 40];
const SHIFTS = [
  { key: "short", start: "09:00", end: "12:00", hours: 3 },
  { key: "eight", start: "08:00", end: "16:00", hours: 8 },   // the day-rate boundary, stated
  { key: "ten", start: "08:00", end: "18:00", hours: 10 },
  { key: "long", start: "06:00", end: "19:00", hours: 13 },
  { key: "overnight", start: "20:00", end: "02:00", hours: 6 }, // crosses midnight
];
const TIMES = ["full", "full", "full", "start-only", "none"] as const;
const DATES = ["with-year", "bare", "bare", "with-year", "none"] as const;
const BLOCKS = [1, 1, 2, 3, 2] as const;
const TASKS = [
  "exhibition stand build",
  "get-in & de-rig — stage left / stage right",
  "x".repeat(80),  // exactly the slot-team name limit
  "y".repeat(81),  // one over: the live 400
  "AV rig and focus",
];
const AMENDMENTS = [
  "grow", "shrink", "move-start", "move-end", "venue",
  "profession", "rename", "add-block", "drop-block", "compound",
] as const;

// ---------------------------------------------------------------- rendering
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ord = (d: number) => (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");

/**
 * A date the way a client writes it. `bare` deliberately omits the year.
 *
 * The omission is the whole point of the date axis: the model infers a year
 * from the email's own date and the engine overrules it only when the text
 * shows that day and month with NO year. A corpus that always writes the year
 * cannot reach the reconciliation layer at all — an earlier rig rendered raw
 * ISO strings and the next-occurrence roll fired on 0 of 100 runs, so the rule
 * that once put 26 crew a year early on a live booking was unreachable.
 */
function sayDate(iso: string, form: (typeof DATES)[number], r: () => number): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate(), m = d.getUTCMonth(), y = d.getUTCFullYear();
  if (form === "bare") {
    return pick([
      `${day}${ord(day)} ${MONTHS[m]}`,
      `${day} ${MON[m]}`,
      `${MONTHS[m]} ${day}${ord(day)}`,
      `${DOW[d.getUTCDay()]} ${day}${ord(day)} ${MON[m]}`,
    ], r);
  }
  return pick([
    `${day}${ord(day)} ${MONTHS[m]} ${y}`,
    `${String(day).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${y}`,
    `${MONTHS[m]} ${day}${ord(day)}, ${y}`,
    `${day} ${MON[m]} ${y}`,
  ], r);
}
const bareForm = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${ord(d.getUTCDate())}`;
};

/** Times the way people type them. Returns "" when the client said nothing. */
function sayTimes(start: string | null, end: string | null, r: () => number): string {
  if (!start && !end) return pick(["", "", " (times tbc)", " — times to follow"], r);
  const h = (t: string) => {
    const [H, M] = t.split(":").map(Number);
    const am = H < 12 ? "am" : "pm";
    const h12 = H % 12 === 0 ? 12 : H % 12;
    return M === 0 ? `${h12}${am}` : `${h12}.${String(M).padStart(2, "0")}${am}`;
  };
  if (start && !end) return pick([` from ${h(start)}`, ` starting ${h(start)}`, ` ${start} start`], r);
  return pick([
    ` ${h(start!)} - ${h(end!)}`,
    ` ${start}-${end}`,
    ` from ${h(start!)} til ${h(end!)}`,
    ` ${h(start!)} to ${h(end!)}`,
    ` (${start} start, ${end} finish)`,
  ], r);
}

const NUM_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function sayCrew(size: number, role: GoldRole, r: () => number): string {
  const word = pick(role.said, r);
  const n = size <= 10 && r() < 0.35 ? NUM_WORDS[size - 1] : String(size);
  return pick([`${n} ${word}`, `${n} x ${word}`, `a team of ${n} ${word}`, `${n}no. ${word}`], r);
}

/** A light dusting of the typos real mail carries. Never touches a number or a date. */
function rough(text: string, r: () => number): string {
  let out = text;
  if (r() < 0.25) out = out.replace(/\bplease\b/i, "pls");
  if (r() < 0.2) out = out.replace(/\band\b/, "&");
  if (r() < 0.15) out = out.replace(/\bthe\b/, "teh");
  if (r() < 0.2) out = out.toLowerCase();
  return out;
}

/**
 * The company lives in the SIGNATURE, because that is where it lives in real
 * mail and because here the engine has nowhere else to find it: the test
 * company's only contact is a @spartancrew.co.uk address, which triage
 * correctly kills as own-mail, so a synthetic sender belongs to no company.
 *
 * Appended AFTER rough(), which lowercases a fifth of bodies — "test - eventz"
 * stops reading as a company name.
 */
const SIGNOFFS = [
  "\n\nThanks\nDani\nTEST - Eventz",
  "\n\nCheers,\nDani Fowler\nProduction Coordinator | TEST - Eventz\n07700 900412",
  "\n\nMany thanks\nD\nTEST - Eventz",
  "\n\nBest,\nDani (TEST - Eventz)\n--\nSent from my iPhone",
  "\n\nThanks in advance!\nDani F.\nTEST - Eventz Ltd",
];
const OPENERS = ["Hi,", "Hi there,", "Morning,", "Hello,", "Hi Spartan,", "Afternoon all,", "Hey,"];
const FILLER = ["Hope you're well.", "Sorry for the short notice.", "Long time no speak!", "Following on from the last one.", "", ""];
const ASKS = [
  "Can you cover the below?",
  "Are you able to help with this one?",
  "Could you quote for the following please?",
  "Do you have availability for:",
  "We need crew for the below job.",
  "Please could I request a quote for the following crew?",
];

/**
 * THE NOISE THAT SITS ON TOP OF A LIVE REQUEST.
 *
 * The classifier's own prompt says roughly half of all messages in this mailbox
 * are Spartan's own, and that judging only the newest message threw away 43
 * live jobs in a 200-thread sample, 20 of which a human had to book by hand.
 * A corpus of single-message threads cannot reach that failure at all, so a
 * third of these cases arrive with the request already buried.
 */
const NOISE = ["clean", "clean", "spartan-reply", "out-of-office", "bounce"] as const;
const NOISE_BODY: Record<string, { from: "client" | "spartan"; body: string }> = {
  "spartan-reply": { from: "spartan", body: "Hi Dani,\n\nThanks for this — leave it with me and I'll come back shortly.\n\nThanks,\nSpartan Crew" },
  "out-of-office": { from: "client", body: "Automatic reply: Out of Office\n\nI am currently out of the office with limited access to email and will return on Monday. For anything urgent please contact the production desk.\n\nThis is an automated message." },
  "bounce": { from: "client", body: "Delivery Status Notification (Failure)\n\nAddress not found. Your message wasn't delivered to paul@ because the address couldn't be found, or is unable to receive mail.\n\nThe response was:\n550 5.1.1 The email account that you tried to reach does not exist." },
};

// ---------------------------------------------------------------- the corpus
/**
 * ONE DISTINCT DAY PER CASE, and this is load-bearing.
 *
 * Every case is on the ONE test company, so the date is the only thing that
 * separates one booking from another. An earlier 500-case run drew day and
 * month from periods sharing a factor, so the whole study ran on 27 dates:
 * every case after the first on a date was matched by the (company, date)
 * dedup to the order an earlier case had raised, and patched it. 500 cases
 * created 27 orders, and the run measured deduplication.
 */
const EPOCH = Date.UTC(2027, 2, 1);
const dayOf = (i: number) => new Date(EPOCH + i * 86400000).toISOString().slice(0, 10);

export function buildCases(n = 500, seed = 20260902): StudyCase[] {
  const r = rng(seed);
  const out: StudyCase[] = [];

  for (let i = 0; i < n; i++) {
    /**
     * Every twelfth case is not a booking at all, split between the two ways a
     * thread can carry no work: a message that never asked for crew, and one
     * that only acknowledges a job already placed.
     *
     * The real mailbox is mostly these. Of 543 threads labelled off the live
     * sweep, 296 were not-a-job and 149 confirmation-only — 82% between them,
     * against 25 new bookings. A corpus made only of bookings measures a
     * mailbox nobody has, and it cannot see a false positive at all: the
     * expensive mistake here is raising an order for an invoice query.
     */
    const kind: CaseKind = i % 12 === 5 ? "not-a-job" : i % 12 === 11 ? "confirmation-only" : "booking";

    const size = SIZES[i % SIZES.length];
    /**
     * ROLE AND VENUE MUST NOT MOVE TOGETHER, and in the first draft they did.
     *
     * There are 14 roles and 14 venues, and the draft indexed them (i*5)%14 and
     * (i*3)%14. Both multipliers are coprime to 14, so the role index
     * determines i mod 14, which determines the venue index: the two factors
     * were in perfect one-to-one correspondence and every "steward" case was
     * also a "stadium" case. The first 500-case run reported role and venue
     * breakdowns that were the same numbers twice — steward 12/35 and stadium
     * 12/35 — and there was no way to tell which factor carried the failure.
     *
     * Adding a term that advances once per full cycle breaks the lock-step: the
     * pairing shifts by one every 14 cases, so over 500 cases every role meets
     * most venues.
     */
    const role = GOLD_ROLES[(i * 5) % GOLD_ROLES.length];
    const venue = GOLD_VENUES[(i * 3 + Math.floor(i / GOLD_ROLES.length)) % GOLD_VENUES.length];
    const shift = SHIFTS[(i * 7) % SHIFTS.length];
    const task = TASKS[(i * 11) % TASKS.length];
    const nBlocks = BLOCKS[(i * 13) % BLOCKS.length];
    const times = TIMES[(i * 17) % TIMES.length];
    const dateForm = DATES[(i * 19) % DATES.length];
    const noise = NOISE[(i * 23) % NOISE.length];
    const date = dayOf(i);

    /**
     * A MERGE PAIR: two sentences that must collapse to ONE slot team.
     *
     * Same day, same window, same venue, same role, written as two lines — the
     * merge key is window + place + profession and size never splits a team.
     * Written apart in the mail and expected together on the order, so a case
     * that merges wrongly is visible as a team count, not only as a headcount.
     */
    const mergePair = nBlocks > 1 && i % 6 === 2;
    /** Two blocks that must NOT merge: same everything except the window. */
    const splitPair = nBlocks > 1 && i % 6 === 4;

    const blocks: TruthBlock[] = [];
    for (let b = 0; b < nBlocks; b++) {
      const sameKey = mergePair;
      const brole = sameKey ? role : GOLD_ROLES[(i + b * 4) % GOLD_ROLES.length];
      const bvenue = sameKey
        ? venue
        // Per-block venues on every third multi-block case: crew moving sites.
        : nBlocks > 1 && i % 3 === 0
          ? GOLD_VENUES[(i + b) % GOLD_VENUES.length]
          : venue;
      const bshift = sameKey ? shift : splitPair ? { ...shift, start: b === 0 ? shift.start : "18:00", end: b === 0 ? shift.end : "22:00" } : b === 0 ? shift : { ...shift, start: "18:00", end: "22:00" };
      // Drawn ONCE, here, so the words in the email and the words the extractor
      // reports are the same words. Drawing again at render time would let the
      // two drift and the case would be unanswerable.
      const bsaid = pick(bvenue.said, r);
      blocks.push({
        said: bsaid,
        size: b === 0 ? size : Math.max(1, Math.round(size / 2)),
        role: brole.key,
        date: dateForm === "none" ? null : date,
        start: times === "none" ? null : bshift.start,
        end: times === "none" || times === "start-only" ? null : bshift.end,
        venue: bvenue.key,
        task: b === 0 ? task : `${task} (part ${b + 1})`,
      });
    }

    const po = i % 5 === 0 ? `PO-${10000 + ((i * 7919) % 89999)}` : null;

    // ------------------------------------------------ render
    const lines = blocks.map((b, bi) => {
      const gr = ROLE_BY_KEY.get(b.role)!;
      const when = b.date ? ` on ${sayDate(b.date, dateForm, r)}` : "";
      const where = nBlocks > 1 && blocks.some((x) => x.venue !== blocks[0].venue) ? ` at ${b.said}` : "";
      const what = nBlocks > 1 ? (bi === 0 ? " for the build" : bi === 1 ? " for the derig" : " for the show day") : "";
      return `- ${sayCrew(b.size, gr, r)}${when}${sayTimes(b.start, b.end, r)}${where}${what}`;
    });

    const oneVenue = blocks.every((x) => x.venue === blocks[0].venue);
    const spoken = blocks[0]?.said ?? "";

    /**
     * THE SAME DATE, WRITTEN TWICE — ONCE WITH THE YEAR AND ONCE WITHOUT.
     *
     * The shape that broke live order 15611: a summary line carrying the year
     * plus a load-in sentence naming the same day bare. The bare mention won
     * and dragged the booking back a year — 26 crew called six weeks out for a
     * job twelve months away. A structured enquiry writes its dates twice as a
     * matter of course, so a corpus that never repeats one cannot see this.
     */
    const repeatBare = dateForm === "with-year" && i % 4 === 1 && !!blocks[0].date;

    const bookingBody = rough([
      pick(OPENERS, r),
      pick(FILLER, r),
      pick(ASKS, r),
      "",
      lines.join("\n"),
      "",
      oneVenue ? `Venue is ${spoken}.` : "",
      repeatBare ? `Load-in from ${blocks[0].start ?? "07:00"} on ${bareForm(blocks[0].date!)}.` : "",
      po ? `Our PO is ${po}.` : "",
      dateForm === "none" ? "Date still to be confirmed, will let you know." : "",
    ].filter((x) => x !== "").join("\n"), r) + pick(SIGNOFFS, r);

    const NOT_A_JOB = [
      "Morning — just chasing the invoice for last month, nothing else needed at this end.",
      "Hi, could you send over your current rate card please? No job attached, just for our records.",
      "Hello — we're updating our supplier list, could you confirm your public liability cover?",
      "Hi both, please can you send the signed COI across when you get a moment. Thanks.",
    ];
    const CONFIRMATION = [
      "Perfect, thanks for that — all noted.",
      "Great, that works. See you then.",
      "Lovely, thanks. Nothing else needed from us.",
    ];

    const body =
      kind === "not-a-job" ? rough(pick(NOT_A_JOB, r), r) + pick(SIGNOFFS, r)
      : kind === "confirmation-only" ? rough(pick(CONFIRMATION, r), r) + pick(SIGNOFFS, r)
      : bookingBody;

    const subject =
      kind === "not-a-job" ? pick(["Invoice query", "Rate card", "Supplier docs", "Insurance certificate"], r)
      : kind === "confirmation-only" ? "Re: Crew booking"
      : pick([
          `Crew request - ${spoken}`,
          `Staffing enquiry ${blocks[0].date ? sayDate(blocks[0].date, dateForm, r) : "(date tbc)"}`,
          `${spoken} job`,
          `Crew for ${spoken}`,
          "Availability?",
        ], r);

    /**
     * A confirmation-only thread has to have something to be confirming, or it
     * is just a bare "thanks" and the classifier is right to call it not-a-job.
     * So it carries the original request above it, exactly as the mailbox does.
     */
    const messages: StudyCase["messages"] = [];
    if (kind === "confirmation-only") {
      messages.push({ from: "client", body: bookingBody });
      messages.push({ from: "spartan", body: "Hi Dani,\n\nGot it — I'll get that booked in and confirm shortly.\n\nThanks,\nSpartan Crew" });
    }
    messages.push({ from: "client", body });
    if (kind === "booking" && noise !== "clean") messages.push(NOISE_BODY[noise]);

    // ------------------------------------------------ the follow-up
    const amended = i % 2 === 1 && kind === "booking";
    const shape = amended ? AMENDMENTS[Math.floor(i / 2) % AMENDMENTS.length] : null;
    const amend = shape ? applyAmendment(blocks, shape, i, r, po) : null;

    // 14-56 days before the work, deterministically. TBC cases have no work
    // date to hang off, so they sit at the corpus epoch's own lead time.
    const lead = 14 + ((i * 13) % 43);
    const sentAt = new Date((blocks[0]?.date ? Date.parse(blocks[0].date + "T00:00:00Z") : EPOCH) - lead * 86400000)
      .toISOString().slice(0, 10);

    out.push({
      id: `S${String(i).padStart(3, "0")}-${kind === "booking" ? (shape ?? "plain") : kind}`,
      kind,
      sentAt,
      cell: {
        size, role: role.key, venue: venue.key, shift: shift.key,
        task: task.length === 81 ? "over-limit" : task.length === 80 ? "at-limit" : "plain",
        blocks: nBlocks, times, date: dateForm, noise, kind,
        merge: mergePair ? "must-merge" : splitPair ? "must-split" : "n/a",
        po: !!po, amendment: shape ?? "", repeatBare,
      },
      truth: { blocks, po },
      subject,
      messages,
      amend,
    });
  }

  return out;
}

/**
 * The second email, and every shape below must produce a REAL change.
 *
 * Four of them once did not, and the study scored the engine as "falling back
 * to a human" on 9 of 43 amendments when the truth was that the amended blocks
 * composed to a byte-identical slot-team set: move-start on a case whose times
 * were never stated left undefined as undefined; shrink on a block of 1 is
 * still 1; and rotating a role between two trades the tenant does not have
 * ("riggers" to "porters") resolves to Crew both times. A case that cannot
 * express its own shape is not evidence about the engine either way.
 */
function applyAmendment(
  blocks: TruthBlock[], shape: string, i: number, r: () => number, po: string | null
): StudyCase["amend"] {
  const b = blocks.map((x) => ({ ...x }));
  let text = "";
  switch (shape) {
    case "grow":
      b[0].size += 3;
      text = pick([`Sorry — can we make that ${b[0].size} in the end?`, `Client's added to the build, we need ${b[0].size} now.`], r);
      break;
    case "shrink": {
      // Shrink whichever block has the room. A block of 1 cannot shrink, and
      // picking it anyway is what produced a no-op scored as a failure.
      const t = b.reduce((best, x, idx) => (x.size > b[best].size ? idx : best), 0);
      b[t].size = b[t].size > 1 ? b[t].size - 1 : b[t].size + 1;
      text = `Slight change, we only need ${b[t].size} now.`;
      break;
    }
    case "move-start":
      // Stated outright, so the case works even where the original had no times.
      b[0].start = b[0].start === "07:00" ? "06:00" : "07:00";
      text = `Can we start earlier — ${b[0].start} on the first call please.`;
      break;
    case "move-end":
      b[0].end = b[0].end === "21:00" ? "22:00" : "21:00";
      text = `Can we push the finish to ${b[0].end}? Overrunning.`;
      break;
    case "venue": {
      const next = GOLD_VENUES[(GOLD_VENUES.findIndex((v) => v.key === b[0].venue) + 1) % GOLD_VENUES.length];
      const said = pick(next.said, r);
      b.forEach((x) => { x.venue = next.key; x.said = said; });
      text = `Venue's moved — it's at ${said} now.`;
      break;
    }
    case "profession": {
      // Only trades the tenant holds as DISTINCT rows. Rotating between two it
      // does not hold changes nothing on the order.
      const DISTINCT = ["crew", "carpenter", "forklift", "ipaf", "cscs", "bar"];
      const cur = b[0].role;
      b[0].role = DISTINCT.filter((p) => p !== cur)[i % (DISTINCT.length - 1)];
      text = `One change — make the first call ${ROLE_BY_KEY.get(b[0].role)!.said[0]} rather than what I put.`;
      break;
    }
    case "rename":
      b[0].task = `${b[0].task} — revised brief`;
      text = "Brief's been revised, same crew and times, just so it's on the paperwork.";
      break;
    case "add-block":
      b.push({ ...b[0], size: 2, task: "late addition", start: "18:00", end: "22:00" });
      text = "Also need 2 for the derig 6pm-10pm the same day please.";
      break;
    case "drop-block":
      if (b.length > 1) { b.pop(); text = "Scrap the last call, we've covered it in house."; }
      else { b[0].size = Math.max(1, b[0].size - 1); text = `Make it ${b[0].size} please.`; }
      break;
    case "compound": {
      // Six changes in one email, which is what a client sends when a job moves.
      // Deliberately excludes a DROP: every other change amends in place, and a
      // drop forces the whole thing down the rebuild path, so the case would
      // stop testing the amendment ladder.
      b[0].size += 4;
      if (b[1]) b[1].size = Math.max(1, b[1].size - 2);
      b[0].start = "06:00";
      b[0].end = "20:00";
      b[0].task = `${b[0].task} — revised`;
      b.push({ ...b[0], size: 2, task: "extra call", start: "20:00", end: "23:00" });
      text = `Few changes I'm afraid: first call is now ${b[0].size} from 6am til 8pm, ${b[1] ? `second drops to ${b[1].size}, ` : ""}and we need 2 more for an extra call 8pm-11pm.`;
      break;
    }
  }
  return {
    shape,
    subject: "Re: (follow-up)",
    messages: [{ from: "client", body: rough(`${pick(OPENERS, r)}\n\n${text}`, r) + pick(SIGNOFFS, r) }],
    truth: { blocks: b, po },
  };
}
