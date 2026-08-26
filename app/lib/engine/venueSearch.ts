// ============================================================================
// Venue search: every place in the tenant, collapsed to buildings, ranked.
// ----------------------------------------------------------------------------
// Ben, 2026-08-25: venue matching must not come only from the alias store. Pull
// every location — "all 2000 some" — and rank them with edit distance and a
// properly designed matcher, then let a model adjudicate between what the alias
// store remembered and what the search found.
//
// THE 2,000 IS THE POINT AND IT IS NOT THE ROW COUNT. The tenant holds 6,859 place
// rows and 4,889 of them cannot locate a job: rows this engine created from a
// client's own text, with that text written into the name AND the address and
// nothing written into the postcode. Behind them are about 2,125 real buildings —
// 1,901 distinct postcodes. Ranking raw rows means ranking 800 ExCeL shells against
// each other and returning whichever scored highest, which is how "matched an
// existing row" came to mean "matched a row that cannot say where it is".
//
// So the index collapses rows into BUILDINGS first, and search returns buildings.
// One entry per building, carrying every spelling and alias the tenant holds for it,
// and one nominated row to actually book.
//
// HOW THE COLLAPSE IS DONE, AND HOW IT IS NOT. Grouping by "these names are similar
// and nothing contradicts" is the obvious rule and it is disqualified: applied
// transitively over this tenant it put the Royal Albert Hall, the British Museum,
// Oxford Circus and 3,406 other venues into one group of 3,409, because a row with
// no postcode contradicts nothing and subset-of chains. The key here is
// (full postcode, leading identifying word) and the postcode half is what makes it
// safe — the word "Grand" begins four unrelated venues in four different districts.
// Rows with no postcode anywhere stand alone rather than being guessed into a group.
// ============================================================================
import { normAddr } from "./resolve";
import { tokenise, postcodesIn, isAShell } from "./venueMatch";
import type { PlaceCandidate } from "./types";

/**
 * WORDINGS SPARTAN HAS RULED ON, because no amount of searching can settle them.
 *
 * A bare "Albert Hall" ranks Manchester's Albert Hall and London's Royal Albert Hall
 * about equally, and it should: both are real venues with that name in them. The venue
 * adjudicator did the correct thing and abstained —
 *
 *   "could refer to the Royal Albert Hall in London or the Albert Hall in Manchester.
 *    Without a city or postcode, there is not enough to choose."
 *
 * — and abstaining means provisioning a new row, so five of the 50 enquiries in the
 * 2026-08-26 study created a duplicate Albert Hall. Every venue miss in that study was
 * this one wording.
 *
 * That is not a matching problem, it is a missing business rule: which one does a
 * Spartan client mean when they do not say. Ben, 2026-08-26: "Albert Hall should default
 * to Royal Albert Hall."
 *
 * DETERMINISTIC AND AHEAD OF THE MODEL, deliberately. A ruling is not something to
 * re-litigate on every enquiry, and a model asked the same ambiguous question fifty times
 * will not answer it the same way fifty times. Expanding the text before the search means
 * the ordinary ranking finds the ordinary answer and the adjudicator is never consulted.
 *
 * KEYED ON A NAME, NEVER AN ID. Mapping to place 2 would hard-code one row of one
 * tenant's data into the engine and break silently the day that row is merged or
 * replaced. Rewriting the client's words to the venue's real name lets the existing
 * search do what it already does well.
 *
 * SCOPE IS THE WHOLE VALUE OF THIS TABLE. It holds wordings a person has decided, and
 * nothing else — it is not a place to fix matching that should be fixed in the matcher.
 * "The NEC" is the other known wording that resolves to nothing today; it is deliberately
 * absent because nobody has ruled on it, and guessing it here would be exactly the
 * overreach this comment exists to prevent.
 */
const RULED_WORDINGS: Array<{ when: RegExp; means: string; ruling: string }> = [
  {
    // Matches "Albert Hall" and "the Albert Hall" but NOT "Royal Albert Hall", which is
    // already unambiguous, and not "Albert Hall Manchester", where the client said which.
    when: /^(the\s+)?albert\s+hall$/i,
    means: "Royal Albert Hall",
    ruling: "Ben, 2026-08-26",
  },
];

