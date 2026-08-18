// ============================================================================
// resolve — Tool 2's dedup core. OnSinch search is limited and non-fuzzy, so we
// pull the WHOLE list (companies/places/clients) and match EXACTLY client-side.
// Pure functions: given already-pulled records, decide the id (or "not found").
// This is what enforces:
//   - never create a duplicate company / place / contact (reuse exact matches)
//   - never create a second job for an existing one (order dedup)
// ============================================================================
import type { PlaceCandidate } from "./types";

/** Company/venue name normalisation: drop legal suffixes + punctuation. */
export function normName(s?: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|inc|co|company)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Address normalisation: punctuation/whitespace only (keep the tokens). */
export function normAddr(s?: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface CompanyRec {
  id: number;
  name?: string;
  invoice_name?: string;
  /** Contacts, when the list was pulled with=Client. The domain source below. */
  Client?: Array<{ id: number; email?: string }>;
  /** OnSinch's own fields for the client's web and billing addresses. */
  www?: string;
  email_invoice?: string;
}

/**
 * Mailbox domains that belong to a person, not to a business. A match on one of
 * these would attach every gmail.com sender to whichever client happened to have
 * a personal address on file.
 */
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "live.co.uk", "live.com",
  "aol.com", "btinternet.com", "msn.com", "sky.com", "protonmail.com",
]);

const domainOfEmail = (e?: string): string => {
  const d = String(e || "").toLowerCase().trim().split("@")[1] || "";
  return d.replace(/>$/, "").trim();
};

/**
 * Which company an email address belongs to, from the addresses OnSinch already
 * holds for each client's contacts.
 *
 * THE SIGNAL THE RESOLVER WAS THROWING AWAY. Every email carries its sender's
 * domain, it costs nothing, and unlike a company name read out of prose it cannot
 * be phrased differently. Measured on the live tenant: 763 companies carry 1,274
 * contacts across 708 distinct domains, and 96.5% of those domains point at
 * exactly one company. Over the 84 tickets on the live board it resolved 17 the
 * name matcher could not, and disagreed with it zero times — it fires precisely
 * where the model failed to extract a company name at all, which is why it is
 * complementary rather than a second opinion.
 *
 * Ambiguous domains resolve to nothing: 25 domains carry two companies, usually a
 * client with a second trading entity, and picking one would be a coin flip on
 * whose account a booking lands.
 *
 * `www` and `email_invoice` are deliberately NOT used. They look like the same
 * signal and are much weaker: only 275 companies carry a www at all, and the
 * field misses the biggest clients outright — eventconcept.com resolves from a
 * contact address and not from any www.
 */
