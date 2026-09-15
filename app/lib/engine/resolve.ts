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
  if (!t) return null;

  /**
   * The four-character floor stops a three-letter fragment sweeping every address
   * that happens to contain it, and it is load-bearing — but it ran BEFORE any
   * matching, so "RAH", "V&A", "TGH", "RAA" and "CBC" resolved to nothing, and
   * nothing is what provisions a duplicate. That is the mechanism that produced
   * the 3,000 context-free rows.
   *
   * An EXACT alias match cannot be the collision the floor exists to prevent:
   * across the live tenant only five places carry an alias shorter than four
   * characters, and NO alias shorter than six is held by more than one place, so
   * there is nothing to be ambiguous with. Below the floor that match, and only
   * that match, is allowed to run.
   */
  const belowFloor = t.length < 4;

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
  let best: { tier: number; ctx: number; id: number; known: number } | null = null;
  const consider = (p: PlaceCandidate, tier: number) => {
    const known = placeContext(p);
    const cand = {
      tier,
      // An active row beats an inactive one before richness is even read.
      ctx: (anyActive && p.active !== false ? 1000 : 0) + known,
      id: p.id,
      known,
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
    const alias0 = normAddr(p.alias);
    if (belowFloor) { if (alias0 && alias0 === t) consider(p, 0); continue; }

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
    /**
     * A short alias may lead the text — "RAH, Kensington Gore" — but only when
     * everything after it is this record's OWN address. Spelled out that text
     * resolved to nothing, because a record with no street number cannot claim a
     * job on "Kensington Gore" either.
     *
     * The remainder is the whole guard. Measured over the tenant's 2,432 distinct
     * venue texts, a bare leading-token rule moved four of them, and two were
     * wrong in the way that matters: "V&A East Storehouse" and "V&A East Museum"
     * are buildings in Stratford, and they resolved onto the South Kensington
     * museum because "v a" leads both and the museum knows more. What follows a
     * short form is either its address or a DIFFERENT VENUE, and only the first
     * of those is safe to fold in.
     */
    if (alias && alias.length < 6 && t.startsWith(alias + " ")) {
      const rest = t.slice(alias.length + 1);
      const known = normAddr([p.address, p.city, p.zip].filter(Boolean).join(" "));
      if (known && rest.split(" ").every((w) => known.includes(w))) { consider(p, 2); continue; }
    }
  }

  /**
   * REVERSE containment: the record's name begins with the client's whole text.
   *
   * Every tier above asks whether the EMAIL contains the RECORD's name, which is
   * the right question when the client writes an address and the record holds a
   * name. It is the wrong question when the client abbreviates: "ExCeL" does not
   * contain "ExCel London", so row 49 — the only one of 803 carrying the address,
   * postcode and coordinates — never matched at all, and the answer was one of the
   * ten address-less rows named exactly "Excel" that earlier clients' texts made.
   *
   * Only rows that actually know something are read, and they must agree on one
   * name. "excel " leads to "excel london" alone. "olympia " leads to both
   * "Olympia London" and "Olympia West", which are different buildings, so this
   * declines and the answer stays whatever the exact tiers found. Sending crew to
   * the wrong building is worse than provisioning a duplicate row, so a first word
   * two venues share is never guessed between.
   *
   * The context-free shells are deliberately ignored here rather than counted as
   * disagreement: 632 of them begin with "excel" because they were made from the
   * full address, and they are the same venue as 49.
   *
   * LAST RESORT, and that is not a nicety. It runs only when every tier above
   * found nothing or found a shell, because a longer name is a longer name and not
   * a better record: promoting on richness moved "The Oval" onto "The Oval Open
   * Space" and "Needle & Thread" onto its head office, over exact-name rows that
   * already carried an address. An exact match on an informative row is the answer.
   */
  if (!belowFloor && t.length >= 5 && (!best || (best as { known: number }).known < 3) ) {
    const informative = places.filter((p) => placeContext(p) >= 3 && normAddr(p.name).startsWith(t + " "));
    if (informative.length && new Set(informative.map((p) => normAddr(p.name))).size === 1) {
      for (const p of informative) consider(p, 3);
    }
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

export interface OrderRec {
  id: number;
  number?: string;
  happening?: string;
  name?: string;
  Job?: { id: number }[];
}

export type OrderMatch =
  | { order_id: number; order_number?: string; job_id?: number; by: "date" | "date+venue" | "date+r-number" }
  /** Several orders fit and nothing separates them. Never guessed at. */
  | { ambiguous: number; day: string };

/**
 * Every R number a thread names - "R10687", "r 10687", "Ref R10687".
 *
 * Ben, 2026-09-14: "Threads will likely NEVER directly name an R number, dont expect
 * to find it in an order, though for consistency in code we can look for it." The
 * measurement agrees: 40 of 238 bound threads name one, and those 40 are mostly staff
 * forwards and quote replies - a population that shrinks as the engine takes more
 * threads from first contact. So this is a CONFIRMATION, never the mechanism, and
 * nothing downstream may depend on it being present.
 *
 * Two phrasings have to be excluded or the number means the opposite of what it says:
 *
 *   "Re: Repeat of R5531"   names the order this job is a COPY of, deliberately not
 *                           the order this thread is about. Binding to it attaches a
 *                           new booking's crew to last year's job.
 *   three numbers at once   a quote reply listing several jobs. Nothing picks one.
 *
 * Both are handled by returning the whole set and letting the caller require exactly
 * one: "repeat of" is stripped with its number, so a thread that named only that reads
 * as having named nothing, and a multi-number thread fails the count test on its own.
 */
export function rNumbersIn(text: string): string[] {
  const cleaned = text.replace(/\brepeat\s+(?:of\s+)?r\s*\.?\s*#?\s*\d{3,6}\b/gi, " ");
  const out = new Set<string>();
  for (const m of cleaned.matchAll(/\bR\s*\.?\s*#?\s*(\d{3,6})\b/gi)) out.add(m[1]);
  return [...out];
}

export interface MatchOpts {
  /**
   * EVERY date the thread asks for, not just the earliest.
   *
   * A thread that says "moving the 9th to the 11th" holds both. Matching on the
   * earliest alone means a date change finds no same-day order and the engine creates a
   * SECOND booking for a job that already exists - the exact duplicate this function is
   * here to prevent. Ben's ruling, 2026-09-13: a stated change proves identity and
   * carries an instruction; it can never be the reason to call this a different job.
   */
  days?: string[];
  /** The thread's venue as written. Fallback only - see place_id. */
  location_text?: string;
  /**
   * The thread's venue RESOLVED to an OnSinch place. Comparing the two raw strings does
   * not work and the measurement is unambiguous: it refused "@ Rosewood Hotel" against
   * "Rosewood London, 252 High Holborn", "@ Kings Cross Station" against "King's Cross,
   * Euston Road", and "@ HQ" against "We are Family office, Kingsland Road" - all the
   * same venue, typed by different people on different sides. Resolving BOTH sides
   * through matchPlace and comparing ids took the refusals from 58 of 141 to 35.
   */
  place_id?: number | null;
  /** The tenant's places, so an order's own venue text can be resolved the same way. */
  places?: PlaceCandidate[];
  /** R numbers the thread names, from rNumbersIn(). Narrows; never widens. */
  r_numbers?: string[];
}

/** The venue an order name carries: Spartan name orders "<Company> @ <Venue>" tenant-wide. */
function venueOfOrder(name: unknown): string {
  return String(name ?? "").split("@").slice(1).join("@").trim();
}

/**
 * How this order's venue stands against the one the thread asked for.
 *
 * The three non-agreeing answers are kept apart because they carry different weights and
 * collapsing them is what made the first version of this rule move a booking to the
 * wrong building:
 *
 *   "agree"          both sides name the same place.
 *   "differ-id"      BOTH sides resolved to an OnSinch place and the places are
 *                    different. This is a real disagreement and strong enough to refuse
 *                    on, because nothing about it is a matter of wording.
 *   "differ-text"    neither side resolved, and the two strings do not overlap. Weak:
 *                    "@ Rosewood Hotel" against "Rosewood London, 252 High Holborn" is
 *                    this, and it is the same venue. Never refuses on its own.
 *   "unreadable"     one side or the other gave nothing to compare. Not a disagreement,
 *                    and must never be counted as one — the engine's own orders are
 *                    named "Light Motif - install crew at Design Museum, 17 Sep" with no
 *                    "@" at all, so every order WE raised lands here.
 */
type VenueVerdict = "agree" | "differ-id" | "differ-text" | "unreadable";

function venueVerdict(o: OrderRec, opts: MatchOpts): VenueVerdict {
  const orderVenue = venueOfOrder(o.name);
  if (!orderVenue) return "unreadable";

  // Preferred: both sides as place ids, through the tenant's own alias list. This is the
  // only comparison strong enough to refuse on, and the only one that is symmetric —
  // each side went through the same function against the same 5,627 rows.
  if (opts.place_id && opts.places?.length) {
    const resolved = matchPlace(orderVenue, opts.places);
    if (resolved != null) return Number(resolved) === Number(opts.place_id) ? "agree" : "differ-id";
  }

  // Fallback, for a thread whose venue never resolved: substring either way round,
  // because either side may be the fuller string - an order name is "@ Excel" where the
  // email says "ExCeL London, Royal Victoria Dock".
  const want = normAddr(opts.location_text);
  if (!want) return "unreadable";
  const venue = normAddr(orderVenue);
  if (!venue) return "unreadable";
  const hit =
    venue === want || (venue.length >= 5 && want.includes(venue)) || (want.length >= 5 && venue.includes(want));
  return hit ? "agree" : "differ-text";
}

/**
 * Which existing OnSinch order a thread belongs to - or nothing.
 *
 * Ben, 2026-08-09: "If a thread update/potential update comes in, we should search for
 * it in Onsinch, so that we can potentially match it to a past thread/order within
 * onsinch to make the update. This is a very particular one and should only apply when
 * its absolutely 100% sure."
 *
 * THE IDENTITY RULE (Ben, 2026-09-13). A thread is about the same job as an order when
 * the CLIENT, the DATE and the VENUE agree - each of which may be superseded by a change
 * the thread states. Silence about a field means that field is UNCHANGED, not unknown.
 * Only a positively stated difference refuses.
 *
 * TIMES AND CREW ARE NOT CONSULTED, and that is the ruling, not an omission. Crew size is
 * the most frequent change in the mailbox, so it can never be evidence that this is a
 * different job; times are the same - "Make that 4x at 1400-2000" against a block of 2 at
 * 1200-1800 is a crew change and a time change, neither one announced in words. They are
 * instructions to apply after binding, and a matcher that weighed them would refuse
 * precisely the amendments it exists to catch.
 *
 * WHY THE VENUE MOSTLY ONLY NARROWS. Over the live tenant's 1,029 recent orders, 121 of
 * 870 company+date keys carry more than one order - 13.9%, covering 280 orders - so
 * roughly one update in seven was attaching itself to whichever the API returned first.
 * Company 128 has FIVE orders on 2026-06-09. The venue separates 94 of those 121.
 *
 * THE ONE CASE WHERE IT REFUSES is a sole candidate that resolved to a DIFFERENT OnSinch
 * place than the thread did. That exception is paid for: without it, thread
 * "PO - Tottenham Hotspur Stadium - 02/09/26" bound to "Blackout - MCS Prods @ The Tower
 * Hotel" because it was the only order Blackout had that day, and a crew change for a
 * stadium would have landed on a hotel. A weaker disagreement never refuses - our own
 * venue resolution is the softer side of the comparison (R10556's thread says "Royal
 * Horse Guards Hotel" and resolved to Banqueting House; R10657's resolved to "London"),
 * so refusing on a string miss would break binds that are right today to fix errors that
 * are ours.
 *
 *   one order on the day, venue agrees or
 *     cannot be read                              -> match
 *   one order on the day, both sides resolved to
 *     DIFFERENT places                            -> refuse
 *   several, venue picks out exactly one          -> match
 *   several, venue picks none or more than one    -> AMBIGUOUS, match nothing
 *
 * Ambiguity is never guessed at, and it is not an escalation either: the thread is left
 * unbound, nothing is created beside the job that already exists, and the next message or
 * the next sweep tries again with whatever the client has since said. Attaching a crew
 * change to the wrong job is worse than not attaching it - the right job goes unstaffed
 * and the wrong one gets people it does not need.
 *
 * MEASURED, 2026-09-14, against all 265 bindings the live system holds
 * (`npx tsx scripts/score-identity-rule.ts`, which drives THIS function rather than a
 * re-implementation of it). Re-deriving every binding from scratch:
 *
 *                           agrees   moves   refuses   finds nothing
 *   thread names one R no.   93.8%    6.3%      0%          0%       (16 scored)
 *   thread names none        56.8%    5.8%   36.0%        1.4%      (139 scored)
 *
 * And on the only rows the shipped code actually re-derives - the 100 whose order staff
 * have since deleted - 42% find a successor, 29% refuse, 29% find nothing on the day.
 *
 * READ THE 36% CORRECTLY. It is not an error rate; it is the rule declining to guess
 * where a client has several orders on one day and the thread's venue picks out none of
 * them. The old rule bound those anyway. What changed is the DIRECTION of the failure:
 * from a silent wrong bind, which puts crew on the wrong job, to a refusal, which leaves
 * the thread unbound and blocked so nothing duplicates and the next sweep tries again.
 *
 * WHAT IS NOT PROVEN. Ben's bar is "wrong less than 1% of the time" and this measurement
 * cannot establish it, because agreement with an existing binding is not proof that
 * binding was right. What it does establish is the sign of each change: of the moves it
 * makes, two are defects with documentary proof (#13841 above, and thread "crew at Big
 * Feastival" moving off "@ Silverstone Circuit" onto "@ Alex James Farm", which is where
 * the Big Feastival is), and the one provable regression an earlier draft introduced -
 * "PO - Tottenham Hotspur Stadium" binding to "@ The Tower Hotel" - is what the
 * "differ-id" refusal above exists to stop. The remainder are unproven either way and a
 * real 1% figure needs ground truth this tenant does not hold yet.
 */
export function matchExistingOrder(
  earliestDateISO: string | undefined,
  orders: OrderRec[],
  opts: MatchOpts = {}
): OrderMatch | null {
  const days = new Set(
    [earliestDateISO, ...(opts.days ?? [])].map((d) => (d || "").slice(0, 10)).filter(Boolean)
  );
  if (!days.size) return null;

  const sameDay = orders.filter((o) => days.has((o.happening || "").slice(0, 10)));
  if (!sameDay.length) return null;
  const day = (sameDay[0].happening || "").slice(0, 10);

  /**
   * The R number as a CHECK, not a branch: it may only pick from what the shape rule has
   * already accepted. Requiring exactly one is what makes the two poisoned phrasings
   * inert, and keeping it inside the same-day set is what stops a stale reference in a
   * signature block dragging the thread onto last year's job.
   *
   * This is also the one place a live defect is provable: thread #13841, whose own
   * subject reads "Price quote - R10687 Delta Live - BBC PROMS 53 @ RAH", is bound to
   * R10688 - PROMS 54, a different show at a different venue, created five minutes
   * apart. Both are same-client same-day, so both survive the filter above, and this is
   * what separates them.
   */
  const rn = opts.r_numbers ?? [];
  if (rn.length === 1) {
    const named = sameDay.filter((o) => String(o.number ?? "") === rn[0]);
    if (named.length === 1) {
      return {
        order_id: named[0].id,
        order_number: named[0].number,
        job_id: named[0].Job?.[0]?.id,
        by: "date+r-number",
      };
    }
    // Named an order that is not among the candidates: a stale or copied reference. It
    // narrows nothing and must not widen anything, so the shape rule carries on exactly
    // as if the thread had named no number at all.
  }

  if (sameDay.length === 1) {
    // A sole candidate binds unless the disagreement is the strong kind - see the
    // "Tottenham Hotspur Stadium" case in the header. Refusing leaves the thread unbound
    // and blocked, so nothing is created beside the job that already exists.
    if (venueVerdict(sameDay[0], opts) === "differ-id") return { ambiguous: 1, day };
    return { order_id: sameDay[0].id, order_number: sameDay[0].number, job_id: sameDay[0].Job?.[0]?.id, by: "date" };
  }

  // More than one. Only the venue can separate them, and only if the thread names one.
  const hits = sameDay.filter((o) => venueVerdict(o, opts) === "agree");
  if (hits.length === 1) {
    return { order_id: hits[0].id, order_number: hits[0].number, job_id: hits[0].Job?.[0]?.id, by: "date+venue" };
  }
  return { ambiguous: sameDay.length, day };
}