/**
 * Apply Spartan's rulings to the client's wording. Returns the text unchanged when no
 * ruling covers it, plus a note when one did, so the ticket says a rule was applied
 * rather than appearing to have matched something it did not.
 */
export function applyRuledWording(text: string): { text: string; note?: string } {
  const t = String(text ?? "").trim();
  for (const r of RULED_WORDINGS) {
    if (r.when.test(t)) {
      return {
        text: r.means,
        note: `"${t}" is ambiguous and Spartan has ruled it means ${r.means} (${r.ruling})`,
      };
    }
  }
  return { text: t };
}

/** A real building, and every row the tenant holds for it. */
export interface Building {
  /** The row to actually book: richest active member, coordinates, then oldest id. */
  place_id: number;
  name: string;
  alias: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  /** Full postcode, normalised "OUT IN", when the building has one anywhere. */
  postcode: string | null;
  /** Every distinct spelling the tenant holds — what a client might have copied. */
  spellings: string[];
  /** Every distinct alias across the members. A shorthand often sits on one row. */
  aliases: string[];
  /** Member row ids, canonical first. */
  members: number[];
  /** True when not one member carries a postcode or coordinates. */
  unlocatable: boolean;
}

const richness = (p: PlaceCandidate) => {
  const q = p as PlaceCandidate & { lat?: unknown; lng?: unknown; note?: unknown; region?: unknown };
  return [p.address, p.city, p.zip, p.alias, q.lat, q.lng, q.note, q.region].filter(Boolean).length;
};
const hasCoords = (p: PlaceCandidate) => {
  const q = p as PlaceCandidate & { lat?: unknown; lng?: unknown };
  return !!(q.lat && q.lng);
};

/** The building's postcode, from the zip field or from its own name and address. */
function postcodeOf(p: PlaceCandidate): string | null {
  return postcodesIn(p.zip)[0] ?? postcodesIn(`${p.name ?? ""} ${p.address ?? ""} ${p.city ?? ""}`)[0] ?? null;
}

/** The first word that identifies rather than describes. "" when there is none. */
function leadToken(p: PlaceCandidate): string {
  return tokenise(p.name).strong[0] ?? "";
}

/**
 * Collapse the place list into buildings. Pure, and cheap enough to run per
 * enquiry — but the caller should cache it, because the place list already is.
 */
export function buildIndex(places: PlaceCandidate[]): Building[] {
  const groups = new Map<string, PlaceCandidate[]>();
  for (const p of places) {
    const pc = postcodeOf(p);
    const lead = leadToken(p);
    // No postcode, or nothing identifying in the name: stands alone. Guessing a
    // group for a row that says neither where it is nor what it is called is how a
    // real venue gets deleted for being a duplicate of something else.
    const key = pc && lead ? `${pc}|${lead}` : `solo|${p.id}`;
    const g = groups.get(key);
    if (g) g.push(p); else groups.set(key, [p]);
  }

  const out: Building[] = [];
  for (const g of groups.values()) {
    const ranked = [...g].sort((a, b) =>
      Number(b.active !== false) - Number(a.active !== false) ||
      richness(b) - richness(a) ||
      Number(hasCoords(b)) - Number(hasCoords(a)) ||
      Number(a.id) - Number(b.id)
    );
    const head = ranked[0];
    const spellings: string[] = [], aliases: string[] = [];
    for (const m of ranked) {
      const n = String(m.name ?? "").trim();
      if (n && !spellings.some((s) => normAddr(s) === normAddr(n))) spellings.push(n);
      const a = String(m.alias ?? "").trim();
      if (a && !aliases.some((s) => normAddr(s) === normAddr(a))) aliases.push(a);
    }
    out.push({
      place_id: Number(head.id),
      name: String(head.name ?? "").trim(),
      alias: head.alias ?? null,
      address: head.address ?? null,
      city: head.city ?? null,
      zip: head.zip ?? null,
      postcode: postcodeOf(head),
      spellings,
      aliases,
      members: ranked.map((m) => Number(m.id)),
      /**
       * CAN THIS BUILDING TELL A DRIVER WHERE TO GO — not "is every row a shell".
       * Row 826 "V&A East Storehouse" repeats its name as its address, so it is a
       * shell by that test, and it carries the postcode E20 3AX, so it locates a
       * job perfectly well. Conflating the two marked a usable building unusable.
       */
      unlocatable: !ranked.some((m) => m.zip || hasCoords(m)),
    });
  }
  return out;
}