export function matchCompanyByDomain(email: string | undefined, companies: CompanyRec[]): number | null {
  const d = domainOfEmail(email);
  if (!d || !d.includes(".") || CONSUMER_DOMAINS.has(d)) return null;
  // Spartan's own domain maps to six internal companies; a colleague's address is
  // never evidence about which client an enquiry is for.
  if (SPARTAN_DOMAINS.some((s) => d === s || d.endsWith("." + s))) return null;

  const hits = new Set<number>();
  for (const c of companies) {
    for (const cl of c.Client ?? []) {
      if (domainOfEmail(cl.email) === d) { hits.add(c.id); break; }
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** Kept in step with normalize.ts's list; duplicated to keep resolve.ts dependency-free. */
const SPARTAN_DOMAINS = ["spartancrew.co.uk"];
export interface ClientRec { id: number; email?: string; name?: string; surname?: string }

/** Fold a trailing plural, leaving "ss" alone ("press" is not "pres"). */
const foldPlural = (w: string) =>
  w.length >= 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

/**
 * Tokens worth matching on: drops noise and single letters, and folds a trailing
 * plural so "Bigabox Productions" reaches "Bigabox Production Ltd".
 */
const tokensOf = (s: string) =>
  s
    .split(" ")
    .filter((w) => w.length >= 3)
    .map(foldPlural);

/**
 * Words that describe this industry rather than identify a business. A name whose
 * only substantive token is one of these cannot carry a match on its own.
 *
 * FOLDED THROUGH THE SAME PLURAL RULE THE TOKENS ARE. Membership is tested against
 * a token that has already been singularised, so a word listed here only in its
 * plural form is never actually consulted: "solutions" folds to "solution", which
 * was not in the list, so a single "solution" token counted as identifying. Live,
 * that resolved "Innovate Solutions Ltd" to company 355, "d&b solutions UK Ltd" —
 * whose only substantive token is that same word. A wrong company is the worst
 * answer this function can give, because it attaches a real booking to another
 * client's account, and it is the one outcome the ambiguity guard exists to avoid.
 *
 * test/companyMatch.ts asserts that exact name resolves to null and passed
 * throughout, because its 14-company fixture contained no other "solutions"
 * business. A denylist can only be tested against a list that includes the rival.
 */
const GENERIC = new Set(
  [
    "films", "film", "events", "event", "production", "productions", "media",
    "group", "services", "service", "solutions", "design", "studio", "studios",
    "crew", "staff", "staffing", "creative", "projects", "project", "live",
    "london", "international", "global", "the", "and",
  ].flatMap((w) => [w, foldPlural(w)])
);

/**
 * Company match: exact on name or invoice_name first, then a narrow token-subset
 * fallback.
 *
 * Exact-only was the whole rule, and it is the right rule for WRITES — it is what
 * stops the engine creating a duplicate company. But it was also the only rule for
 * READS, so a client who signs off with their full legal name did not resolve and
 * the thread went to needs-human as a "new company". Six of the first nine
 * needs-human tickets were blocked this way, and four of those companies already
 * existed, each missing by one word: "eclipse presentations" vs "eclipse",
 * "we are family london" vs "we are family", "bigabox productions" vs "bigabox
 * production", "storyhouse" vs "storyhouse design and production".
 *
 * The dangerous direction is a WRONG match — it attaches a real order to the wrong
 * client, which is worse than leaving it for a human. So the fallback is bounded:
 *
 *  - every substantive token of the shorter name must appear in the longer one,
 *    so "We Are Family London" cannot reach "We Are Brd";
 *  - the shorter side must carry real weight (2+ tokens, or one of 5+ characters),
 *    so a 3-letter record like "RTS" cannot claim "RTS Productions Ltd";
 *  - it resolves ONLY when exactly one company qualifies. Two candidates means
 *    ambiguous means human — never a coin flip.
 */
export function matchCompany(name: string | undefined, companies: CompanyRec[]): number | null {
  const t = normName(name);
  if (!t) return null;

  const exact = companies.find((c) => normName(c.name) === t || normName(c.invoice_name) === t);
  if (exact) return exact.id;

  const want = tokensOf(t);
  if (!want.length) return null;

  /**
   * A single token can only carry a match if it actually identifies somebody.
   * "storyhouse" does; "films" does not — matching on it alone made
   * "O Films International" resolve to "O Films", and would have matched any
   * company in the industry.
   */
  const substantial = (toks: string[]) =>
    toks.length >= 2 || (toks.length === 1 && toks[0].length >= 5 && !GENERIC.has(toks[0]));

  // How many tokens the two names share, or 0 if it is not a subset match.
  const overlap = (c: CompanyRec): number => {
    let best = 0;
    for (const stored of [normName(c.name), normName(c.invoice_name)]) {
      if (!stored) continue;
      const have = tokensOf(stored);
      if (!have.length) continue;
      const [shortSide, longSide] = have.length <= want.length ? [have, want] : [want, have];
      if (!substantial(shortSide)) continue;
      const set = new Set(longSide);
      if (shortSide.every((w) => set.has(w))) best = Math.max(best, shortSide.length);
    }
    return best;
  };

  const scored = companies.map((c) => ({ c, n: overlap(c) })).filter((x) => x.n > 0);
  if (!scored.length) return null;

  // The most specific match wins: for "Acme Events Group", "Acme Events" beats
  // "Acme". A genuine TIE is ambiguous and belongs to a human, never a coin flip.
  const top = Math.max(...scored.map((x) => x.n));
  const winners = scored.filter((x) => x.n === top);
  if (winners.length === 1) return winners[0].c.id;

  /**
   * Word ORDER breaks a tie that a bag of words cannot. Live: "Wall to Wall" tied
   * against "Wall to Wall Media Limited" and "North Wall Production", because as an
   * unordered set both merely contain "wall". Read as a phrase only one of them is
   * this client, and it is not close.
   *
   * Deliberately weaker than everything above it and used ONLY to separate names
   * already judged equally specific: it runs on the normalised string, so short
   * connecting words the token filter drops ("to", "of", "&") are back in play and
   * carry their share of the evidence. If more than one candidate still contains
   * the phrase, that is a real ambiguity and it stays a human's.
   */
  const phrase = ` ${t} `;
  const contiguous = winners.filter((x) =>
    [normName(x.c.name), normName(x.c.invoice_name)].some((s) => s && ` ${s} `.includes(phrase))
  );
  return contiguous.length === 1 ? contiguous[0].c.id : null;
}

/**
 * Exact place match. A location string from an email ("2 Savoy Place, London
 * WC2R 0BL") should match a stored place whose address is "2 savoy place …".
 * We match on: name equality, address equality, or one normalised address fully
 * containing the other (with a length guard so short fragments can't collide).
 */
/**
 * How much a place record actually tells you. The live tenant holds 632 rows named
 * "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL" with every
 * other field null, beside ONE row named "ExCel London" carrying the address, the
 * alias, the postcode and the coordinates. They are the same building; only one of
 * them is worth booking crew to.
 */
export function placeContext(p: PlaceCandidate): number {
  const q = p as PlaceCandidate & { lat?: unknown; lng?: unknown; note?: unknown; region?: unknown };
  return [p.address, p.city, p.zip, p.alias, q.lat, q.lng, q.note, q.region].filter(Boolean).length;
}

export function matchPlace(locationText: string | undefined, places: PlaceCandidate[]): number | null {
  const t = normAddr(locationText);
  if (!t || t.length < 4) return null;

  /**
   * Retired venues are skipped. 12 of the 6,847 live places are inactive —
   * "InterContinental London - the O2", "Battersea Evolution", "Woolwich Works" —
   * and resolving a new job onto one puts crew at an address Spartan no longer
   * works, silently, because nothing downstream re-checks the venue.
   *
   * Only when there is an active alternative, though: an inactive place is still a
   * better answer than inventing a duplicate of a venue that already exists.
   */
  const anyActive = places.some((p) => p.active !== false);

  /**
   * Every match is collected and the richest one wins, rather than returning the
   * first row the list happens to hold. 3,000 of the 6,847 places are context-free
   * duplicates of about 20 real venues — 632 ExCeL, 221 Olympia, 221 NEC — all of
   * them active, so "first active hit" was really "whichever page it landed on".
   * Ben, 2026-08-18: keep the one with the most context attached.
   *
   * CONTEXT OUTRANKS TIER, which is the part that is easy to get backwards. The
   * shells match the client's text exactly, because the client's text is what made
   * them; the real ExCeL row only matches by containment, because it is named
   * "ExCeL London" and the email says the whole address. Ranking by how the match
   * was made picks the shell every time. How much the record knows is the question,
   * and the tier only separates rows that know the same amount.
   */
  let best: { tier: number; ctx: number; id: number } | null = null;
  const consider = (p: PlaceCandidate, tier: number) => {
    const cand = {
      tier,
      // An active row beats an inactive one before richness is even read.
      ctx: (anyActive && p.active !== false ? 1000 : 0) + placeContext(p),
      id: p.id,
    };
    if (
      !best ||
      cand.ctx > best.ctx ||
      (cand.ctx === best.ctx && cand.tier < best.tier) ||
      // A tie on both is settled by the oldest id: it is the row the tenant's own
      // history is most likely already hanging off.
      (cand.ctx === best.ctx && cand.tier === best.tier && cand.id < best.id)
    ) best = cand;
  };

  for (const p of places) {
    const name = normAddr(p.name);
    if (name && name === t) { consider(p, 0); continue; }
    /**
     * The ALIAS field, which this matcher never read. 356 places carry one and it
     * is exactly the short form a client types: "Royal Albert Hall" ~ "RAH",
     * "Glastonbury Festival - Workers Campsite" ~ "Glastonbury Festival",
     * "Anna Valley Ltd" ~ "Anna Valley HQ - Feltham". OnSinch has a field for the
     * name people actually use and the resolver was matching only the formal one.
     */
    const alias = normAddr(p.alias);
    if (alias && alias === t) { consider(p, 0); continue; }

    const addr = normAddr([p.address, p.city, p.zip].filter(Boolean).join(" "));
    const addr1 = normAddr(p.address);
    /**
     * An address can only claim a job when it carries something that separates one
     * street from every other street of that name. "Westbridge Manor Hall, 32 High
     * Street, Westbridge AB12 3CD" was resolving to Walthamstow Library, whose
     * address is the two words "High Street" — a containment match, and crew sent
     * to the wrong building in a different town. So the postcode has to agree when
     * the record has one, and a record with no postcode has to name a street NUMBER.
     */
    const zip = normAddr(p.zip);
    const discriminating = zip ? t.includes(zip) : /\d/.test(addr1);
    if (addr && discriminating && (addr === t || t.includes(addr))) { consider(p, 1); continue; }
    if (addr1 && addr1.length >= 8 && discriminating && (addr1 === t || t.includes(addr1) || addr1.includes(t))) { consider(p, 1); continue; }
    if (name && name.length >= 6 && t.includes(name)) { consider(p, 2); continue; }
    // Containment on the alias too, held to the same length floor as the name so a
    // three-letter alias cannot sweep every address that happens to contain it.
    if (alias && alias.length >= 6 && t.includes(alias)) { consider(p, 2); continue; }
  }
  return best ? (best as { id: number }).id : null;
}

/** Exact contact match on email (case-insensitive). */
export function matchContact(email: string | undefined, clients: ClientRec[]): number | null {
  const t = (email || "").toLowerCase().trim();
  if (!t) return null;
  const hit = clients.find((c) => (c.email || "").toLowerCase().trim() === t);
  return hit?.id ?? null;
}

export interface OrderRec { id: number; number?: string; happening?: string; name?: string; Job?: { id: number }[] }

export type OrderMatch =
  | { order_id: number; order_number?: string; job_id?: number; by: "date" | "date+venue" }
  /** Several orders fit and nothing separates them. Never guessed at. */
  | { ambiguous: number; day: string };

/**
 * Which existing OnSinch order an update belongs to — or nothing.
 *
 * Ben, 2026-08-09: "If a thread update/potential update comes in, we should search
 * for it in Onsinch, so that we can potentially match it to a past thread/order
 * within onsinch to make the update. This is a very particular one and should only
 * apply when its absolutely 100% sure."
 *
 * The old rule was company + happening date, taking the FIRST hit. That is not
 * sure at all: over the live tenant's 1,029 recent orders, 121 of 870 company+date
 * keys carry more than one order — 13.9%, covering 280 orders — so roughly one
 * update in seven was attaching itself to whichever of them the API happened to
 * return first. Company 128 has FIVE orders on 2026-06-09 alone: Hackney Town
 * Hall, The Carter Building, and three at Chicago Booth.
 *
 * The venue is what tells them apart. Spartan name orders "<Company> @ <Venue>"
 * tenant-wide, and across those 121 collisions 94 give every order a distinct
 * venue. So:
 *
 *   one order on the day                      -> match
 *   several, and the thread's venue picks out
 *     exactly one of them                     -> match
 *   several, and the venue picks out none or
 *     more than one                           -> AMBIGUOUS, match nothing
 *
 * Ambiguity is reported rather than swallowed, because "we could not tell which of
 * your three jobs you meant" is a thing a human must see. Attaching a crew change
 * to the wrong job is worse than not attaching it: the right job goes unstaffed
 * and the wrong one gets people it does not need.
 */
export function matchExistingOrder(
  earliestDateISO: string | undefined,
  orders: OrderRec[],
  locationText?: string
): OrderMatch | null {
  const day = (earliestDateISO || "").slice(0, 10);
  if (!day) return null;

  const sameDay = orders.filter((o) => (o.happening || "").slice(0, 10) === day);
  if (!sameDay.length) return null;
  if (sameDay.length === 1) {
    return { order_id: sameDay[0].id, order_number: sameDay[0].number, job_id: sameDay[0].Job?.[0]?.id, by: "date" };
  }

  // More than one. Only the venue can separate them, and only if the thread names one.
  const want = normAddr(locationText);
  if (want) {
    const hits = sameDay.filter((o) => {
      const venue = normAddr(String(o.name || "").split("@").slice(1).join("@"));
      if (!venue) return false;
      // Either side may be the fuller string: an order name is "@ Excel" where the
      // email says "ExCeL London, Royal Victoria Dock", and vice versa.
      return venue === want || (venue.length >= 5 && want.includes(venue)) || (want.length >= 5 && venue.includes(want));
    });
    if (hits.length === 1) {
      return { order_id: hits[0].id, order_number: hits[0].number, job_id: hits[0].Job?.[0]?.id, by: "date+venue" };
    }
  }
  return { ambiguous: sameDay.length, day };
}
