// ============================================================================
// A hundred enquiries written the way clients write them.
// ----------------------------------------------------------------------------
// THE EMAIL IS NOT GENERATED FROM THE ANSWER. Each case declares a TRUTH — the booking a
// competent human would take from it — and then renders that truth into prose the way a
// client would actually type it: lowercase, abbreviated, a venue called by its nickname,
// a crew size written in words, times as "8-6", a signature block in the way.
//
// This is the trap this account has already fallen into once. A matcher study here
// measured 98.7% on self-match and 45.9% on real queries, because the questions had been
// written from the answers. An enquiry generated out of the tenant's own records tests
// whether a string can find itself.
//
// So the noise is the point, and it is applied to the RENDERING only. The truth is
// declared first, in fields, and it is what the extraction is scored against.
//
// Seeded, so "random" means the same hundred emails every time. A study you cannot re-run
// is an anecdote.
// ============================================================================

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

export interface TruthBlock {
  /** People. The number a booker would write down. */
  size: number;
  /** The profession FAMILY a booker would pick, or "crew" for general. */
  role: "crew" | "carpenter" | "rigger" | "forklift" | "ipaf";
  /** ISO date, or null when the client genuinely did not say. */
  date: string | null;
  /** HH:MM, or null when not stated. */
  start: string | null;
  end: string | null;
  /** The venue this block is at, by key. */
  venue: VenueKey;
}

export type VenueKey = "o2" | "excel" | "rah" | "olympia" | "new";

export interface RandomCase {
  id: string;
  /** What a competent human would book. The oracle for extraction. */
  truth: { blocks: TruthBlock[]; po: string | null };
  /** The email, as the client typed it. */
  subject: string;
  body: string;
  /** The follow-up, when this case has one, and what it changes. */
  amend: null | { subject: string; body: string; truth: { blocks: TruthBlock[]; po: string | null }; shape: string };
}

const VENUES: Record<VenueKey, { formal: string; spoken: string[] }> = {
  o2: { formal: "The O2, Peninsula Square, SE10 0DX", spoken: ["the O2", "O2 arena", "the o2 north greenwich", "The O2"] },
  excel: { formal: "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL", spoken: ["Excel", "ExCeL London", "excel docklands", "EXCEL"] },
  rah: { formal: "Royal Albert Hall", spoken: ["RAH", "Royal Albert Hall", "the albert hall"] },
  olympia: { formal: "Olympia London, Hammersmith Road, London W14 8UX", spoken: ["Olympia", "Olympia London", "olympia grand"] },
  new: { formal: "Thornbury Assembly Rooms, 14 Kestrel Way, Thornbury BS35 2QQ", spoken: ["Thornbury Assembly Rooms", "Thornbury Assembly Rooms, Kestrel Way, BS35 2QQ"] },
};

const ROLE_WORDS: Record<TruthBlock["role"], string[]> = {
  crew: ["crew", "lads", "guys", "general crew", "hands", "staff", "crew members"],
  carpenter: ["carpenters", "chippies", "carps", "joiners"],
  rigger: ["riggers", "rigging crew", "riggers (up to height)"],
  forklift: ["forklift drivers", "FLT drivers", "counterbalance drivers", "forkies"],
  ipaf: ["IPAF operators", "IPAF 3a/3b", "cherry picker operators (IPAF)"],
};

const NUM_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * THE COMPANY IS IN THE SIGNATURE, because that is where it lives in real mail and
 * because here the engine has nowhere else to find it.
 *
 * Production resolves a client from the sender's domain or an address already on file.
 * The test company's only contact is accounts@spartancrew.co.uk — a Spartan address,
 * which triage correctly kills as own-mail — so a synthetic sender belongs to no company.
 * Without the name in the text, a case holds on "no company name extracted" and the study
 * measures the fixture instead of the engine. Two of the first three pilot cases did
 * exactly that; the third only survived because the model inferred the company from the
 * sender's domain, which is not something to rely on case by case.
 *
 * It is appended AFTER the noise, not inside it: rough() lowercases the whole body a fifth
 * of the time, and "test - eventz" stops reading as a company name.
 */
const SIGNOFFS = [
  "\n\nThanks\nDani\nTEST - Eventz",
  "\n\nCheers,\nDani Fowler\nProduction Coordinator | TEST - Eventz\n07700 900412",
  "\n\nMany thanks\nD\nTEST - Eventz",
  "\n\nBest,\nDani (TEST - Eventz)\n--\nSent from my iPhone",
  "\n\nThanks in advance!\nDani F.\nTEST - Eventz Ltd",
];

const OPENERS = [
  "Hi,", "Hi there,", "Morning,", "Hello,", "Hi Spartan,", "Afternoon all,", "Hey,",
];

