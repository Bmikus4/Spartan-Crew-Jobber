// ============================================================================
// Venue resolution, second pass — the one that runs when matchPlace finds nothing.
// ----------------------------------------------------------------------------
// A venue miss is not a null. It PROVISIONS A NEW PLACE. That is how the tenant
// came to hold 632 rows for ExCeL, 221 for Olympia and 221 for the NEC: every time
// a client used a nickname the matcher did not know, the engine created a row.
//
// The 100-case study missed 26. The mechanism is visible in resolve.ts: every tier
// there asks for exact equality or containment in ONE direction. "the albert hall"
// neither equals nor contains "royal albert hall", and "royal albert hall" does not
// start with "the albert hall", so nothing fires. There is no token-level
// comparison, no stop-word handling, and no notion of partial agreement.
//
// THIS RUNS ONLY AFTER matchPlace RETURNS NULL, and that is a deliberate choice
// rather than a staged rollout.
//
// matchPlace carries real scar tissue — a four-character floor, a postcode/street-
// number discriminator that stopped crew being sent to a Walthamstow library, an
// active-row preference, a richest-record-wins rule for the 3,000 context-free
// duplicates. Every one of those was paid for. Replacing it would put all of that
// back at risk to fix a failure that only occurs where it already answers null. So
// this cannot change any answer matchPlace gets right; it can only turn a
// provisioned duplicate into a match, or leave it exactly as it was.
//
// It is deterministic, it makes no network calls and it runs over the place list
// the engine has already pulled. There is no index to build and no model to ask:
// the three misses the study named — "O2 arena", "excel docklands", "the albert
// hall" — are token-overlap problems, and a model call to solve them would be
// ceremony. Whether an escalation step is needed at all is a question to answer
// with the numbers this produces, not before.
// ============================================================================
import { normAddr, placeContext } from "./resolve";
import type { PlaceCandidate } from "./types";

/**
 * Words that identify nobody. "the albert hall" against "Royal Albert Hall" fails
 * on a leading article, which is the whole of the difference between a match and a
 * duplicate row.
 *
 * CITIES ARE IN HERE, and "london" is the important one. It appears in thousands of
 * rows, and a bare city name is a live defect in this codebase: "O2 London" once
 * resolved to a place whose entire name is "London". A city can confirm a match; it
 * can never make one.
 */
const STOP = new Set([
  "the", "a", "an", "at", "in", "on", "of", "and", "for", "to", "our", "your",
  "ltd", "limited", "llp", "plc", "uk", "gb", "united", "kingdom", "england",
  "london", "greater", "city", "st", "nr", "near", "venue", "site", "address",
]);

/**
 * Words that describe what kind of building it is. They agree far too often to
 * carry a match on their own — half the tenant's rows contain one — but dropping
 * them entirely loses the difference between "Olympia Grand Hall" and "Olympia
 * West", so they count at a fraction.
 */
const WEAK = new Set([
  "arena", "centre", "center", "hall", "halls", "stadium", "park", "hotel", "rooms",
  "room", "house", "exhibition", "conference", "complex", "ground", "grounds",
  "theatre", "theater", "gardens", "garden", "club", "building", "campus", "court",
  "studio", "studios", "gallery", "museum", "school", "college", "church", "dock",
  "docks", "docklands", "quay", "wharf", "square", "street", "road", "lane", "way",
  "avenue", "place", "gate",
  // Compass words are deliberately NOT here. "Olympia West" and "Olympia London"
  // are different halls and folding "west" into a building-type word would make
  // them the same token set — the clustering hazard this design was warned about.
]);

/**
 * The official UK postcode pattern, not a hand-rolled one.
 *
 * A validated postcode is a different CLASS of evidence from free text — it is the
 * single strongest key there is for a building, and two records in different
 * postcode districts are different buildings however similar their names. Getting
 * the pattern subtly wrong would quietly downgrade the best evidence available, so
 * this is the published form rather than something that looks about right.
 */
const POSTCODE =
  /\b(GIR ?0AA|[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2})\b/gi;

/** Postcodes in a string, normalised to "OUT IN" (uppercase, single space). */
export function postcodesIn(s?: string | null): string[] {
  const out: string[] = [];
  for (const m of String(s ?? "").toUpperCase().matchAll(POSTCODE)) {
    const raw = m[1].replace(/\s+/g, "");
    const pc = `${raw.slice(0, -3)} ${raw.slice(-3)}`;
    if (!out.includes(pc)) out.push(pc);
  }
  return out;
}

/** The outward half — "E16", "SW7". Coarse, and it survives a mistyped inward. */
const outward = (pc: string) => pc.split(" ")[0];

