// ============================================================================
// compiler — the foundational piece. compile(thread, prior) -> {state, actions}
//
// The compiler READS (normalize, classify, extract, resolve ids via GET) and
// composes desired state. It NEVER writes to OnSinch/Gmail — it returns the
// Actions for the executor to perform. This keeps compile idempotent and
// safe to re-run on any thread at any time (the "never miss a lead" property:
// a nightly full-thread sweep can re-compile everything harmlessly).
// ============================================================================
import { createHash } from "node:crypto";
import type {
  Actions,
  ConversationFacts,
  ConversationState,
  DesiredOrder,
  HydratedThread,
  PlaceCandidate,
} from "./types";
import { normalizeThread } from "./normalize";
import { mergeFacts, describeMerge } from "./mergeFacts";
import { reconcileRequests } from "./parseWork";
import { triage, decisionBinds, triageModeFromEnv, type TriageMode } from "./triage";
import { composeOrder } from "./compose";
import { validateOrder } from "./format";
import { matchCompany, matchCompanyByDomain, matchContact, matchPlace, matchExistingOrder, normName, normAddr } from "./resolve";
import { matchPlaceV2, matchedOnCityAlone, isAShell } from "./venueMatch";
import { buildIndex, searchVenues, applyRuledWording, type Building } from "./venueSearch";
import { adjudicateVenue, type VenueJudge } from "./venueAdjudicate";
import { resolveProfession, normProf, UNRECOGNISED_MARK, type ProfessionRec } from "./professions";
import { PROFESSION_LIST } from "./professionList";
import { resolveRateCard } from "./rates";
import type { Reasoner, ReplyContext } from "./reason";
import type { OnsinchClient } from "./onsinch";

/** The third alias kind, added for professions — see aliasesDb.ts. */
type AliasKind = "company" | "place" | "profession";

export interface CompileDeps {
  reasoner: Reasoner;
  onsinch: OnsinchClient;
  now: () => number; // injectable clock for deterministic tests
  // Tool 1 toggle. undefined => enabled (tests); false => no reply is drafted.
  repliesEnabled?: boolean;
  /**
   * Which threads get one. "all" (the default) replies to everything read;
   * "enquiries" replies only where there is a crew request — a new job or a
   * change to one. See Settings.reply_scope.
   */
  replyScope?: "all" | "enquiries";
  /**
   * Rate card for a client with no pricing history. See Settings.default_rate_card.
   * Absent, a company without derivable pricing holds for a human as before.
   */
  defaultRateCard?: number | null;
  // Seeded rate-card lookup (Phase B rate_cards). Injected so the engine stays
  // DB-agnostic; when absent, rates.ts falls back to a live history scan.
  seededRateCard?: (companyId: number) => Promise<number | null>;
  /**
   * What the sender ledger makes of an address, for triage. Injected for the same reason
   * as the others: the engine must compile with no database, and every test here runs
   * without one. Absent, triage simply skips its ledger tier.
   */
  senderVerdict?: (from: string) => Promise<"trusted" | "parked" | "unknown">;
  /**
   * Whether triage may actually stop the model, or is only being scored. Defaults to
   * shadow (see triage.ts) so an unproven filter cannot quietly decide which client
   * emails go unread.
   */
  triageMode?: TriageMode;
  /**
   * Names this system has already resolved once, so it stops solving the same ones from
   * scratch. Injected rather than imported for the same reason as seededRateCard: the
   * engine must compile offline, and every test here runs without a database.
   *
   * `lookup` answers only for aliases safe to trust automatically (human-confirmed, or a
   * cached exact match). `record` is fire-and-forget — a resolution that already worked
   * must not fail because remembering it did.
   */
  /**
   * The tenant's profession list. Injected for the same reason as the alias store: the
   * engine must compile with no database. See professionsDb.ts.
   */
  professions?: ProfessionRec[];
  /**
   * The model that decides between the alias store's answer and a search of every
   * venue (Ben, 2026-08-25). Injected for the same reason as everything else here:
   * the engine must compile with no network. Absent, the venue path takes the
   * deterministic search result and says so on the ticket.
   */
  venueJudge?: VenueJudge | null;
  aliases?: {
    lookup: (kind: AliasKind, aliasNorm: string) => Promise<number | null>;
    record: (a: { kind: AliasKind; alias_norm: string; entity_id: number; source: "exact" | "fuzzy"; raw_example?: string }) => Promise<void>;
  };
}

/**
 * The alias store is a convenience, never a dependency. If it is unreachable the answer
 * is still derivable from the whole-list pull, so a broken memory must degrade to the
 * slow path rather than fail an enquiry — losing a booking to a cache outage would be
 * an absurd trade.
 */
async function aliasLookup(
  aliases: CompileDeps["aliases"],
  kind: AliasKind,
  key: string
): Promise<number | null> {
  if (!aliases || !key) return null;
  try { return await aliases.lookup(kind, key); }
  catch (err) { console.error("[aliases] lookup failed", kind, key, err); return null; }
}