// ---------------------------------------------------------------- distances
/**
 * Levenshtein, two rows rather than a full matrix.
 *
 * Bounded: once the best possible remaining distance exceeds `max` the answer
 * cannot beat it, so it returns early. Search compares one query against ~2,100
 * buildings and up to a dozen strings each, and an unbounded matrix over long
 * address strings is the difference between 3 ms and 300 ms per enquiry.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/** 1 for identical, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  if (!len) return 0;
  return 1 - levenshtein(a, b, len) / len;
}

/**
 * Jaro-Winkler, which Levenshtein needs beside it rather than instead of.
 *
 * Edit distance is length-sensitive in a way that punishes exactly the wordings
 * clients use: "RAH" against "Royal Albert Hall" is 14 edits out of 17 characters,
 * a similarity of 0.18, and it is the correct answer. Jaro-Winkler rewards a shared
 * prefix and shared characters regardless of length, so short forms and acronyms
 * score where edit distance cannot. Neither is sufficient alone.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const from = Math.max(0, i - window), to = Math.min(i + window + 1, b.length);
    for (let j = from; j < to; j++) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = bFlags[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let k = 0, transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ---------------------------------------------------------------- scoring
export interface VenueEvidence {
  /** The client's full postcode is this building's. Nothing beats it. */
  postcode_exact: boolean;
  /** Same district only. Survives a mistyped inward code. */
  outward_match: boolean;
  /** Both sides name a district and they differ. A veto, not a penalty. */
  postcode_conflict: boolean;
  /** The client's text IS one of the tenant's spellings, or an alias, normalised. */
  exact_spelling: boolean;
  exact_alias: boolean;
  /** Best normalised edit-distance similarity over spellings and aliases, 0..1. */
  levenshtein: number;
  /** Best Jaro-Winkler over the same, 0..1. Carries the short forms. */
  jaro: number;
  /** Share of the client's identifying words this building accounts for, 0..1. */
  token_covered: number;
  /** Share of the building's own identifying words the client said, 0..1. */
  token_reverse: number;
  /** A street number both sides state. What separates two High Streets. */
  street_number: boolean;
  /** Not one member row can locate a job. Ranked, but never silently. */
  unlocatable: boolean;
}

export interface VenueHit {
  building: Building;
  score: number;
  evidence: VenueEvidence;
}

/**
 * WEIGHTS ARE HAND-SET AND THAT IS DELIBERATE. There is no labelled corpus here
 * big enough to learn from — the gold set is a few dozen hand-labelled venue texts —
 * and a learned weight cannot be argued about in a review. Each number below is a
 * claim about what a piece of evidence is worth, and test/venueSearch.ts is where
 * the claim gets checked.
 *
 * Edit distance is weighted BELOW token agreement on purpose. "the albert hall"
 * against "Royal Albert Hall" is 6 edits in 17 characters, 0.65 similarity, while
 * the token view sees two of two identifying words present. Clients drop and add
 * whole words far more often than they mistype letters, so the word-level view is
 * the stronger signal and the character-level view is what catches the typos.
 */
const W = {
  postcode_exact: 0.60,
  outward: 0.22,
  exact_spelling: 0.55,
  exact_alias: 0.55,
  token_covered: 0.45,
  token_reverse: 0.20,
  levenshtein: 0.22,
  jaro: 0.14,
  street_number: 0.12,
  unlocatable_penalty: 0.30,
};

/** Best score of `f` over every spelling and alias the building holds. */
function bestOver(strings: string[], f: (s: string) => number): number {
  let best = 0;
  for (const s of strings) { const v = f(s); if (v > best) best = v; }
  return best;
}

const covered = (a: string[], b: string[]) =>
  a.length === 0 ? 0 : a.filter((x) => b.includes(x)).length / a.length;