interface Tokens {
  /** Words that identify this venue: not stop-words, not building types. */
  strong: string[];
  /** Building-type words, kept because they separate two venues that share a name. */
  weak: string[];
  postcodes: string[];
  /** A street number, which is what separates one High Street from another. */
  numbers: string[];
}

export function tokenise(text?: string | null): Tokens {
  const postcodes = postcodesIn(text);
  // The postcode is removed before tokenising so "E16" and "1XL" do not turn up as
  // ordinary words and agree with every other address in the district.
  let t = String(text ?? "");
  for (const pc of postcodes) t = t.replace(new RegExp(pc.replace(" ", " ?"), "gi"), " ");
  const words = normAddr(t).split(" ").filter(Boolean);
  const strong: string[] = [];
  const weak: string[] = [];
  const numbers: string[] = [];
  for (const w of words) {
    if (/^\d+$/.test(w)) { numbers.push(w); continue; }
    if (STOP.has(w)) continue;
    if (WEAK.has(w)) { if (!weak.includes(w)) weak.push(w); continue; }
    if (w.length < 2) continue;
    if (!strong.includes(w)) strong.push(w);
  }
  return { strong, weak, postcodes, numbers };
}

/** Everything a stored row says about itself, as one token set. */
function placeTokens(p: PlaceCandidate): Tokens {
  return tokenise([p.name, p.alias, p.address, p.city, p.zip].filter(Boolean).join(" "));
}

/** What the row calls ITSELF — name and alias, without the address. */
function identityTokens(p: PlaceCandidate): string[] {
  return tokenise([p.name, p.alias].filter(Boolean).join(" ")).strong;
}

/**
 * A MATCH MADE ENTIRELY OUT OF A CITY NAME, which is not a match.
 *
 * "Birmingham" agrees with the NEC because the NEC's city is Birmingham, and with
 * several hundred other rows for the same reason. "O2 London" once resolved to a
 * place whose entire name is "London". A city can confirm a building; it can never
 * identify one, and the difference is whether the agreement touches anything the
 * row calls itself.
 *
 * Exported because matchPlace answers these too, and its containment tiers cannot
 * see the difference — this is the guard applied to ITS answer as well as to this
 * file's, which is the only way the defect actually closes.
 */
/**
 * A CONTEXT-FREE DUPLICATE — a row that knows only what the client typed.
 *
 * About 3,000 of the tenant's 6,864 places are these, and this engine created every
 * one of them: a venue it failed to match was provisioned with the client's own text
 * as both its name and its address, no postcode, no coordinates. 632 of them are
 * ExCeL.
 *
 * They are worse than a miss, because they make the NEXT miss look like a success.
 * "O2 Arena" is now an exact name match — against a row whose address is the words
 * "O2 Arena" and which cannot tell a driver where to go — so the matcher stops
 * before it ever reaches the real O2. The study's own residue does this: five rows
 * it left behind on 2026-08-24 now intercept three of the venues it was measuring.
 *
 * Recognising them costs nothing and defuses all 3,000 without deleting anything.
 */
export function isAShell(p: PlaceCandidate): boolean {
  const name = normAddr(p.name);
  if (!name) return true;
  // Its address is its own name: nothing was known, so the text was copied twice.
  if (normAddr(p.address) === name) return true;
  // Nothing that locates it at all.
  return !p.zip && !p.city && !p.address;
}

export function matchedOnCityAlone(text: string | undefined, p: PlaceCandidate): boolean {
  const q = tokenise(text);
  if (!q.strong.length) return true; // nothing identifying was written at all
  if (q.postcodes.length) return false; // a postcode is never a city name
  const identity = identityTokens(p);
  const street = tokenise(p.address).strong;
  return !q.strong.some((w) => identity.includes(w) || street.includes(w));
}

export interface VenueEvidence {
  /** Full postcode agreement. The strongest single key there is. */
  postcode_exact: boolean;
  /** Same district. Survives a mistyped inward code. */
  outward_match: boolean;
  /** Both carry a postcode and they are in DIFFERENT districts — a veto. */
  postcode_conflict: boolean;
  /** How much of what the client wrote the candidate accounts for, 0..1. */
  strong_covered: number;
  /** How much of the candidate the client accounted for, 0..1. Guards a shell row. */
  strong_reverse: number;
  /**
   * The candidate's NAME or ALIAS, on its own, says exactly what the client said.
   *
   * This is the evidence that separates "The O2" from "O2 Academy Brixton" for a
   * client who wrote "O2 arena". Both contain the client's only identifying token,
   * so token coverage alone puts them within a hair of each other; only one of them
   * is CALLED that. Weighted heavily because a name that matches with nothing left
   * over is close to an exact match that punctuation defeated.
   */
  name_is_the_query: boolean;
  weak_covered: number;
  street_number_match: boolean;
  /** placeContext: how much the record actually knows. */
  context: number;
  active: boolean;
}