async function aliasRecord(
  aliases: CompileDeps["aliases"],
  a: { kind: AliasKind; alias_norm: string; entity_id: number; source: "exact" | "fuzzy"; raw_example?: string }
): Promise<void> {
  if (!aliases || !a.alias_norm) return;
  try { await aliases.record(a); }
  catch (err) { console.error("[aliases] record failed", a.kind, a.alias_norm, err); }
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * OnSinch caps the Job name at EIGHTY, not a hundred, and rejects the whole order
 * with it — the same limit and the same whole-request 400 as the SlotTeam name.
 *
 * 100 was a guess, and it was wrong in the direction that fails silently in every
 * test: names between 81 and 100 characters pass every offline check and 400 on the
 * wire. The 500-case corpus separates it perfectly — of 500 cases, the 100 whose
 * composed Job name exceeds 80 characters produced all 147 `POST /orders -> 400`
 * and the 400 whose name fits produced none. No other factor correlates.
 *
 * The venue is what pushes it over: "2 at Excel London, Royal Victoria Dock, 1
 * Western Gateway, London E16 1XL on 2026-09-15" is 87 characters, and that is an
 * ordinary London address, not a pathological one.
 */
const JOB_NAME_MAX = 80;

/**
 * "<size> at <venue> on <date>", capped at JOB_NAME_MAX.
 *
 * The cap is applied to the VENUE, not to the finished string. Truncating the
 * whole thing lopped the date off the end whenever the address was long: live
 * order 13632's name read "...London E16 2HB on 2026", cut four characters into
 * the year, because that address is 87 chars and the full name is 106.
 *
 * The date is the load-bearing token here - it is what a human scans a crew job
 * name for, and what the order->thread linkage matches on. The venue tail is the
 * only part that can afford to be lost.
 */
/**
 * THE NAME AN ORDER CARRIES IN ONSINCH, WHICH USED TO BE THE EMAIL SUBJECT.
 *
 * `orderName` was `latest.subject || requests[0].task || "Spartan Crew job"`, so the
 * tenant holds bookings called "Re: Visual Elements Sat 29th Aug 2026" (order 14860) and
 * "Availability?". A subject line is written to be replied to; an order name is read six
 * weeks later in a list of hundreds, by someone deciding which job to staff.
 *
 * Ben, 2026-08-26: "named By AI something realistic and representative of the order,
 * never say Re: in them, they should be real descriptive titles."
 *
 * So the model writes it (see ORDER_TITLE in prompts.ts) and this function is the
 * guarantee around it — because a prompt cannot be relied on and a booking must never
 * fail for want of a name. Three lines of defence, in order:
 *
 *   1. the model's title, if it gave one and it is not itself a subject line;
 *   2. a title COMPOSED from the facts, which is deterministic and always available;
 *   3. the subject with any reply prefix stripped, which is where we started but at
 *      least never says "Re:".
 *
 * The prefix strip is applied to EVERY branch rather than only the fallback: the model
 * has been told not to emit one, and this is what makes that true instead of hoped for.
 */
export function stripReplyPrefix(s: string): string {
  // Repeated because mail clients stack them: "Re: Fwd: RE: ...".
  let out = String(s ?? "").trim();
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/^\s*(re|fw|fwd|aw|antw|sv|vs|tr)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

export function orderTitle(
  aiTitle: string | undefined,
  subject: string | undefined,
  facts: ConversationFacts
): string {
  const clean = (s: string | undefined) => stripReplyPrefix(s ?? "").replace(/\s+/g, " ").trim();

  const ai = clean(aiTitle);
  // A model that simply echoes the subject has not written a title, it has copied one.
  // Compared AFTER stripping, so "Re: Crew request" echoing "Crew request" is caught.
  const echoesSubject = !!ai && !!subject && ai.toLowerCase() === clean(subject).toLowerCase();
  if (ai.length >= 8 && !echoesSubject) return ai.slice(0, 80);

  // Composed from what the thread actually established. Every part is optional because
  // an enquiry that names no venue and no date still has to produce an order.
  const r = facts.requests?.[0];
  const crew = (facts.requests ?? []).reduce((n, x) => n + (Number(x.size) || 0), 0);
  const who = facts.company_name?.trim();
  // "Meridian Exhibitions — 6 crew at ExCeL London on 2027-09-12", not a string of
  // dashes. The em-dash separates WHO from WHAT once; the rest is a sentence.
  const what = [
    crew > 0 ? `${crew} crew` : r?.task?.trim(),
    facts.location_text?.trim() ? `at ${facts.location_text.trim()}` : "",
    r?.date ? `on ${r.date}` : "",
  ].filter(Boolean).join(" ");
  const bits = [who, what].filter(Boolean);
  if (bits.length === 2) return bits.join(" — ").slice(0, 80);
  if (what) return what.slice(0, 80);

  const fromSubject = clean(subject);
  return (fromSubject || r?.task?.trim() || "Spartan Crew job").slice(0, 80);
}

export function jobNameFrom(facts: ConversationFacts): string {
  const r = facts.requests[0];
  const size = r?.size ?? "?";
  const date = r?.date ?? "TBC";
  const loc = facts.location_text ?? "TBC";

  const head = `${size} at `;
  const tail = ` on ${date}`;
  const room = JOB_NAME_MAX - head.length - tail.length;
  // Nothing sane left for a venue: keep the ends, which still identify the job.
  if (room <= 0) return `${head}${tail}`.slice(0, JOB_NAME_MAX);
  const venue = loc.length > room ? loc.slice(0, room).trimEnd() : loc;
  return `${head}${venue}${tail}`;
}

/** Earliest requested date (YYYY-MM-DD) — the order-dedup key. */
function firstDate(facts: ConversationFacts): string | undefined {
  return facts.requests
    .map((r) => r.date)
    .filter((d): d is string => !!d)
    .sort()[0];
}

// Tool 2 resolution — OnSinch search is limited/non-fuzzy, so we pull the WHOLE
// list and match EXACTLY client-side (dedup: never create a duplicate).

/**
 * The stand-in contact for a client OnSinch has never met.
 *
 * OnSinch cannot create contacts — /users is GET-only and there is no /clients
 * endpoint — so a company we have just created has nobody to attach an order to,
 * and an order without a user_id cannot be posted at all. Ben, 2026-08-09:
 * "might need a user, use my own (Ben Mikus)".
 *
 * 2257 is that account, verified live: ben@samuraisolutions.co.uk, the same user
 * the API key belongs to. It is deliberately a real, identifiable person rather
 * than a fabricated placeholder — whoever opens the order can see at a glance that
 * the contact is a stand-in and who to ask, and the order carries a note saying so.
 */
const PLACEHOLDER_CONTACT_ID = 2257;

/**
 * WHO OWNS AN ORDER THIS ENGINE BUILT.
 *
 * Spartan could not tell an AI-built job from a hand-built one at a glance. The
 * order's `creator` was already right — 2257 on every engine order against 2620 or
 * 413 on a human's — but the name they read in the list is the order's CONTACT, and
 * on the TEST company that is "Alexa Accs", accounts@spartancrew.co.uk, which the
 * engine fell back to because the sender is unknown to OnSinch. On a real enquiry
 * it is the client's own contact. Either way it says nothing about who built it.
 *
 * `order_manager_id` is the field for it and it was empty on every order this engine
 * has ever made. Ben, 2026-08-25: fill it, leave the contact alone.
 *
 * The CONTACT is deliberately not touched. It is who the booking is for, and an
 * order with no client contact cannot be posted at all — the reason
 * PLACEHOLDER_CONTACT_ID above exists.
 *
 * Overridable, because the right answer is a dedicated "SamurAI" login once Spartan
 * makes one; there is no such user in the tenant today (searched, 25 pages of
 * /users), so this is Ben's own account, which is also the account the API key
 * belongs to and therefore already the creator.
 */
const ORDER_MANAGER_ID = Number(process.env.SPARTAN_ORDER_MANAGER_ID || PLACEHOLDER_CONTACT_ID);

/**
 * The venue for a job whose venue nobody has said yet. Ben: "for venue, if it
 * doesnt exist in onsinch, then you should also use a placeholder location
 * ('No Location') which you will create."
 *
 * Created once, on the first enquiry that needs it, and found by name every time
 * after — it is an ordinary place and goes through the ordinary match. Verified
 * absent from the live tenant today, so the first use creates it.
 */
const PLACEHOLDER_PLACE_NAME = "No Location";

/**
 * company: reuse prior; else exact-match all companies; else CREATE it.
 *
 * Ben, 2026-08-09: "if company or venue location are not found in the system,
 * always create new ones if they can be inferred. This is why the checking
 * procedure was so important."
 *
 * That last sentence is the load-bearing one. Creating on a miss is only safe
 * because matchCompany looks hard before giving up — exact on name and invoice
 * name, then a bounded token-subset fallback, then a phrase tie-break — so a
 * "miss" means the client really is absent rather than spelled differently. Six of
 * the eight companies stuck on the live board were the second kind, and creating
 * them would have made six duplicates of clients Spartan already had.
 */
async function resolveCompany(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient,
  aliases?: CompileDeps["aliases"]
): Promise<{ id?: number; provision?: DesiredOrder["provision_company"]; note?: string }> {
  if (prior?.company_id) return { id: prior.company_id };

  /**
   * No company name in the text is not the same as no evidence about the client.
   * The sender's own domain identifies them on 96.5% of the 708 domains OnSinch
   * holds contacts for, and over the live board it answered for 17 threads where
   * the model extracted no name at all. Checked here because in this branch there
   * is nothing else to check.
   */
  if (!facts.company_name) {
    const byDomain = matchCompanyByDomain(facts.contact_email, await onsinch.allCompanies());
    if (byDomain) {
      return { id: byDomain, note: `company identified from the sender's domain (${facts.contact_email})` };
    }
    return { note: "no company name extracted" };
  }

  // A name seen before, already settled. Checked before the whole-list pull because it
  // is the answer to the same question, arrived at once instead of every time — and
  // the pull must stay BELOW this line: starting it eagerly would fetch 763 companies
  // on every thread the alias store could have answered for free.
  const key = normName(facts.company_name);
  const remembered = await aliasLookup(aliases, "company", key);
  if (remembered) return { id: remembered, note: `company from a name resolved before ("${facts.company_name}")` };

  const companies = await onsinch.allCompanies();
  const id = matchCompany(facts.company_name, companies);
  if (id) {
    const matched = companies.find((c) => c.id === id);
    const wasExact = !!matched && (normName(matched.name) === key || normName(matched.invoice_name) === key);
    if (wasExact) {
      // A deterministic answer, worth caching: the next thread asking the same question
      // gets it for free instead of pulling 763 companies again.
      await aliasRecord(aliases, { kind: "company", alias_norm: key, entity_id: id,
                                   source: "exact", raw_example: facts.company_name });
      return { id };
    }
    /**
     * A FUZZY COMPANY MATCH SAYS SO, AND IS NEVER REMEMBERED.
     *
     * It used to do neither. The old code recorded every match — exact or not — and
     * returned `{ id }` with NO note, so a token-overlap guess became the thread's client
     * in silence and was then cached as the answer for that wording forever. The comment
     * here already said a fuzzy hit "is only ever recorded for a human to confirm"; there
     * was nothing for a human to confirm it from.
     *
     * Caught by a live test on 2026-08-27. "Event Solutions UK" matched company 502
     * "Vision Events Solutions LTD" — a different firm — with not one note on the ticket,
     * while the venue on the same order carried a full explanation of how it resolved.
     * The alias was written the same second, so every later email from that client would
     * have gone to the wrong company without the engine reconsidering.
     *
     * WHY THAT COSTS MONEY AND NOT JUST TIDINESS. The rate card is derived from the
     * MATCHED company's order history, so a wrong company silently prices the job off
     * somebody else's rates and puts it on an invoice. That is the failure I1 exists to
     * prevent, arriving through a door I1 does not watch — I1 checks whether a card was
     * assumed, not whether the company it was derived from is the right one.
     *
     * Not caching is the important half. A guess that is used once is a guess; a guess
     * written to the alias store is a guess promoted to a fact, and the store is
     * consulted BEFORE the whole-list match, so it can never be revisited. This is the
     * same bug Ben killed for venues on 2026-08-25 — "venue matching must not come only
     * from what was remembered" — left standing on the company path.
     */
    return {
      id,
      note:
        `company "${facts.company_name}" did not match any client exactly — booked against ` +
        `${id} "${matched?.name ?? "?"}" on a name similarity. CHECK IT: the rate card is ` +
        `derived from that company's history, so the wrong client here prices the job wrong`,
    };
  }
  /**
   * The name did not resolve. Ask the sender's domain BEFORE creating a client:
   * a company name the model read out of prose can be wrong in ways an address
   * at that company's own domain cannot, and creating a duplicate of a client
   * Spartan already has is the exact failure the whole-list exact-match dedup
   * exists to prevent. Ordered after the name match, never before it, so a domain
   * shared by two trading entities can never override a name that was specific.
   */
  const byDomain = matchCompanyByDomain(facts.contact_email, companies);
  if (byDomain) {
    return {
      id: byDomain,
      note: `"${facts.company_name}" matched no client, but the sender's domain (${facts.contact_email}) belongs to company ${byDomain} — using that rather than creating a duplicate`,
    };
  }

  return {
    provision: {
      name: facts.company_name.slice(0, 120),
      // OnSinch will not create a company without it, and the sender's address is the
      // only invoice contact this thread actually knows.
      ...(facts.contact_email ? { email_invoice: facts.contact_email } : {}),
    },
    note: `new company "${facts.company_name}" — will be created in OnSinch on confirm`,
  };
}

/**
 * THE CONTACT ON EVERY ENGINE-RAISED ORDER IS BEN MIKUS. The COMPANY is still resolved
 * normally — it is the client's own — but the person the order is raised against is not.
 *
 * Ben, 2026-08-26: "the company is fine, keep it, but the specific client/user ID should
 * always be Ben Mikus."
 *
 * This used to hunt for the real client contact: match the sender's email against the
 * company's Client list, else take whichever contact the company happened to have first,
 * else fall back to the stand-in. That last-resort fallback is now the only path, and
 * `user_id` is a constant.
 *
 * WHAT IS GIVEN UP, so nobody restores the lookup by accident. The order no longer names
 * the person who asked for the job, and ops lose that at a glance in the OnSinch list —
 * which is exactly what prompted the change, because on the test company that contact
 * reads "Alexa Accs" and told Ben nothing. The client's name and address remain on the
 * thread and in the order's `specification`, so nothing is lost, only moved.
 *
 * WHAT IS GAINED, and it is the larger half. "whichever contact the company had first"
 * was a guess dressed as data: it put a real, named client employee on a booking they had
 * never sent, and anything OnSinch sends a client contact would have gone to them. A
 * constant that is a Spartan person cannot mis-address anybody.
 *
 * `prior?.user_id` is deliberately no longer honoured. Threads compiled before this
 * change carry whatever contact was resolved then, and reusing it would leave the tenant
 * with two conventions and no way to tell which an order followed.
 */
async function resolveContact(
  _facts: ConversationFacts,
  _prior: ConversationState | undefined,
  _company_id: number | undefined,
  _onsinch: OnsinchClient
): Promise<{ id?: number; note?: string }> {
  return { id: PLACEHOLDER_CONTACT_ID };
}

/** place: reuse prior; else exact-match all places; else provision a new one on write. */
/**
 * SEARCH EVERY VENUE, THEN ADJUDICATE. Ben's design of 2026-08-25.
 *
 * Two independent answers reach a model that can only choose between them: what the
 * alias store remembered for this exact wording, and what ranking all ~3,000 of the
 * tenant's buildings on postcode, name, token agreement and edit distance turned up.
 * Where they agree there is no call. Where they disagree, or where the search alone
 * is unconvincing, the model decides — and it cannot return an id it was not given.
 *
 * Returns null to mean "this path has no opinion", which hands the decision back to
 * matchPlace and the second pass exactly as before. A new resolver that can only
 * ever be an improvement is a resolver that can be turned on.
 */
const VENUE_INDEX_CACHE = new WeakMap<object, Building[]>();
function venueIndex(places: PlaceCandidate[]): Building[] {
  // Keyed on the array the OnSinch client caches, so the collapse runs once per
  // process rather than once per enquiry. 70ms over 6,859 rows is cheap, and it is
  // not free enough to pay on every block of every email.
  const hit = VENUE_INDEX_CACHE.get(places as unknown as object);
  if (hit) return hit;
  const built = buildIndex(places);
  VENUE_INDEX_CACHE.set(places as unknown as object, built);
  return built;
}

async function resolveVenueV3(
  locationText: string,
  places: PlaceCandidate[],
  remembered: number | null,
  deps?: { venueJudge?: VenueJudge | null }
): Promise<{ id?: number; provision?: DesiredOrder["provision_place"]; note?: string } | null> {
  const index = venueIndex(places);
  /**
   * A wording Spartan has ruled on is rewritten to the venue's real name BEFORE the
   * search, so the ordinary ranking finds the ordinary answer and the adjudicator is
   * never asked a question a person has already decided. See RULED_WORDINGS.
   *
   * The search text changes; `locationText` does not, because the note and the alias
   * key must still say what the CLIENT wrote.
   */
  const ruled = applyRuledWording(locationText);
  const { hits, searched } = searchVenues(ruled.text, index, 8);
  const rememberedBuilding = remembered
    ? index.find((b) => b.members.includes(remembered))
    : undefined;

  // A city name identifies nothing, and this is checked BEFORE the model sees a
  // shortlist of every venue in that city — a bare "Birmingham" would otherwise be
  // adjudicated between six real Birmingham venues, and one of them would win.
  const cityOnly = hits.length > 0 && hits.every((h) =>
    matchedOnCityAlone(locationText, places.find((p) => p.id === h.building.place_id)!));
  if (cityOnly) {
    return {
      provision: { name: locationText.slice(0, 120), country: "GB", address: locationText },
      note: `venue "${locationText}" names only a city — creating a new venue rather than booking crew to whichever venue in that city ranks highest`,
    };
  }
  if (!hits.length && !rememberedBuilding) return null;

  const verdict = await adjudicateVenue({
    // The RULED text, not the client's, so the adjudicator is shown the same question
    // the search was asked. Showing it "Albert Hall" while the shortlist came from
    // "Royal Albert Hall" is how a model gets asked to justify an answer to a different
    // question, and it is the shape that produces confident nonsense.
    text: ruled.text,
    remembered: remembered ? { place_id: remembered, source: "exact", building: rememberedBuilding } : null,
    candidates: hits,
  }, deps?.venueJudge ?? null);

  if (verdict.decision === "none" || !verdict.place_id) {
    return {
      provision: { name: locationText.slice(0, 120), country: "GB", address: locationText },
      note: `venue "${locationText}" not settled against ${searched} venues (${verdict.how}: ${verdict.reason}) — creating a new venue rather than guessing`,
    };
  }
  const chosen = index.find((b) => b.place_id === verdict.place_id);
  return {
    id: verdict.place_id,
    // The ruling is stated first when one applied. An ambiguous name that quietly
    // resolves is the thing a reader would otherwise have to guess at.
    note: (ruled.note ? `${ruled.note}. ` : "") +
      `venue "${locationText}" -> ${verdict.place_id} ${chosen?.name ?? ""} — searched ${searched} venues, ${verdict.how}` +
      (chosen?.unlocatable ? ", and this row carries no postcode" : "") +
      (verdict.how === "model" || verdict.how === "model-second-pass" ? `: ${verdict.reason}` : ""),
  };
}

/**
 * Exported for test/venueResolution.ts, which pins the four branches this function
 * has: matchPlace's answer, a shell set aside, a city-only answer refused, and the
 * "No Location" placeholder. Nothing outside the compiler calls it.
 *
 * The placeholder branch is why: the city-only guard read "No Location" as a city
 * name — it has no identifying words, by construction — refused the placeholder it
 * had just found, and provisioned a second one carrying "No Location" as its
 * address. The whole suite passed, because nothing exercised this function.
 */
export async function resolvePlace(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient,
  aliases?: CompileDeps["aliases"],
  deps?: { venueJudge?: VenueJudge | null }
): Promise<{ id?: number; provision?: DesiredOrder["provision_place"]; note?: string }> {
  /**
   * A CLIENT WHO MOVES THE VENUE USED TO BE IGNORED, SILENTLY.
   *
   * This was `if (prior?.place_id) return { id: prior.place_id }` — once a thread had a
   * venue, every later email in it reused that venue and never looked again. It emitted
   * no note either, so the only trace was the absence of one.
   *
   * Caught by the model-in-the-loop study, 2026-08-26: all four venue-change amendments
   * (R009, R019, R027, R049) reported "this message changed location_text" and then "no
   * crew or time change in this message — the blocks are unchanged". The client said the
   * job had moved, the engine agreed the message said so, and the order kept pointing at
   * the old building. Crew would have been sent to the wrong place.
   *
   * The short-circuit is still right when the venue has NOT moved: re-resolving the same
   * wording on every email in a thread costs a ~3,000-row search and can only return the
   * same answer. So the test is whether the client's own words changed, compared the way
   * the alias store compares them — `normAddr`, so "the O2" and "The O2," do not read as
   * a move.
   *
   * An absent `location_text` is NOT a move. A later email that simply does not mention
   * the venue is the common case, and treating silence as a change would re-resolve the
   * placeholder over a venue that was correctly resolved from the first email.
   */
  const priorText = prior?.facts?.location_text;
  const venueMoved =
    !!facts.location_text && normAddr(facts.location_text) !== normAddr(priorText ?? "");
  if (prior?.place_id && !venueMoved) return { id: prior.place_id };

  // No venue named anywhere in the thread. Every slot team still needs a place_id, so
  // the job gets the placeholder venue rather than not existing: "No Location" is
  // matched by name like any other place, and created on the first enquiry that needs
  // it. A job at a named venue is better than no job, and a job at "No Location" is
  // better than an enquiry nobody sees.
  const locationText = facts.location_text || PLACEHOLDER_PLACE_NAME;
  const missingVenue = !facts.location_text;

  const key = normAddr(locationText);
  const remembered = await aliasLookup(aliases, "place", key);
  /**
   * THE ALIAS STORE NO LONGER SHORT-CIRCUITS, and that is Ben's instruction of
   * 2026-08-25: venue matching must not come only from what was remembered.
   *
   * It returned here immediately, so a wording resolved once was resolved that way
   * forever — including the wordings resolved to a row that cannot say where it is.
   * The store is now ONE CANDIDATE among the tenant's ~3,000 buildings rather than
   * the answer, and where it disagrees with a search of all of them, a model is
   * asked which is right.
   *
   * The placeholder keeps its short-circuit. There is nothing to adjudicate about a
   * venue nobody named.
   */
  if (remembered && missingVenue) {
    return { id: remembered, note: `no venue named — used the "${PLACEHOLDER_PLACE_NAME}" placeholder; set the real venue in OnSinch` };
  }

  const places = await onsinch.allPlaces();

  if (!missingVenue && process.env.SPARTAN_VENUE_V3 === "1") {
    const v3 = await resolveVenueV3(locationText, places, remembered, deps);
    if (v3) return v3;
  }

  if (remembered) {
    return { id: remembered, note: `venue from a name resolved before ("${locationText}")` };
  }
  const v1 = matchPlace(locationText, places);
  /**
   * A MATCH MADE ENTIRELY OUT OF A CITY NAME IS THROWN AWAY.
   *
   * matchPlace's containment tiers read the whole record, city included, so "London"
   * resolves to a row whose entire name is "London" and "Birmingham" resolves to the
   * NEC — and to several hundred other rows equally well, the winner being whichever
   * happened to be richest. A city can confirm a building; it cannot identify one.
   *
   * Applied HERE rather than inside matchPlace so the scar tissue in that function
   * stays exactly as it was. This drops an answer; it never invents one.
   */
  const v1Row = v1 ? places.find((q) => q.id === v1) : undefined;
  /**
   * A MATCH ON A ROW THE ENGINE ITSELF INVENTED IS NOT A MATCH — not yet.
   *
   * A venue miss provisions a place named after the client's own words, and the
   * next client who writes those words matches it EXACTLY. So the tenant's 3,000
   * context-free duplicates do not merely clutter it: they intercept the venues
   * they are duplicates OF, and the matcher stops at the shell without ever
   * reaching the real row. The study's own five leftover rows do this to three of
   * the venues it was measuring.
   *
   * So a shell is set aside and the second pass gets to look. If it finds a row
   * that knows where it is, that row wins; if it does not, the shell is used after
   * all — booking to a poor row is still better than creating a second one.
   */
  // Named venues only, for the same reason as the city guard below: the "No
  // Location" placeholder is BY DEFINITION a row with no address, so it is a shell
  // on every test, and treating it as one sent the no-venue case down the wrong
  // branch with a note saying the tenant had no better record of a venue nobody
  // named. The order was right and the ticket was misleading, which is worse than
  // either being plainly wrong.
  const v1IsShell = !missingVenue && !!v1Row && isAShell(v1Row);
  // The city guard runs on a shell too: a row whose whole name is "London" is both,
  // and it must never be booked whichever of the two disqualifies it.
  // ONLY when a venue was actually named. With none, `locationText` is the "No
  // Location" placeholder, which has no identifying words by construction — so the
  // guard read it as a city-only match, refused the placeholder the engine had just
  // looked up, and provisioned a SECOND one carrying "No Location" as its address.
  const v1IsCityOnly = !missingVenue && !!v1Row && matchedOnCityAlone(facts.location_text, v1Row);
  const id = v1 && !v1IsShell && !v1IsCityOnly ? v1 : null;
  if (v1 && v1IsCityOnly) {
    // Said out loud: this is a venue the engine had an answer for and refused.
    return {
      provision: { name: locationText.slice(0, 120), country: "GB", address: locationText },
      note: `venue "${locationText}" names only a city — creating a new venue rather than booking crew to whichever row in that city happens to be richest`,
    };
  }
  if (id) {
    // matchPlace resolves on several rules, only one of which is equality; the others
    // are containment, which is a judgement. Only equality is cached as trusted.
    const wasExact = places.some(
      (p) => p.id === id && (normAddr(p.name) === key || normAddr(p.address) === key)
    );
    await aliasRecord(aliases, { kind: "place", alias_norm: key, entity_id: id,
                                 source: wasExact ? "exact" : "fuzzy", raw_example: locationText });
    return {
      id,
      note: missingVenue
        ? `no venue named — used the "${PLACEHOLDER_PLACE_NAME}" placeholder; set the real venue in OnSinch`
        : undefined,
    };
  }
  /**
   * SECOND PASS, and it only ever runs where the answer was already going to be a
   * new duplicate row. matchPlace found nothing, so the alternative to this is
   * provisioning — the mechanism that gave the tenant 632 ExCeL rows.
   *
   * Behind SPARTAN_VENUE_V2=0 because it is new and a venue is the one field that
   * sends people to a physical address. Nothing it does can change an answer
   * matchPlace already gives, so turning it off restores the previous behaviour
   * exactly.
   *
   * A `fuzzy` alias, never `exact`: token agreement is a judgement, and only
   * equality is cached as trusted.
   */
  if (!missingVenue && process.env.SPARTAN_VENUE_V2 !== "0") {
    const v2 = matchPlaceV2(locationText, places);
    if (v2.decision === "match" && v2.place_id) {
      await aliasRecord(aliases, { kind: "place", alias_norm: key, entity_id: v2.place_id,
                                   source: "fuzzy", raw_example: locationText });
      return { id: v2.place_id, note: v2.note ?? undefined };
    }
    // Several plausible buildings and no clear winner. Provisioning is still what
    // happens — a wrong building is worse than a duplicate row — but the ticket now
    // names the rows it was choosing between instead of silently creating a 633rd.
    if (v2.decision === "ambiguous") {
      return {
        provision: { name: locationText.slice(0, 120), country: "GB", address: locationText },
        note: `${v2.note} — creating a new venue rather than guessing; pick the right row in OnSinch`,
      };
    }
  }

  // The second pass found nothing better than the shell matchPlace matched. Use it:
  // a row that knows too little is still the row this venue already has.
  if (v1 && v1IsShell && !v1IsCityOnly) {
    return { id: v1, note: `venue "${locationText}" matched ${v1} "${String(v1Row?.name ?? "").trim()}", a row carrying no address — the tenant has no better record of this venue` };
  }

  return {
    // The placeholder is a NAME, not an address: creating it with address "No Location"
    // would put that string on a real job sheet as if it were somewhere to drive to.
    provision: missingVenue
      ? { name: PLACEHOLDER_PLACE_NAME, country: "GB" }
      : { name: locationText.slice(0, 120), country: "GB", address: locationText },
    note: missingVenue
      ? `no venue named — creating and using the "${PLACEHOLDER_PLACE_NAME}" placeholder; set the real venue in OnSinch`
      : `new venue "${locationText}" — will be created in OnSinch on confirm`,
  };
}

export async function compile(
  thread: HydratedThread,
  prior: ConversationState | undefined,
  deps: CompileDeps
): Promise<{ state: ConversationState; actions: Actions }> {
  const { reasoner, onsinch, now } = deps;
  const { latest, history, machine } = normalizeThread(thread);
  const notes: string[] = [];

  // 0a. Triage, before any model call. The mailbox now delivers everything rather than
  // what a Gmail label selected, so the filtering that used to happen upstream happens
  // here — and every message this rejects is one nobody paid $0.019 to read. The tiers
  // and the reasoning behind their order are in triage.ts; what matters here is that a
  // skip is RECORDED with its reason rather than silently dropped, so a wrong rule is
  // visible on the board instead of being an email that never existed.
  //
  // A thread already carrying an order is exempt: once we are on the hook for a booking,
  // every later message in it must be read, whatever a cheap rule thinks of the sender.
  if (!prior?.onsinch_order_id) {
    const t = await triage(
      { from: latest.from, subject: latest.subject, body: latest.body, is_from_spartan: latest.is_from_spartan, headers: latest.headers },
      { senderVerdict: deps.senderVerdict }
    );
    const mode = deps.triageMode ?? triageModeFromEnv();
    // In shadow mode a judgement skip is written down and then ignored, so the filter is
    // scored against what the model actually concluded instead of being trusted on
    // arithmetic about itself. The structural tiers still bind — see decisionBinds.
    if (t.verdict === "skip" && !decisionBinds(t, mode)) {
      notes.push(`triage WOULD have skipped this [${t.tier}]: ${t.reason} — shadow mode, read anyway`);
    }
    if (decisionBinds(t, mode)) {
      return {
        state: {
          ...(prior ?? {}),
          thread_id: thread.thread_id,
          subject: latest.subject,
          participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
          last_message_id: latest.message_id,
          last_processed_epoch: now(),
          classification: "not-a-job",
          facts: prior?.facts ?? { requests: [] },
          desired_order: null,
          pending_order: prior?.pending_order,
          priority: "low",
          needs_human: false,
          status: "ignored",
          notes: [`filtered before the model [${t.tier}]: ${t.reason}` + (t.reviewable ? " — reviewable" : "")],
          order_action_log: prior?.order_action_log ?? [],
        },
        actions: { none: true },
      };
    }
  }

  // 0. machine mail — nothing here was written by a client, so there is nothing
  // to reply to and nothing to book. Decided before the model runs: OnSinch's
  // own order notifications read as perfect enquiries, and acting on one means
  // patching a real order with invented hours and a guessed rate card. Prior
  // linkage (company/order ids) is carried through untouched.
  if (machine) {
    return {
      state: {
        ...(prior ?? {}),
        thread_id: thread.thread_id,
        subject: latest.subject,
        participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
        last_message_id: latest.message_id,
        last_processed_epoch: now(),
        classification: "not-a-job",
        facts: prior?.facts ?? { requests: [] },
        desired_order: null,
        pending_order: prior?.pending_order,
        priority: "low",
        needs_human: false,
        status: "ignored",
        notes: [`machine mail from ${latest.from} — not a client enquiry`],
        order_action_log: prior?.order_action_log ?? [],
      },
      actions: { none: true },
    };
  }

  // 1. classify, and take the facts from the same call when the reasoner can do both.
  // The two questions were asked of identical thread text, so asking them separately
  // sent the whole thread twice — 402M characters to label the corpus once. A reasoner
  // without the combined method (a mock, a different provider) still works.
  //
  // When the thread has already been read, the facts it produced are sent AS WELL as
  // the conversation — a summary alongside the evidence, with the conversation winning
  // where they disagree. The facts alone were tried and are not enough to classify on:
  // "does ANY client message in this thread ask for crew" cannot be answered from a
  // summary of what was already understood, and every repeat message on a live thread
  // took that path. mergeFacts below is what keeps a narrow answer safe — the model can
  // reply about one message without deleting what four earlier emails established.
  //
  // It costs the re-read the incremental path existed to avoid. Priced before the
  // change: NORMALISED history is 4,674 chars mean / 18,369 max over 307 live threads
  // (~1.2k tokens an event, ~34 events a day). The 6.26x figure that justified dropping
  // it was measured on raw bodies, which carry the quoted copies normalize now strips.
  const priorFacts = prior?.facts;
  const incremental =
    reasoner.classifyAndExtractIncremental &&
    priorFacts &&
    (Object.keys(priorFacts).length > 1 || (priorFacts.requests ?? []).length > 0) &&
    history.length > 0;

  const combined = incremental
    ? await reasoner.classifyAndExtractIncremental!(latest, priorFacts!, prior?.classification, !!prior?.onsinch_order_id, history)
    : reasoner.classifyAndExtract
      ? await reasoner.classifyAndExtract(latest, history, !!prior?.onsinch_order_id)
      : null;
  if (incremental) notes.push("read the whole conversation against the facts already stored for it");
  const cls = combined ?? (await reasoner.classify(latest, history, !!prior?.onsinch_order_id));

  // Keep the classifier's own explanation for a rejection. job_summary is the
  // reason ("N/A - Acknowledgment/confirmation only, no changes requested"); it
  // was used as the order specification for real jobs and discarded for
  // everything else, so the board's Dismissed lane had nothing to show — 18 of
  // the first 25 dismissals recorded no reason at all. The "N/A -" prefix is a
  // machine artefact of the prompt's output format, not something to show a human.
  // THE CLASSIFIER DEFERS TO THE EXTRACTOR.
  // This was written when the ported n8n prompt said "Never classify Thread History
  // messages. Only classify Current Email", so a thread whose newest message was
  // Spartan's own reply, a bounce or an emoji reaction was called junk while the
  // client's request sat one message earlier. Over a 150-thread random sample of the
  // year, 91 threads were labelled not-a-job, 28 of them carried a crew number and a
  // date, and 21 of the 41 with a dated block became real OnSinch orders anyway.
  // Fifteen were read by hand: 13 were genuine jobs.
  //
  // That instruction is GONE — CLASSIFY_SYSTEM now asks "does ANY client message in
  // the thread contain job-request language", and the whole labelled conversation is
  // what gets sent. The overrule stays anyway: it is the cheap backstop for the same
  // failure returning by another route, and it costs nothing on the combined path.
  //
  // So where the extractor finds a dated request WITH a crew size, it wins. A missed
  // job costs a booking; a spurious one costs someone ten seconds deleting a draft.
  // Costs one extra extraction call on threads the classifier rejected.
  let classification = cls.classification;
  let overruled = false;
  // The combined call already returned facts, so overruling a rejection now costs
  // nothing; only the two-call fallback has to pay for a second request.
  // Merged against what the thread already knew, ALWAYS — not only on the incremental
  // path. A model shown the whole thread can still answer thinly, and an overwrite would
  // drop a venue established in March because August's message did not repeat it.
  let mergeNote = "";
  let probed: ConversationFacts | null = null;
  if (combined) {
    const m = mergeFacts(prior?.facts, combined.facts);
    probed = m.facts;
    mergeNote = describeMerge(m.report);
    if (m.report.kept.length) {
      notes.push(`kept from earlier messages: ${m.report.kept.join(", ")}`);
    }
    if (mergeNote) notes.push(mergeNote);
  }
  if (classification === "not-a-job") {
    probed = probed ?? (await reasoner.extractFacts(latest, history));
    const usable = (probed.requests ?? []).some(
      (r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? "")) && Number(r.size) > 0
    );
    if (usable) {
      classification = prior?.onsinch_order_id ? "update" : "new-job";
      overruled = true;
      notes.push("classified as not-a-job, but the thread carries a dated request with a crew size — deferring to the extractor");
    } else {
      const why = (cls.job_summary ?? "").replace(/^\s*N\/A\s*[-–—:]\s*/i, "").trim();
      if (why) notes.push(why);
    }
  }

  // 2. only a real job triggers the order path
  //
  // THE ORDER WORK HAPPENS BEFORE THE REPLY, and that ordering is the point.
  // Composing first meant the reply was written knowing nothing about whether the
  // booking could actually be made, so it promised one either way: live thread
  // 19fadd4ff8152dea, a needs-info ticket whose company never resolved and which
  // has no order at all, drafted "both dates are now booked in". A drafted promise
  // a human sends unread is a booking Spartan has agreed to and not staffed.
  // Ben, 2026-08-09: "fix the commitment problem, compose the reply after the order."
  const isJob = classification === "new-job" || classification === "update";
  let facts: ConversationFacts = prior?.facts ?? { requests: [] };
  let desired = null as ConversationState["desired_order"];
  /**
   * A human must LOOK at this before it is confirmed. Set by every stand-in the
   * resolvers fall back to.
   */
  let needs_human = false;
  /**
   * The order cannot go out as built, and is not staged at all. Reserved for a
   * failed validateOrder — a body OnSinch would reject, or would accept and get
   * wrong.
   *
   * These two used to be one flag, which is why a thread missing a venue produced
   * nothing: any reason to involve a human was also a reason to withhold the order.
   * Ben, 2026-08-09: "creating a job correctly with all of the info we DO have,
   * consistently, is the goal." So a stand-in now flags the job; only a broken body
   * withholds it.
   */
  let blocked = false;
  let company_id = prior?.company_id;
  let user_id = prior?.user_id;
  let place_id = prior?.place_id;
  let linkedOrderId = prior?.onsinch_order_id;
  // Carried alongside the api id because they are what a human searches on. Both
  // come free with the dedup lookup, which already pulls `with=Job`.
  let linkedOrderNumber = prior?.onsinch_order_number;
  let linkedJobId = prior?.onsinch_job_id;
  let provisionPlace: DesiredOrder["provision_place"];
  let provisionCompany: DesiredOrder["provision_company"];
  /** Things only the client can tell us, without which no order can be built. */
  const askFor = new Set<string>();

  if (isJob) {
    // The probe above already extracted this thread's facts when the classifier was
    // overruled; extracting again would be a second identical model call.
    facts = probed ?? mergeFacts(prior?.facts, await reasoner.extractFacts(latest, history)).facts;

    // Check the model's reading against the words on the page. The 18:00 finish that
    // reached 4 of 10 real orders was a prompt instruction the model quietly stopped
    // following, and nothing noticed because a defaulted order looks exactly like a
    // real one. The parser fills what the model left blank and REPORTS what it reads
    // differently — it never overrules, because it cannot see prose and the model can.
    //
    // The reference date is the message's own timestamp, not today: "12 Sept" in a
    // thread from last October means October's year.
    const rec = reconcileRequests(
      `${latest.subject}\n${latest.body}`,
      facts.requests ?? [],
      new Date(Date.parse(latest.date_iso) || Date.now())
    );
    facts = { ...facts, requests: rec.requests };
    if (rec.report.filled.length) notes.push(`read from the email text: ${rec.report.filled.join(", ")}`);
    for (const c of rec.report.conflicts) notes.push(`DISAGREEMENT — ${c}`);
    // A rolled year is a date NOBODY wrote down, so it is said on the ticket. It is
    // the mitigation for the one case the rule gets wrong — a client deliberately
    // referring to a job months past — and the thing to watch in the first live week.
    for (const r of rec.report.rolled) notes.push(`rolled the year forward — ${r}`);

    // company first (contact resolution needs it)
    const co = await resolveCompany(facts, prior, onsinch, deps.aliases);
    company_id = co.id ?? company_id;
    provisionCompany = co.provision;
    if (co.note) notes.push(co.note);

    const [pl, us] = await Promise.all([
      resolvePlace(facts, prior, onsinch, deps.aliases, deps),
      resolveContact(facts, prior, company_id, onsinch),
    ]);
    const placeBefore = place_id;
    place_id = pl.id ?? place_id;
    provisionPlace = pl.provision;
    user_id = us.id ?? user_id;
    if (pl.note) notes.push(pl.note);
    if (us.note) notes.push(us.note);

    /**
     * A JOB THAT CHANGES BUILDING SAYS SO ON THE TICKET, WHATEVER DECIDED IT.
     *
     * Asserted here rather than inside resolvePlace because that function answers from
     * six different branches — the alias store, V3's adjudicator, V2's fuzzy match, the
     * shell fallback, matchPlace, provisioning — and only some of them return a note.
     * The venue that moved a booking in the study came back from a branch that did not
     * (`note: v2.note ?? undefined`), so the order relocated in silence.
     *
     * The caller is the only place that holds BOTH ids, so it is the only place that can
     * state the change rather than describe the decision. A first resolution is not a
     * move and must not be announced as one — `placeBefore` is undefined then.
     */
    if (placeBefore && place_id && place_id !== placeBefore) {
      notes.push(
        `VENUE MOVED — this thread was booked at place ${placeBefore} and this message moves it to ${place_id}` +
        (facts.location_text ? ` ("${facts.location_text}")` : "") +
        `; crew already told the old address must be redirected`
      );
    }

    /**
     * A block that names its OWN venue — "4 crew at ExCeL, then 2 at Olympia that
     * afternoon". Location is half of what separates one SlotTeam from another, and
     * until now nothing upstream could express it: every block inherited the order's
     * single place, so a job that moved crew between venues composed as one team.
     *
     * Only resolved against places that already exist. A per-block venue that does
     * not resolve keeps the order's place rather than provisioning a second one:
     * creating a venue from a fragment inside a request block is how the 632 ExCeL
     * shells got there in the first place, and the block-level string is the shortest
     * and least reliable venue text in the whole email.
     */
    /**
     * Learn the profession wordings this client actually uses (Ben, Q11).
     *
     * The resolver works every hint out from first principles on every email, so a
     * phrasing it gets right today it re-derives tomorrow, and one it gets WRONG is
     * wrong forever with nowhere for a human to correct it. The alias store is the
     * correction surface: `exact` rows resolve automatically, `fuzzy` rows are recorded
     * as suggestions and change nothing until someone confirms them — the same
     * human/exact/fuzzy split that already governs companies and places.
     *
     * Recorded here rather than inside resolveProfession so the resolver stays a pure
     * function: it is called from compose, which must not write to a database.
     */
    const learnedProfessions: Record<number, number> = {};
    for (const [i, r] of (facts.requests ?? []).entries()) {
      const hint = r.profession_hint?.trim();
      if (!hint) continue;
      const key = normProf(hint);

      // A wording somebody has already settled beats working it out again. This is the
      // whole point of the store: the same phrasing stops being re-derived, and a wrong
      // answer has somewhere to be corrected.
      const remembered = await aliasLookup(deps.aliases, "profession", key);
      if (remembered) {
        learnedProfessions[i] = remembered;
        continue;
      }

      const m = resolveProfession(hint, PROFESSION_LIST, { hours: undefined });
      if (m.why === "default") continue; // nothing was learned, so nothing is recorded
      await aliasRecord(deps.aliases, {
        kind: "profession",
        alias_norm: normProf(hint),
        entity_id: m.id,
        // Only a match on the tenant's own name for it is a fact. A keyword or a cue is
        // a judgement, and a judgement that resolves itself automatically is how one
        // wrong answer becomes permanent.
        source: m.why === "exact" || m.why === "alias" ? "exact" : "fuzzy",
        raw_example: hint,
      });
    }
    if (Object.keys(learnedProfessions).length) {
      facts = {
        ...facts,
        requests: (facts.requests ?? []).map((r, i) =>
          learnedProfessions[i] ? { ...r, profession_id: learnedProfessions[i] } : r
        ),
      };
    }

    const perBlock = (facts.requests ?? []).filter((r) => r.location_text?.trim());
    if (perBlock.length) {
      const places = await onsinch.allPlaces();
      let moved = 0;
      facts = {
        ...facts,
        requests: (facts.requests ?? []).map((r) => {
          if (!r.location_text?.trim()) return r;
          const id = matchPlace(r.location_text, places);
          if (!id || id === place_id) return r;
          moved++;
          return { ...r, place_id: id };
        }),
      };
      if (moved) notes.push(`${moved} block(s) name a different venue — staffed as separate teams`);
      else notes.push(`a block named its own venue but it did not resolve — kept on the job's venue`);
    }

    // Order dedup vs OnSinch — never create a second job for an existing one, and
    // never attach a change to the wrong one. See matchExistingOrder: the venue is
    // what separates a client's several jobs on the same day, and where it cannot,
    // the thread goes to a human rather than picking.
    if (company_id && !linkedOrderId) {
      const existing = matchExistingOrder(
        firstDate(facts),
        await onsinch.companyOrdersWithJob(company_id),
        facts.location_text
      );
      if (existing && "order_id" in existing) {
        linkedOrderId = existing.order_id;
        linkedOrderNumber = existing.order_number ?? linkedOrderNumber;
        linkedJobId = existing.job_id ?? linkedJobId;
        notes.push(
          `matched existing OnSinch order #${existing.order_id}${existing.job_id ? ` (job J${existing.job_id})` : ""} (${existing.by === "date+venue" ? "same date and venue" : "same date"}) — will update, not create`
        );
      } else if (existing) {
        // Deliberately does NOT fall through to creating a new order: on an update
        // that would duplicate a job that already exists. A human picks.
        needs_human = true;
        blocked = true;
        notes.push(
          `${existing.ambiguous} existing OnSinch orders for this client on ${existing.day} and the thread does not say which — ` +
            `not guessing; pick the right one by hand`
        );
      }
    }

    // Rate card (I1) — resolved before compose; no confident card => needs-human.
    //
    // This is the ONE thing still allowed to stop an order, and deliberately so. A
    // company being created has no order history, so it has no card, and there is no
    // safe stand-in: OnSinch silently assigns a default when the field is omitted,
    // which is precisely the wrong-rate failure Tracy reported. Nor is there a house
    // default to borrow — across the 100 most recent live orders the cards are 342
    // (49%) and 315 (30%), so the "197 is standard" in the API reference is stale and
    // a majority pick would be a coin-flip on what a client is charged.
    //
    // Everything else about the job is composed and staged; a human supplies this one
    // number and confirms. Money is the one field worth blocking on.
    let pricelist_category_id = 0;
    let rateSource: DesiredOrder["rate_card_source"];
    if (company_id) {
      const rate = await resolveRateCard(company_id, {
        onsinch,
        seededRateCard: deps.seededRateCard,
        defaultCard: deps.defaultRateCard,
      });
      if (rate.card) {
        pricelist_category_id = rate.card;
        rateSource = rate.source === "none" ? undefined : rate.source;
        if (rate.source === "default") {
          notes.push(
            `no pricing history for company ${company_id} — using the standard rate card ${rate.card}; ` +
              `CHECK THE PRICE — the job is booked (I1)`
          );
        }
      } else notes.push(`no confident rate card for company ${company_id} — needs a human (I1)`);
    } else if (provisionCompany) {
      // A company being created has no history by definition, so the standard card is
      // the only thing that lets its first job exist at all. It is now WRITTEN rather
      // than staged (Ben, 2026-08-27 — as few blockers to creating a job as possible),
      // and the note plus needs_human carry the price to a human through the "Manual"
      // tag instead of the booking waiting on one.
      const fallback = deps.defaultRateCard;
      if (Number.isInteger(fallback as number) && (fallback as number) > 0) {
        pricelist_category_id = fallback as number;
        rateSource = "default";
        notes.push(
          `"${provisionCompany.name}" is a new client — using the standard rate card ${fallback}; ` +
            `CHECK THE PRICE — the job is booked (I1)`
        );
      } else {
        notes.push(`"${provisionCompany.name}" is new, so it has no rate card yet — set one when confirming (I1)`);
      }
    }

    /**
     * What the CLIENT would have to tell us before this job can be booked.
     *
     * Ben, 2026-08-09: "it is fine if there is missing information in general, but
     * if there is missing information that impedes on the systems ability to
     * create an order, then we should ask for it in our reply."
     *
     * So this is deliberately not a list of everything unknown. It is the things
     * that stop an order existing AND that only the client can supply:
     *
     *   crew size, date, times   - nobody else knows what they want
     *   venue                    - only asked when there is no venue anywhere in
     *                              the thread, since an unrecognised one is created
     *
     * Company is EXCLUDED on Ben's instruction ("if not enough info is provided,
     * other than company"). A client should never be asked to confirm who they
     * are: an unknown company is created, and an unknown contact falls back to a
     * stand-in. Those are our problems to solve, not questions to put to them.
     *
     * The rate card is excluded for the same reason from the other direction - it
     * blocks the order, but it is Spartan's number to set, and asking a client
     * what to charge them would be absurd.
     */
    for (const r of facts.requests ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? ""))) { askFor.add("the date(s) you need crew"); }
      if (!(Number(r.size) > 0)) { askFor.add("how many crew you need"); }
      if (!r.start_time || !r.end_time) { askFor.add("the start and finish times"); }
    }
    if (!(facts.requests ?? []).length) {
      askFor.add("the date(s) you need crew");
      askFor.add("how many crew you need");
      askFor.add("the start and finish times");
    }
    if (!facts.location_text) askFor.add("the venue address");

    const havePlace = !!place_id || !!provisionPlace;
    const haveCompany = !!company_id || !!provisionCompany;
    if (haveCompany && user_id && havePlace && pricelist_category_id) {
      const composed = composeOrder({
        facts,
        /**
         * The live profession list when the deployment has one — the Neon cache, kept
         * fresh by scripts/pull-professions.mjs. Absent, compose falls back to the
         * committed PROFESSION_LIST, which is why a database outage costs accuracy on
         * professions added since the last commit and nothing more.
         */
        professions: deps.professions,
        // 0 => created on write from provisionCompany, exactly as place_id already works.
        company_id: company_id ?? 0,
        user_id,
        place_id: place_id ?? 0, // 0 => created on write from provisionPlace
        pricelist_category_id,
        orderName: orderTitle(cls.order_title, latest.subject, facts),
        jobName: jobNameFrom(facts),
        // The classifier's job_summary is its REASON, and on an overruled thread that
        // reason is a rejection ("N/A - acknowledgement only, no crew request"). Writing
        // that into the order specification would put a denial on the face of the job it
        // just created, so an overruled thread describes itself by its work instead.
        specification: overruled
          ? facts.requests.map((r) => r.task).filter(Boolean).join("; ").slice(0, 200) || "Crew request read from the thread"
          : cls.job_summary,
        intern_name: facts.customer_reference,
        // Stamped on every order the engine builds, so "who built this" is answerable
        // from the order itself rather than from the API key that happened to post it.
        order_manager_id: Number.isInteger(ORDER_MANAGER_ID) && ORDER_MANAGER_ID > 0 ? ORDER_MANAGER_ID : undefined,
      });
      composed.warnings.forEach((w) => notes.push(w));
      desired = composed.order;
      if (desired && provisionPlace) desired.provision_place = provisionPlace;
      if (desired && provisionCompany) desired.provision_company = provisionCompany;
      // Carried on the order itself so the write path can refuse to auto-send an
      // assumed price, whatever the dashboard's order_mode says.
      if (desired && rateSource) desired.rate_card_source = rateSource;
      if (desired) {
        const errs = validateOrder(desired);
        if (errs.length) {
          needs_human = true;
          blocked = true;
          notes.push(...errs);
        }
      }
      // A staged order built on a stand-in still goes to a human, but it goes there as
      // an ORDER rather than as an enquiry with nothing attached. needs_human means
      // "check this before confirming", not "nothing was produced".
      // Every stand-in the resolvers fell back to calls a human — including an
      // assumed rate card. The pipeline already refuses to auto-write that order,
      // but a price nobody chose must also SHOW on the board, or the click it is
      // waiting for never comes.
      if (provisionCompany || provisionPlace || user_id === PLACEHOLDER_CONTACT_ID || rateSource === "default") {
        needs_human = true;
      }

      /**
       * A ROLE THE RESOLVER DID NOT KNOW. The single highest-value line in the
       * profession work: it turns an invisible wrong booking into a visible question.
       *
       * Not blocked — the order is still built and still staged. An IPAF job booked
       * as general crew composes, validates and writes exactly like a correct one,
       * and nothing downstream ever re-reads the client's word for the role. This is
       * the only place that can say "somebody look at this" before the crew turn up
       * without the card.
       */
      if (composed.warnings.some((w) => w.includes(UNRECOGNISED_MARK))) {
        needs_human = true;
      }

      /**
       * composeOrder can decline: every request block lacked a crew size, or a date,
       * so there is no shift to build. Every id resolved, so nothing above fired —
       * and the thread was landing on the board as "drafted" with no order attached
       * and nobody called. A job that produced nothing is the single case most worth
       * surfacing, and it was the quietest.
       */
      if (!desired) {
        needs_human = true;
        blocked = true;
        notes.push("nothing bookable could be built from this thread — see the missing details above");
      }

      /**
       * A BOOKING WHOSE WORK HAS ALREADY HAPPENED IS NOT A BOOKING.
       *
       * Crew cannot be sent to a day that has gone, so an order dated entirely in the
       * past is never something to write — and writing it is worse than refusing,
       * because it succeeds. It reports `ordered`, it is a real row on a real client,
       * and it is filed where nobody will ever look for it.
       *
       * Caught by a live test on 2026-08-27: an enquiry saying "Thu 24 & Fri 25 Oct
       * 2024" produced order 15573 dated 2024-10-23, twenty-two months back. The engine
       * said it had booked the job. Ben: "i cant see the jobs inside of onsinch."
       *
       * THE YEAR RULE IS RIGHT AND THIS IS NOT A CONTRADICTION OF IT. `parseWork` rolls
       * a BARE day/month forward to its next occurrence, and deliberately leaves an
       * EXPLICIT past year alone, because a client can legitimately write "the 3rd of
       * March 2024" when querying an old invoice. That reasoning holds for reading the
       * date; it does not extend to booking crew for it. So the date is still read as
       * written — and then the order is held rather than sent.
       *
       * ENTIRELY, not partly. A multi-day job whose load-in has passed but whose show
       * days have not is a real and ordinary shape mid-job, and it must still book. Only
       * an order with no future work at all is stopped.
       *
       * The grace is a whole day rather than "before now": an order for this morning,
       * compiled this afternoon, is a real same-day booking that ops still act on.
       *
       * THE CLOCK IS THE INJECTED ONE, not Date.now(). Every other time decision in this
       * file already reads `now()`, and it is why the suite is deterministic: a rule that
       * compared against the wall clock would make every fixture in the repo rot on a
       * fixed date, and nine test files went red the moment this was written the other
       * way. A test that books "12 February" must not start failing on 13 February.
       */
      const shiftEnds = (desired?.slot_teams ?? [])
        .map((t) => Date.parse(t.end || t.beginning || ""))
        .filter((n) => Number.isFinite(n));
      if (desired && shiftEnds.length && Math.max(...shiftEnds) < now() - 24 * 60 * 60 * 1000) {
        const when = new Date(Math.max(...shiftEnds)).toISOString().slice(0, 10);
        needs_human = true;
        blocked = true;
        notes.push(
          `NOT BOOKED — every shift in this thread has already happened (the last ends ${when}). ` +
          `Crew cannot be booked for a past date. If the client meant a future year, correct the ` +
          `date and re-send; the order was deliberately not written because it would be invisible.`
        );
      }
    } else {
      // No rate card, or nothing dated to build a shift from. Nothing composed, so
      // nothing to stage — the thread stands on the board with the notes above saying
      // exactly which piece is missing.
      needs_human = true;
      blocked = true;
    }
  }

  /**
   * 3. NOW compose the reply, knowing what actually happened to the order.
   *
   * The reply is told two things it never had: whether a booking exists, and what
   * the client would have to send for one to exist. It can then say "we're getting
   * this booked in" instead of "booked in", and ask for the missing crew count in
   * the same breath rather than leaving a human to notice.
   *
   * `order_state` is deliberately coarse. The model is not shown ids, statuses or
   * anything it could leak into prose — only which of four situations it is in.
   */
  /**
   * "enquiries" scope keys off isJob, which is the SAME test the order path uses,
   * so the rule is exactly "reply where there is a booking to talk about". It
   * deliberately includes updates: a client moving a shift is asking for
   * something and expects an answer, and it is the classification the whole
   * engine already treats as a live request.
   *
   * Note this reads the classification AFTER the extractor may have overruled it,
   * so a thread the classifier called junk but which carries a dated crew request
   * still gets its reply. Gating on the raw classifier verdict would reintroduce
   * the miss that overrule exists to fix.
   */
  const inScope = (deps.replyScope ?? "all") === "all" || isJob;
  const repliesEnabled = deps.repliesEnabled !== false && inScope;
  const orderState: ReplyContext["order_state"] = !isJob
    ? "not-a-job"
    : desired && !blocked
      ? linkedOrderId
        ? "updating-existing"
        : "staged"
      : "blocked";
  const reply = repliesEnabled
    ? await reasoner.composeReply(latest, history, classification, {
        order_state: orderState,
        // Only worth asking about when it is the reason nothing exists. A staged
        // order that happens to lack a finish time already defaulted sensibly, and
        // a client does not need an email about it.
        ask_for: orderState === "blocked" ? [...askFor] : [],
      })
    : null;
  const replyHash = reply ? hash(reply.html) : undefined;

  // 4. decide actions (reads already happened; writes are returned only)
  const actions: Actions = {};
  if (reply && (!prior || prior.last_reply_hash !== replyHash)) {
    actions.createReplyDraft = {
      subject: reply.subject,
      html: reply.html,
      in_reply_to: latest.message_id,
    };
  }
  const desiredHash = desired ? hash(JSON.stringify(desired)) : undefined;
  // `blocked`, not `needs_human`: an order built on a stand-in venue or a company being
  // created is still an order, and staging it is the whole point — a human confirms it
  // in one click instead of typing it out from an email.
  if (desired && !blocked) {
    if (linkedOrderId) {
      // an existing order (ours or matched in OnSinch) — patch only if it changed
      if (desiredHash !== prior?.last_ordered_hash) {
        actions.patchOrder = { order_id: linkedOrderId, desired };
      }
    } else {
      actions.createOrder = desired;
    }
  }
  if (!actions.createReplyDraft && !actions.createOrder && !actions.patchOrder) {
    actions.none = true;
  }

  // needs-info, NOT error: nothing failed here, we simply cannot finish without
  // a human. "error" is reserved for an actual failure (see pipeline.ts).
  const status: ConversationState["status"] = needs_human
    ? "needs-info"
    : desired
    ? "ordered"
    : classification === "not-a-job"
    ? "ignored"
    : "drafted";

  const state: ConversationState = {
    thread_id: thread.thread_id,
    subject: latest.subject,
    participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
    last_message_id: latest.message_id,
    last_processed_epoch: now(),
    classification,
    cancellation: cls.cancellation === true,
    facts,
    company_id,
    user_id,
    place_id,
    onsinch_order_id: linkedOrderId,
    onsinch_order_number: linkedOrderNumber,
    onsinch_job_id: linkedJobId,
    desired_order: desired,
    last_ordered_hash: prior?.last_ordered_hash,
    /**
     * Both of these are written by the PIPELINE, after this function has returned, and
     * both have to survive into the next email's compile or the code that reads them
     * never runs.
     *
     * last_ordered_teams_hash is what tells a crew change apart from a PO follow-up.
     * tryReplace reads it off the state compile produces, so while it was dropped here
     * `teamsChanged` was false on every second email and delete-and-repost — the only
     * route a crew or time change has to an existing order — could not fire at all. The
     * change went to a note asking a human to apply it by hand, which is the behaviour
     * the replace path was built to end. Every test covering it builds the state by
     * hand and calls the pipeline directly, so all of them passed.
     *
     * last_ordered_teams is the same fact unhashed — the array the ids read back from
     * OnSinch correspond to, position by position. Dropped, an in-place amendment has
     * nothing to pair the live blocks against, declines every time, and every crew
     * change falls back to deleting the order.
     *
     * order_replace and order_amend are the crash-safety markers for a part-finished
     * replace and a part-finished amendment. Dropped, a resumed run cannot see that the
     * old order is already deleted, or which crew blocks it has already appended, and it
     * either never recovers or appends them twice.
     */
    last_ordered_teams_hash: prior?.last_ordered_teams_hash,
    last_ordered_teams: prior?.last_ordered_teams,
    last_ordered_team_ids: prior?.last_ordered_team_ids,
    order_replace: prior?.order_replace,
    order_amend: prior?.order_amend,
    priority: cls.priority,
    reply_body_html: reply?.html ?? prior?.reply_body_html,
    reply_subject: reply?.subject ?? prior?.reply_subject,
    reply_draft_id: prior?.reply_draft_id,
    last_reply_hash: replyHash ?? prior?.last_reply_hash,
    needs_human,
    status,
    notes,
    order_action_log: prior?.order_action_log ?? [],
  };

  return { state, actions };
}