export function scoreBuilding(text: string, b: Building): VenueHit | null {
  const q = tokenise(text);
  const qNorm = normAddr(text);
  if (!qNorm) return null;

  const names = [...b.spellings, ...b.aliases];
  const normNames = names.map(normAddr).filter(Boolean);
  const bTokens = tokenise([b.name, b.alias, b.address, b.city].filter(Boolean).join(" ")).strong;

  const qOut = q.postcodes.map((p) => p.split(" ")[0]);
  const bOut = b.postcode ? [b.postcode.split(" ")[0]] : [];

  const ev: VenueEvidence = {
    postcode_exact: !!b.postcode && q.postcodes.includes(b.postcode),
    outward_match: !(!!b.postcode && q.postcodes.includes(b.postcode)) && qOut.some((o) => bOut.includes(o)),
    postcode_conflict: qOut.length > 0 && bOut.length > 0 && !qOut.some((o) => bOut.includes(o)),
    exact_spelling: b.spellings.some((s) => normAddr(s) === qNorm),
    exact_alias: b.aliases.some((s) => normAddr(s) === qNorm),
    levenshtein: bestOver(normNames, (s) => similarity(qNorm, s)),
    jaro: bestOver(normNames, (s) => jaroWinkler(qNorm, s)),
    token_covered: covered(q.strong, bTokens),
    token_reverse: covered(tokenise([b.name, b.alias].filter(Boolean).join(" ")).strong, q.strong),
    street_number: q.numbers.some((n) => tokenise(b.address).numbers.includes(n)),
    unlocatable: b.unlocatable,
  };

  // TWO RECORDS IN DIFFERENT POSTCODE DISTRICTS ARE DIFFERENT BUILDINGS, however
  // alike the names. This is a veto rather than a penalty because no amount of name
  // agreement should be able to outvote it — it is what keeps "V&A East Storehouse"
  // away from the South Kensington museum.
  if (ev.postcode_conflict) return null;

  // Nothing identifying in common at all. A shared building-type word ("Conference
  // Centre") would otherwise let every venue match every other.
  const anyIdentity = ev.postcode_exact || ev.exact_spelling || ev.exact_alias ||
    q.strong.some((w) => bTokens.includes(w));
  if (!anyIdentity) return null;

  let s =
    W.token_covered * ev.token_covered +
    W.token_reverse * ev.token_reverse +
    W.levenshtein * ev.levenshtein +
    W.jaro * ev.jaro;
  if (ev.postcode_exact) s += W.postcode_exact;
  else if (ev.outward_match) s += W.outward;
  /**
   * THE EXACT-MATCH BONUS IS ONLY FOR A BUILDING THAT CAN BE FOUND.
   *
   * A shell matches the client's wording exactly BECAUSE the client's wording is
   * what created it. Paying 0.55 for that puts every shell above the real record it
   * duplicates: a bare "Excel" row scored 1.26 against ExCeL London's 0.87 and won,
   * which is the entire failure this file exists to end. Word and character
   * agreement still count for an unlocatable building; being literally named after
   * the query does not.
   */
  if (!ev.unlocatable) {
    if (ev.exact_spelling) s += W.exact_spelling;
    else if (ev.exact_alias) s += W.exact_alias;
  }
  if (ev.street_number) s += W.street_number;
  // Ranked, but last: a building nothing can locate is a poor answer even when it is
  // the only textual match, and the caller is told rather than left to notice.
  if (ev.unlocatable) s -= W.unlocatable_penalty;

  return { building: b, score: s, evidence: ev };
}

export interface VenueSearchResult {
  hits: VenueHit[];
  /** Buildings considered — the "all 2000 some" figure, for the log. */
  searched: number;
}

/** Rank every building against the client's text. Deterministic, no network. */
export function searchVenues(text: string | undefined, index: Building[], limit = 8): VenueSearchResult {
  const hits: VenueHit[] = [];
  for (const b of index) {
    const h = scoreBuilding(String(text ?? ""), b);
    if (h && h.score > 0) hits.push(h);
  }
  hits.sort((a, b) =>
    b.score - a.score ||
    Number(a.building.unlocatable) - Number(b.building.unlocatable) ||
    a.building.place_id - b.building.place_id
  );
  return { hits: hits.slice(0, limit), searched: index.length };
}
