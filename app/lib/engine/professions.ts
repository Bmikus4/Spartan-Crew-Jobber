// ============================================================================
// Which of the tenant's 43 professions a request block is asking for.
// ----------------------------------------------------------------------------
// The engine used to carry eight hardcoded substrings mapping to six ids. The
// tenant has 43 professions, and anything the chain did not name fell through to
// Crew — so "2 x IPAF 3a/3b" and "a PASMA team" were booked, and billed, as
// general labour. This reads the live list instead (data/professions.json, kept
// fresh by scripts/pull-professions.mjs and cached in Neon).
//
// Three rules from Ben that the list alone will not give you:
//
//   Q10  Crew Chief is 36. Crew Boss 55 exists and must NEVER be resolved to — a
//        chief cue that lands on 55 books a role the bands do not count.
//   Q8   The plant professions come in hourly and day-rate twins (4/23
//        Telehandler U<9M, 7/24 O>9M, 11/22 Counterbalance, 17/25 Rough Terrain).
//        Day rate at 8 hours or more, hourly below — and the inference is NAMED on
//        the slot team so ops can see it was inferred rather than told.
//   Q12  A newly resolved profession is used on the order immediately, with a note
//        on the ticket. There is no first-use human gate.
//
// The list itself is dirty and the normaliser has to absorb it: names arrive HTML-
// escaped ("Telehandler U&lt; 9M J2 (p/hr)"), several carry leading or trailing
// spaces (" Counterbalance - (Day Rate) "), one is misspelled in the tenant
// ("Telehander - O&gt; 9M J3"), and six are deleted but still returned.
// ============================================================================
import { PROFESSION } from "./types";

export interface ProfessionRec {
  id: number;
  name: string;
  alias?: string | null;
  description?: string | null;
  deleted?: boolean;
}

export interface ProfessionMatch {
  id: number;
  /** The tenant's own name for it, cleaned — what the warning quotes. */
  name: string;
  /** How it was decided, for the note that goes on the ticket. */
  why: "alias" | "exact" | "keyword" | "cue" | "default";
  /** True when a day-rate/hourly twin was chosen by shift length rather than said. */
  rateInferred?: boolean;
  /**
   * The client named a role, and this resolver did not know it — so the block fell
   * to general Crew with nothing to say why.
   *
   * This is the failure that costs the most and shows the least. An IPAF job staffed
   * with general crew, a rigger booked as labour, a "teleporter" that is a machine
   * and not a person: the order composes, validates, writes, and looks exactly like a
   * correct one. Nothing downstream re-reads the client's word.
   *
   * Set ONLY when the hint carried something the GENERIC list does not cover, so
   * "6 lads" stays silent and "6 riggers" does not. It is a question for a human, not
   * a refusal: the order is still built, it just arrives with somebody called.
   */
  unrecognised?: boolean;
}

/**
 * The phrase compiler.ts keys off to call a human for an unknown role.
 *
 * Exported rather than typed twice: a note nobody matches is a note nobody reads,
 * and a sentinel that lives in one file and is re-spelled in another is a fix that
 * silently stops working the first time somebody improves the wording.
 */
export const UNRECOGNISED_MARK = "ROLE NOT RECOGNISED";

/** Never resolvable, whatever a client types. */
const CREW_BOSS = 55;

/**
 * Names come out of OnSinch HTML-escaped and unevenly spaced. Everything compared
 * here goes through this, both sides.
 */
export function normProf(s?: string | null): string {
  return String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    // "Telehander - O> 9M J3 (Day Rate)" is misspelled IN THE TENANT, and it is the
    // day-rate half of a pair whose hourly half spells it correctly. Left alone the
    // O>9M twin can never be found, and a 10-hour telehandler stays on an hourly rate.
    .replace(/telehander/g, "telehandler")
    .replace(/[^a-z0-9<>/]+/g, " ")
    .trim();
}

/**
 * The same words with plurals folded, so a cue written in the singular answers for the
 * plural clients actually type.
 *
 * The cues are singular and the containment pass rescued most plurals by accident: a
 * request for "carpenters" or "drivers" resolves because the tenant's own name is
 * inside the word. Where the client's word for a role is NOT the tenant's word, nothing
 * rescued it, and the cue is the only thing that knew the role at all:
 *
 *     chippies      -> Crew    (should be Carpenter 3)
 *     chiefs        -> Crew    (should be Crew Chief 36)
 *     forklifts     -> Crew    (should be Counterbalance 11)
 *     telehandlers  -> Crew    (should be Telehandler 4)
 *
 * "chiefs" is the one that costs money twice: the chief is booked as general labour,
 * and then the band reads a team with no chief in it and carves another one out.
 *
 * Word by word rather than by regex, and "ss" is left alone, because "boss" folded to
 * "bos" would break the chief cue this exists to protect. Three letters or fewer are
 * left alone too — there is no plural worth recovering there and "3as" is not "3a".
 */