const FILLER = [
  "Hope you're well.",
  "Sorry for the short notice.",
  "Long time no speak!",
  "Following on from the last one.",
  "",
  "",
];

/** Dates the way people type them, not the way ISO does. */
/** The day and month with NO year, whatever form the summary line used. */
function bareForm(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const day = d.getUTCDate();
  const ord = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${FULL[d.getUTCMonth()]} ${day}${ord}`;
}

function sayDate(iso: string, r: () => number): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ord = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const forms = [
    `${day}${ord} ${FULL[d.getUTCMonth()]}`,
    `${day} ${MON[d.getUTCMonth()]}`,
    `${String(day).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`,
    `${DOW[d.getUTCDay()]} ${day}${ord} ${MON[d.getUTCMonth()]}`,
    `${day}.${d.getUTCMonth() + 1}.${String(d.getUTCFullYear()).slice(2)}`,
    `${FULL[d.getUTCMonth()]} ${day}${ord}`,
  ];
  return forms[Math.floor(r() * forms.length)];
}

/** Times the way people type them. Returns "" when the client said nothing. */
function sayTimes(start: string | null, end: string | null, r: () => number): string {
  if (!start && !end) return ["", "", " (times tbc)", " — times to follow"][Math.floor(r() * 4)];
  const h = (t: string) => {
    const [H, M] = t.split(":").map(Number);
    const am = H < 12 ? "am" : "pm";
    const h12 = H % 12 === 0 ? 12 : H % 12;
    return M === 0 ? `${h12}${am}` : `${h12}.${String(M).padStart(2, "0")}${am}`;
  };
  if (start && !end) return [` from ${h(start)}`, ` starting ${h(start)}`, ` ${start} start`][Math.floor(r() * 3)];
  const forms = [
    ` ${h(start!)} - ${h(end!)}`,
    ` ${start}-${end}`,
    ` from ${h(start!)} til ${h(end!)}`,
    ` ${h(start!)} to ${h(end!)}`,
    ` (${start} start, ${end} finish)`,
  ];
  return forms[Math.floor(r() * forms.length)];
}

function sayCrew(size: number, role: TruthBlock["role"], r: () => number): string {
  const word = ROLE_WORDS[role][Math.floor(r() * ROLE_WORDS[role].length)];
  const n = size <= 10 && r() < 0.35 ? NUM_WORDS[size - 1] : String(size);
  const forms = [`${n} ${word}`, `${n} x ${word}`, `a team of ${n} ${word}`, `${n}no. ${word}`];
  return forms[Math.floor(r() * forms.length)];
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

export function buildRandomCases(n: number, seed = 20260824): RandomCase[] {
  const r = rng(seed);
  const out: RandomCase[] = [];
  const roles: TruthBlock["role"][] = ["crew", "crew", "crew", "carpenter", "rigger", "forklift", "ipaf"];
  const venueKeys: VenueKey[] = ["o2", "excel", "rah", "olympia", "new"];

  for (let i = 0; i < n; i++) {
    // One distinct day per case: the test company is the only client, so the date is the
    // only thing that stops the dedup matching two cases to one order.
    const iso = new Date(Date.UTC(2027, 2, 1) + i * 86400000).toISOString().slice(0, 10);
    const dateStated = r() < 0.9;                    // a tenth of enquiries have no date
    const nBlocks = r() < 0.62 ? 1 : r() < 0.9 ? 2 : 3;
    const venue = venueKeys[Math.floor(r() * venueKeys.length)];

    const blocks: TruthBlock[] = [];
    for (let b = 0; b < nBlocks; b++) {
      const timed = r() < 0.82;
      const startOnly = timed && r() < 0.12;
      blocks.push({
        size: 1 + Math.floor(r() * (r() < 0.75 ? 12 : 40)),
        role: roles[Math.floor(r() * roles.length)],
        date: dateStated ? iso : null,
        start: timed ? ["07:00", "08:00", "09:00", "06:00", "10:00"][Math.floor(r() * 5)] : null,
        end: timed && !startOnly ? ["16:00", "17:00", "18:00", "19:00", "22:00"][Math.floor(r() * 5)] : null,
        venue,
      });
    }

    const po = r() < 0.3 ? `PO-${10000 + Math.floor(r() * 89999)}` : null;
    // A quarter of enquiries restate the first date bare in a load-in line — see below.
    const repeatBare = r() < 0.25;
    const spoken = VENUES[venue].spoken[Math.floor(r() * VENUES[venue].spoken.length)];

    const lines = blocks.map((b, bi) => {
      const when = b.date ? ` on ${sayDate(b.date, r)}` : "";
      const what = nBlocks > 1 ? (bi === 0 ? " for the build" : bi === 1 ? " for the derig" : " for the show day") : "";
      return `- ${sayCrew(b.size, b.role, r)}${when}${sayTimes(b.start, b.end, r)}${what}`;
    });

    const opener = OPENERS[Math.floor(r() * OPENERS.length)];
    const filler = FILLER[Math.floor(r() * FILLER.length)];
    const ask = [
      "Can you cover the below?",
      "Are you able to help with this one?",
      "Could you quote for the following please?",
      "Do you have availability for:",
      "We need crew for the below job.",
    ][Math.floor(r() * 5)];

    const body = rough(
      [
        opener,
        filler,
        ask,
        "",
        lines.join("\n"),
        "",
        `Venue is ${spoken}.`,
        /**
         * THE SAME DATE, WRITTEN TWICE — ONCE WITH THE YEAR AND ONCE WITHOUT.
         *
         * The shape that broke live order 15611: a summary line carrying the year, plus
         * a load-in sentence naming the same day bare. `bareMonthDays` keyed on MM-DD and
         * kept every unyeared mention without subtracting the ones that also appeared
         * with a year, so the bare mention won and dragged the booking back a year — 26
         * crew called six weeks out for a job that was twelve months away.
         *
         * A structured enquiry writes its dates twice as a matter of course, so a corpus
         * that never repeats one cannot see this at all. One case in four here does.
         */
        repeatBare && blocks[0]?.date
          ? `Load-in from ${blocks[0].start ?? "07:00"} on ${bareForm(blocks[0].date)}.`
          : "",
        po ? `Our PO is ${po}.` : "",
        !dateStated ? "Date still to be confirmed, will let you know." : "",
      ].filter((x) => x !== "").join("\n"),
      r,
      // The signature is appended AFTER the noise: rough() lowercases the whole body a
      // fifth of the time, and a lower-cased company name stops reading as one.
    ) + SIGNOFFS[Math.floor(r() * SIGNOFFS.length)];

    const subject = [
      `Crew request - ${spoken}`,
      `Staffing enquiry ${dateStated ? sayDate(iso, r) : "(date tbc)"}`,
      `${spoken} job`,
      `Crew for ${spoken}`,
      "Availability?",
    ][Math.floor(r() * 5)];

    // Half get a follow-up, and the shape of it is drawn rather than assigned, so the
    // spread is what a mailbox produces rather than what a grid does.
    let amend: RandomCase["amend"] = null;
    if (i % 2 === 1) {
      const shapes = ["grow", "shrink", "move-end", "add-block", "drop-block", "venue"] as const;
      const shape = shapes[Math.floor(r() * shapes.length)];
      const nb = blocks.map((b) => ({ ...b }));
      let text = "";
      switch (shape) {
        case "grow":
          nb[0].size += 1 + Math.floor(r() * 4);
          text = [`Sorry — can we make that ${nb[0].size} in the end?`, `Client's added to the build, we now need ${nb[0].size}.`][Math.floor(r() * 2)];
          break;
        case "shrink":
          nb[0].size = Math.max(1, nb[0].size - (1 + Math.floor(r() * 2)));
          text = `Slight change, we only need ${nb[0].size} now.`;
          break;
        case "move-end":
          nb[0].end = nb[0].end ? "21:00" : "18:00";
          text = `Can we push the finish to ${nb[0].end}? Overrunning.`;
          break;
        case "add-block":
          nb.push({ ...nb[0], size: Math.max(1, Math.round(nb[0].size / 2)), start: "18:00", end: "22:00" });
          text = `Also need ${nb[nb.length - 1].size} for the derig 6pm-10pm same day please.`;
          break;
        case "drop-block":
          if (nb.length > 1) { nb.pop(); text = "Scrap the second call, we've covered it in house."; }
          else { nb[0].size = Math.max(1, nb[0].size - 1); text = `Make it ${nb[0].size} please.`; }
          break;
        case "venue":
          nb.forEach((b) => (b.venue = venueKeys[(venueKeys.indexOf(venue) + 1) % venueKeys.length]));
          text = `Venue's moved — it's at ${VENUES[nb[0].venue].spoken[0]} now.`;
          break;
      }
      amend = {
        subject: `Re: ${subject}`,
        body: rough(`${OPENERS[Math.floor(r() * OPENERS.length)]}\n\n${text}${SIGNOFFS[Math.floor(r() * SIGNOFFS.length)]}`, r),
        truth: { blocks: nb, po },
        shape,
      };
    }

    out.push({ id: `R${String(i).padStart(3, "0")}`, truth: { blocks, po }, subject, body, amend });
  }
  return out;
}

export const VENUE_FORMAL = (k: VenueKey) => VENUES[k].formal;