export interface VenueCandidate {
  id: number;
  name: string;
  score: number;
  evidence: VenueEvidence;
}

export interface VenueResolution {
  decision: "match" | "ambiguous" | "none";
  place_id: number | null;
  /** Ranked, best first. Short — what an escalation step would be handed. */
  candidates: VenueCandidate[];
  /** One line for the ticket, so a resolution is never silent. */
  note: string | null;
}

/**
 * WEIGHTS ARE HAND-SET, and that is the point.
 *
 * There is no labelled corpus here big enough to learn from — the gold set is 40-odd
 * hand-labelled venue texts — and a learned weight cannot be argued about in a
 * review. A hand-set one can: every number below is a claim about what evidence is
 * worth, and test/venueGold.ts is where the claim is checked.
 */
const W = {
  postcode_exact: 0.55,
  outward: 0.25,
  street_number: 0.15,
  strong_covered: 0.60,
  strong_reverse: 0.20,
  weak: 0.08,
  name_is_the_query: 0.35,
};

/**
 * Accept only a CLEAR winner. Confidence is the margin, not the top score: two
 * ExCeL shells at 0.9 each is ambiguity, not certainty.
 */
const ACCEPT = 0.55;
const MARGIN = 0.10;

/** How much of `a` is covered by `b`. */
const covered = (a: string[], b: string[]) =>
  a.length === 0 ? 0 : a.filter((x) => b.includes(x)).length / a.length;

function score(ev: VenueEvidence): number {
  if (ev.postcode_conflict) return 0;
  let s =
    W.strong_covered * ev.strong_covered +
    W.strong_reverse * ev.strong_reverse +
    W.weak * ev.weak_covered;
  if (ev.postcode_exact) s += W.postcode_exact;
  else if (ev.outward_match) s += W.outward;
  if (ev.street_number_match) s += W.street_number;
  if (ev.name_is_the_query) s += W.name_is_the_query;
  return s;
}

/**
 * Resolve a venue string against the place list, by token agreement.
 *
 * Returns `none` freely. Sending crew to the wrong building is worse than creating
 * a duplicate row, and provisioning is the right answer for a venue the tenant
 * genuinely does not hold — 25 of the study's 100 cases were brand-new venues.
 */
