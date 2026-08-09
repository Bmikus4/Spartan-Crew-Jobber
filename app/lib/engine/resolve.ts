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

export interface CompanyRec { id: number; name?: string; invoice_name?: string }
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
export function matchPlace(locationText: string | undefined, places: PlaceCandidate[]): number | null {
  const t = normAddr(locationText);
  if (!t || t.length < 4) return null;
  for (const p of places) {
    const name = normAddr(p.name);
    if (name && name === t) return p.id;
    const addr = normAddr([p.address, p.city, p.zip].filter(Boolean).join(" "));
    const addr1 = normAddr(p.address);
    if (addr && (addr === t || t.includes(addr))) return p.id;
    if (addr1 && addr1.length >= 8 && (addr1 === t || t.includes(addr1) || addr1.includes(t))) return p.id;
    if (name && name.length >= 6 && t.includes(name)) return p.id;
  }
  return null;
}

/** Exact contact match on email (case-insensitive). */
export function matchContact(email: string | undefined, clients: ClientRec[]): number | null {
  const t = (email || "").toLowerCase().trim();
  if (!t) return null;
  const hit = clients.find((c) => (c.email || "").toLowerCase().trim() === t);
  return hit?.id ?? null;
}

export interface OrderRec { id: number; happening?: string; name?: string; Job?: { id: number }[] }

/**
 * Order dedup: an incoming booking matches an existing order when it's for the
 * same company (already filtered) AND the same happening date. Returns the
 * existing order+job ids so we UPDATE instead of creating a duplicate job.
 */
export function matchExistingOrder(
  earliestDateISO: string | undefined,
  orders: OrderRec[]
): { order_id: number; job_id?: number } | null {
  const day = (earliestDateISO || "").slice(0, 10);
  if (!day) return null;
  const hit = orders.find((o) => (o.happening || "").slice(0, 10) === day);
  if (!hit) return null;
  return { order_id: hit.id, job_id: hit.Job?.[0]?.id };
}