function singularise(t: string): string {
  return t
    .split(" ")
    .map((w) => {
      if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
      // "bosses" -> "boss". Narrow on purpose: a general "es" rule would fold
      // "premises" and "expenses" into words that are not words.
      if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
      if (w.length <= 3 || w.endsWith("ss") || !w.endsWith("s")) return w;
      return w.slice(0, -1);
    })
    .join(" ");
}

/** The tenant's name, cleaned for display without being normalised to death. */
export function cleanName(s?: string | null): string {
  return String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A profession that can actually be booked. */
function bookable(p: ProfessionRec): boolean {
  return !p.deleted && p.id !== CREW_BOSS;
}

/**
 * Day-rate and hourly twins of the same machine. The pair is recognised from the
 * name — "(p/hr)" against "(Day Rate)" — rather than from a hardcoded id table, so
 * a twin added in OnSinch tomorrow is picked up without a code change.
 */
function rateForm(p: ProfessionRec): "hourly" | "day" | null {
  const n = normProf(p.name);
  if (/p\/hr|per hour|hourly/.test(n)) return "hourly";
  if (/day rate/.test(n)) return "day";
  return null;
}

/**
 * The machine, with the rate form stripped off — what makes two rows twins.
 *
 * The class code goes too: "Counterbalance B1 (p/hr)" pairs with " Counterbalance -
 * (Day Rate) ", which does not carry the B1. The marker that genuinely separates two
 * machines is the size — "U< 9M" against "O> 9M" — and that survives this.
 */
function machineKey(p: ProfessionRec): string {
  return normProf(p.name)
    .replace(/p\/hr|per hour|hourly|day rate/g, "")
    .replace(/\b[a-z]\d\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cues that the list cannot supply: the wordings clients actually use for a
 * profession whose stored name they would never type.
 *
 * The chief cue is first because "crew chief" contains "crew" — a chief asked for by
 * name was being booked as general crew, and then given a chief of its own on top.
 * Q10 is why "boss" is here at all: Crew Boss 55 is a real profession and the obvious
 * thing for it to resolve to, which is exactly why 55 is unreachable. The bands count
 * chiefs, and a 55 turns up counted as nobody.
 */
/**
 * ORDER IS THE RULE HERE, not a detail: the first cue that matches wins, so every
 * machine has to be asked about before the generic word it happens to contain.
 * "FLT drivers" resolved to Driver 9 — a van driver sent to run a forklift —
 * because `driver` sat above the plant cues. Anything naming a machine goes first
 * and `driver` is last of the vehicle cues.
 *
 * The vocabulary is not invented. It is what Spartan's clients actually write, read
 * off 27,830 real messages in data/corpus/sweep-threads.jsonl: crew chief 1835,
 * carpenter 682, rigging 413, forklift 380, chippy/chippie 608, ipaf 203, av tech
 * 164, counterbalance 149, telehandler 144, scissor lift 90, crew boss 84, flt 81,
 * steward 70, mewp 46, followspot 49, pasma 48, picker 29, cherry picker 25.
 */
const CUES: Array<[RegExp, number]> = [
  [/\bcrew chief\b|\bchief\b|\bcrew lead(er)?\b|\bcrew manager\b|\b(gang |crew )?boss\b/, PROFESSION.CREW_CHIEF],
  [/\bcscs\b/, PROFESSION.CSCS],
  [/\bchippy\b|\bcarpenter\b|\bjoiner\b|\bcarps\b/, PROFESSION.CARPENTER],
  /**
   * EVERY MEWP IS AN IPAF JOB. A cherry picker, a scissor lift, a boom lift, a
   * Genie and a "MEWP" are the same machine class under different trade names, and
   * operating one needs the card. The stored name is "IPAF 3a/3b", which contains
   * none of those words, so every one of them fell through to Crew — an IPAF job
   * staffed with general labour cannot legally proceed and the order looked normal.
   * IPAF 1b is a different card and outranks this by containment, as it should.
   */
  [/\bipaf\b|\bmewp\b|cherry ?picker|scissor ?lift|boom lift|spider lift|\bgenie\b/, PROFESSION.IPAF],
  [/\bpasma\b|tower scaffold/, PROFESSION.PASMA],
  // "forkie" and "FLT" are what the yard says; neither is in the tenant's name for it.
  [/\bforklift\b|\bfork lift\b|\bflt\b|\bforkie|\bcounterbalance\b/, 11],
  // Rough terrain BEFORE telehandler: "rough terrain telehandler" is a different
  // machine from the U<9M default, and the more specific reading has to be asked
  // about first or the generic word inside it answers.
  [/\brough terrain\b|\ball terrain\b/, 17],
  [/\btelehandler\b|\btele handler\b|\bteleporter\b/, 4],
  [/\bdriver\b|\bdriving\b/, PROFESSION.DRIVER],
  [/\bav\b|\baudio ?visual\b/, PROFESSION.AV],

  /**
   * THE TRADES THE TENANT ALREADY HAS AND THE RESOLVER WAS MISSING.
   *
   * Measured against 910 real client messages (2026-08-29): every one of these landed
   * on general Crew, which is worse than being flagged — the tenant holds the right
   * profession, at its own rate, and the booking silently took the general one.
   *
   * The tell is that the SAME REQUEST resolved differently depending on the word the
   * client happened to use: "serving staff" found 31 and "waiters" did not; "bar staff"
   * found 30 and "bartenders" did not. A client does not know which of their words is
   * the one in our list.
   *
   * Ordered before nothing in particular, except that `door supervisor` must be read as
   * security rather than as a chief — see the security line below, which sits ahead of
   * the supervisor cue for that reason.
   */
  [/\bdoor ?supervisors?\b|\bsecurity\b|\bsia\b/, PROFESSION.CREW],
  [/\bsupervisors?\b|\bcharge ?hands?\b/, PROFESSION.CREW_CHIEF],
  [/\bwait(?:ers?|resses?|ing ?staff)\b|\bserv(?:ers?|ing ?staff)\b/, 31],
  [/\bbar ?(?:staff|backs?|tenders?|persons?)\b|\bmixologists?\b/, 30],
  [/\bmarshals?\b|\bstewards?\b/, 52],
  [/\brope ?access\b|\bclimbers?\b|\birata\b/, 65],
  /**
   * NOT CUED, DELIBERATELY. Audio tech (13), Lighting tech (14), Host/Hostess (35) and
   * Dummy Tech (51) are all DELETED rows in the tenant, and `bookable()` refuses a
   * retired profession — so a cue pointing at one could never resolve and would only
   * claim a routing that cannot happen. Those words fall to standard Crew, which is the
   * right answer for as long as Spartan does not offer the trade.
   *
   * If any of them is un-retired in OnSinch, add the cue then; nothing else changes.
   */
];

/**
 * Words that mean "people", and nothing more specific.
 *
 * A hint made only of these landing on Crew is the RIGHT answer and must stay
 * silent. A hint carrying anything else and landing on Crew by default is a role
 * the resolver did not recognise, and that is a question for a human — see
 * `unrecognised` on ProfessionMatch.
 */
const GENERIC = new Set([
  "crew", "lad", "lads", "guy", "guys", "hand", "hands", "staff", "people", "person",
  "body", "bodies", "men", "man", "labour", "labor", "worker", "workers", "team",
  "personnel", "operative", "operatives", "temp", "temps", "helper", "helpers",
  "general", "member", "members", "extra", "extras", "cover", "casual", "casuals",
  // Trade words for untrained manual crew, and common in the real mail: porter 204,
  // stagehand/stage hand 157, local(s) is what a touring production calls hired crew.
  "porter", "porters", "stagehand", "stagehands", "stage", "loader", "loaders",
  "local", "locals", "site", "shift", "call",
  "x", "and", "or", "for", "the", "a", "of", "plus", "pax",
]);

/**
 * Q8(b): day rate at 8 hours or more, hourly below. Applied only where the resolved
 * profession HAS a twin — most professions have no rate forms at all and are
 * returned untouched.
 */
function applyRateForm(m: ProfessionMatch, list: ProfessionRec[], hours?: number): ProfessionMatch {
  const self = list.find((p) => p.id === m.id);
  const form = self ? rateForm(self) : null;
  if (!self || !form || hours === undefined) return m;

  const want: "hourly" | "day" = hours >= 8 ? "day" : "hourly";
  if (want === form) return m;

  const key = machineKey(self);
  const twin = list.find((p) => p.id !== self.id && machineKey(p) === key && rateForm(p) === want);
  if (!twin) return m;
  return { id: twin.id, name: cleanName(twin.name), why: m.why, rateInferred: true };
}

/**
 * Resolve a free-text hint to a profession id.
 *
 * `hours` is the length of the shift, used ONLY to choose between an hourly and a
 * day-rate twin of the same machine. Absent, the hourly form is kept, because hourly
 * is what the old static map always booked, and silently moving existing behaviour
 * onto a day rate is a billing change nobody asked for.
 */
export function resolveProfession(
  hint: string | undefined,
  professions: ProfessionRec[],
  opts: { hours?: number; aliasId?: number | null } = {}
): ProfessionMatch {
  const list = professions.filter(bookable);
  const byId = (id: number) => list.find((p) => p.id === id);
  let flagOut: (m: ProfessionMatch) => ProfessionMatch = (m) => m;
  const out = (p: ProfessionRec | undefined, why: ProfessionMatch["why"]): ProfessionMatch | null =>
    p ? flagOut(applyRateForm({ id: p.id, name: cleanName(p.name), why }, list, opts.hours)) : null;

  // A confirmed alias is the whole answer — that is what the store is for.
  if (opts.aliasId) {
    const hit = out(byId(opts.aliasId), "alias");
    if (hit) return hit;
  }

  const t = normProf(hint);
  /**
   * The abstention test, applied to whatever this function is about to return.
   *
   * Keyed on the ANSWER being general Crew, not on how it was reached — "rigging
   * crew" resolves by containment on the stored name "Crew", which is a `keyword`
   * match and looks like a success. It is the same miss as "rigger", and the client
   * named a trade in both.
   */
  const named = t.split(" ").some((w) => w && !GENERIC.has(w) && !/^\d+$/.test(w));
  flagOut = (m) =>
    m.id === PROFESSION.CREW && m.why !== "alias" && named ? { ...m, unrecognised: true } : m;
  const fallback = (): ProfessionMatch => flagOut({
    id: PROFESSION.CREW,
    name: cleanName(byId(PROFESSION.CREW)?.name) || "Crew",
    why: "default",
  });
  if (!t) return fallback();

  // Exact, on the tenant's own name or its alias.
  for (const p of list) {
    if (normProf(p.name) === t || (p.alias && normProf(p.alias) === t)) {
      const hit = out(p, "exact");
      if (hit) return hit;
    }
  }

  /**
   * Containment, LONGEST STORED NAME FIRST. "Crew" is a profession and so is "Crew
   * AV tech"; shortest-first resolves every one of them to Crew, which is the failure
   * the static map already had. A three-character name cannot claim anything.
   */
  /**
   * A request names the MACHINE, not the price list: "Telehandler O> 9M J3" never
   * carries the "(p/hr)" that is part of the stored name, so full-name containment
   * misses it and the cue answers with a crude default — the U<9M row, a different
   * machine. Matching on the machine identity as well, with the rate form and class
   * code stripped, is what actually lets the tenant's own wording resolve.
   */
  const contained = list
    .map((p) => {
      const full = normProf(p.name);
      const key = machineKey(p);
      const span = full.length >= 4 && t.includes(full) ? full.length
        : key.length >= 4 && t.includes(key) ? key.length
        : 0;
      return { p, span };
    })
    .filter((c) => c.span > 0)
    .sort((a, b) => b.span - a.span);

  // The written words first, then the same words with plurals folded. Order matters
  // only in that an exact wording is never reinterpreted to reach the folded pass.
  let cue: { id: number; span: number; text: string } | null = null;
  for (const candidate of [t, singularise(t)]) {
    for (const [re, id] of CUES) {
      const m = re.exec(candidate);
      if (!m) continue;
      cue = { id, span: m[0].length, text: m[0] };
      break;
    }
    if (cue) break;
  }

  /**
   * A stored name only beats a cue when it is a MORE SPECIFIC READING OF THE SAME
   * WORDS — that is, when the stored name contains the cue's own match. "MCR Crew
   * Chief" contains the chief cue and must stay 64: same words, more of them. "Crew
   * boss" is the opposite case — the only stored name inside it is "Crew", which
   * does not contain "boss" — and booking that as general labour loses the chief
   * entirely, so the cue wins.
   *
   * This was a raw span comparison, and a span comparison reads length for
   * specificity. It sent "FLT drivers" to Driver 9: the stored name "Driver" is six
   * characters against the FLT cue's three, so the longer word won and a van driver
   * was booked to run a forklift. Length is not the question. Whether the two
   * readings are about the same words is.
   */
  const best = contained[0];
  const storedRefinesCue = !!best && !!cue && normProf(best.p.name).includes(cue.text);
  if (best && (!cue || storedRefinesCue)) {
    const hit = out(best.p, "keyword");
    if (hit) return hit;
  }
  if (cue) {
    const hit = out(byId(cue.id), "cue");
    if (hit) return hit;
  }
  if (best) {
    const hit = out(best.p, "keyword");
    if (hit) return hit;
  }

  return fallback();
}

/** The line that goes on the ticket, so an inference is never silent (Q8, Q12). */
export function professionNote(hint: string | undefined, m: ProfessionMatch): string | null {
  if (m.why === "default" && !hint) return null;
  if (m.unrecognised) return `${UNRECOGNISED_MARK} — "${hint}" not recognised, booked as general Crew`;
  if (m.why === "default") return `profession not recognised in "${hint}" — booked as Crew`;
  const rate = m.rateInferred ? ", rate form inferred from the shift length" : "";
  return `profession "${hint}" -> ${m.id} ${m.name} (by ${m.why}${rate})`;
}