export function matchPlaceV2(
  locationText: string | undefined,
  places: PlaceCandidate[]
): VenueResolution {
  const q = tokenise(locationText);
  const none: VenueResolution = { decision: "none", place_id: null, candidates: [], note: null };
  // Nothing identifying was written. A bare "London" or "the venue" resolves to
  // nothing on purpose — a city can confirm a match, never make one.
  if (!q.strong.length && !q.postcodes.length) return none;

  const anyActive = places.some((p) => p.active !== false);
  const scored: VenueCandidate[] = [];
  for (const p of places) {
    const c = placeTokens(p);
    const shareStrong = q.strong.some((w) => c.strong.includes(w));
    const sharePostcode = q.postcodes.some((pc) => c.postcodes.includes(pc));
    // A candidate must agree on something that IDENTIFIES a building. Weak-word
    // agreement alone would let every "Conference Centre" match every other, and
    // city agreement alone would let every venue in Birmingham match every other.
    if (!shareStrong && !sharePostcode) continue;
    if (!sharePostcode && matchedOnCityAlone(locationText, p)) continue;

    const qOut = q.postcodes.map(outward);
    const cOut = c.postcodes.map(outward);
    const ev: VenueEvidence = {
      postcode_exact: sharePostcode,
      outward_match: !sharePostcode && qOut.some((o) => cOut.includes(o)),
      // Both sides named a district and they disagree: different buildings, however
      // alike the names. This is the rule that keeps "V&A East Storehouse" away from
      // the South Kensington museum.
      postcode_conflict:
        qOut.length > 0 && cOut.length > 0 && !qOut.some((o) => cOut.includes(o)),
      strong_covered: covered(q.strong, c.strong),
      /**
       * Read off the NAME and ALIAS, never the address. A row that carries its
       * street and its postcode would otherwise be punished for knowing more than
       * the shell beside it — precisely backwards, since the rich row is the one
       * worth booking crew to.
       */
      strong_reverse: covered(identityTokens(p), q.strong),
      name_is_the_query:
        q.strong.length > 0 &&
        [p.name, p.alias].some((n) => {
          const t = tokenise(n).strong;
          return t.length === q.strong.length && t.every((w) => q.strong.includes(w));
        }),
      weak_covered: covered(q.weak, c.weak),
      street_number_match: q.numbers.some((n) => c.numbers.includes(n)),
      context: placeContext(p),
      active: p.active !== false,
    };
    const s = score(ev);
    if (s <= 0) continue;
    scored.push({ id: p.id, name: String(p.name ?? ""), score: s, evidence: ev });
  }
  if (!scored.length) return none;

  /**
   * COLLAPSE THE DUPLICATES BEFORE READING THE MARGIN.
   *
   * 632 rows are ExCeL. Without this the runner-up to the real ExCeL row is always
   * another ExCeL row, so the margin rule would refuse every one of the tenant's
   * biggest venues — the rule meant to protect against ambiguity would instead be
   * defeated by duplication.
   *
   * Two rows are the SAME BUILDING when neither contradicts the other: their
   * postcode districts agree (or one of them has none), and one's identifying words
   * are a subset of the other's. "Excel" and "ExCeL London, 1 Western Gateway, E16
   * 1XL" are one building said at two levels of detail. "Olympia London" and
   * "Olympia West" are not, because "west" is an identifying word here and neither
   * set contains the other.
   *
   * Greedy from the top of the ranking rather than a global clustering pass: the
   * question is only ever "is the runner-up a different building from the winner",
   * and a global cluster key has to be right for 6,853 rows at once to answer it.
   *
   * WITHIN a building the RICHEST ACTIVE ROW WINS, which is matchPlace's own rule.
   * It is the half that matters most: the shells match the client's words better
   * than the real row does, because the client's words are what made them, so
   * ranking on agreement alone books crew to a row carrying no address at all.
   */
  const sameBuilding = (a: VenueCandidate, b: VenueCandidate): boolean => {
    const ta = placeTokens(places.find((x) => x.id === a.id)!);
    const tb = placeTokens(places.find((x) => x.id === b.id)!);
    const oa = ta.postcodes.map(outward);
    const ob = tb.postcodes.map(outward);
    if (oa.length && ob.length && !oa.some((o) => ob.includes(o))) return false;
    const subset = (x: string[], y: string[]) => x.length > 0 && x.every((w) => y.includes(w));
    return subset(ta.strong, tb.strong) || subset(tb.strong, ta.strong);
  };

  scored.sort((a, b) => b.score - a.score || b.evidence.context - a.evidence.context || a.id - b.id);
  const heads: VenueCandidate[] = [];
  const taken = new Set<number>();
  for (const c of scored) {
    if (taken.has(c.id)) continue;
    const group = scored.filter((x) => !taken.has(x.id) && (x.id === c.id || sameBuilding(c, x)));
    for (const g of group) taken.add(g.id);
    const head = [...group].sort((a, b) => {
      const act = Number(b.evidence.active && anyActive) - Number(a.evidence.active && anyActive);
      if (act) return act;
      /**
       * A SHELL NEVER SPEAKS FOR ITS BUILDING while a real row is in the group.
       * This must outrank even the row the client named, because the shell IS the
       * row the client named — it was made out of those exact words. "The Albert
       * Hall" would otherwise resolve to the address-less row the engine created
       * last month rather than to the Royal Albert Hall standing beside it.
       */
      const real = Number(!isAShell(places.find((x) => x.id === b.id)!)) -
                   Number(!isAShell(places.find((x) => x.id === a.id)!));
      if (real) return real;
      /**
       * A row CALLED what the client called it speaks for the building before the
       * richest row does. Olympia West (1002) and Olympia London (57) carry the
       * same address and the same postcode — they are one site, and merging them is
       * right — but a client who wrote "Olympia West" named a hall, and booking the
       * generic row because it happens to carry an alias throws that away.
       */
      const named = Number(b.evidence.name_is_the_query) - Number(a.evidence.name_is_the_query);
      if (named) return named;
      if (b.evidence.context !== a.evidence.context) return b.evidence.context - a.evidence.context;
      return a.id - b.id;
    })[0];
    // The BUILDING scores what its best-agreeing row scored; the row that speaks for
    // it is the one that knows where it is. Those are two different questions and
    // conflating them is what put the shells on top.
    heads.push({ ...head, score: Math.max(...group.map((g) => g.score)) });
  }
  heads.sort((a, b) => b.score - a.score || b.evidence.context - a.evidence.context || a.id - b.id);

  const candidates = heads.slice(0, 8);

  const top = heads[0];
  const runnerUp = heads[1];

  if (top.score < ACCEPT) {
    return { decision: "none", place_id: null, candidates, note: null };
  }
  if (runnerUp && top.score - runnerUp.score < MARGIN) {
    return {
      decision: "ambiguous",
      place_id: null,
      candidates,
      note: `venue "${locationText}" is ambiguous — ${candidates
        .slice(0, 3)
        .map((c) => `${c.id} ${c.name.trim()}`)
        .join(" / ")}`,
    };
  }
  return {
    decision: "match",
    place_id: top.id,
    candidates,
    note: `venue "${locationText}" matched ${top.id} ${top.name.trim()} by token agreement — no exact or containment match existed`,
  };
}
