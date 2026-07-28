// ============================================================================
// orderLink — link an existing OnSinch order back to the inbox thread it came
// from. The order->thread direction, for the 30-most-recent-jobs backfill.
// ----------------------------------------------------------------------------
// OnSinch orders and Gmail threads share NO join key, so this is heuristic
// record linkage. The rule that matters: an ambiguous match escalates to a human
// and is NEVER auto-linked. A wrong link is worse than no link, because it
// silently attributes a real job to the wrong client conversation.
//
// The single most useful signal turned out to be free: Spartan name their orders
//   "<Company> [- <Sub-brand>] @ <Venue>"
// consistently ("Eclipse @ Warehouse", "Wacker Global - Brighton Pride @ Preston
// Park", "COG Live - Expo @  Excel, North Halls"). So company and venue can be
// parsed straight off the order name rather than inferred, and matched against
// what the thread says. Verified against the live tenant's 30 most recent orders.
//
// Pure functions only - no I/O, so the whole scorer is testable offline.
// ============================================================================
import { normName, normAddr } from "./resolve";

/** The order side of the comparison, flattened from the OnSinch response. */
export interface OrderSide {
  id: number;
  name?: string;            // "<Company> @ <Venue>"
  created?: string;         // when the order was raised
  happening?: string;       // the job date
  company_id?: number | null;
  user_id?: number | null;
  company_name?: string;    // resolved from company_id, when available
  contact_email?: string;   // resolved from user_id, when available
  specification?: string;
}

/** The thread side: what we know about one inbox conversation. */
export interface ThreadSide {
  thread_id: string;
  subject?: string;
  /** every address seen in the thread, client side preferred first */
  participants?: string[];
  /** the client's address, if already identified */
  contact_email?: string;
  company_name?: string;
  /** best venue/address text extracted from the thread */
  location_text?: string;
  /** YYYY-MM-DD dates the thread asks for */
  dates?: string[];
  /** ISO date of the first message - an order cannot predate its enquiry */
  first_message_iso?: string;
  /** resolved ids, when the engine already worked them out */
  company_id?: number | null;
  user_id?: number | null;
}

export interface Feature {
  name: string;
  weight: number;
  hit: boolean;
  /**
   * False when neither side carries the data to compare, e.g. the thread has no
   * resolved user_id yet. Unavailable evidence must NOT count as evidence
   * against a pair - otherwise a thread the engine has not resolved ids for can
   * never clear the link floor no matter how well everything else matches, which
   * is exactly the common case in a backfill.
   */
  evaluable: boolean;
  detail?: string;
}

export interface LinkScore {
  order_id: number;
  thread_id: string;
  /** hit weight over EVALUABLE weight, 0..1 */
  score: number;
  /** absolute weight of the evidence that did match - guards a 1.00 built on one feature */
  strength: number;
  features: Feature[];
  /** a feature that makes the pair impossible, e.g. the order predates the email */
  disqualified?: string;
}

export type LinkDecision =
  | { kind: "linked"; order_id: number; thread_id: string; score: number; features: Feature[] }
  | { kind: "ambiguous"; order_id: number; candidates: LinkScore[]; reason: string }
  | { kind: "unmatched"; order_id: number; best?: LinkScore; reason: string };

/** "Wacker Global - Brighton Pride @ Preston Park" -> parts. */
export function parseOrderName(name?: string): { company: string; sub?: string; venue?: string } {
  const raw = (name || "").trim().replace(/^[*^\s]+/, ""); // some names are flagged "*" / "^"
  const at = raw.lastIndexOf("@");
  const left = at === -1 ? raw : raw.slice(0, at);
  const venue = at === -1 ? undefined : raw.slice(at + 1).trim();
  // Sub-brand is after " - ", but only when it looks like a name, not a date range.
  const dash = left.indexOf(" - ");
  if (dash !== -1) {
    return { company: left.slice(0, dash).trim(), sub: left.slice(dash + 3).trim(), venue: venue || undefined };
  }
  return { company: left.trim(), venue: venue || undefined };
}

const domainOf = (email?: string) => (email || "").toLowerCase().split("@")[1] || "";

/** Do two normalised names overlap enough to count? Token containment, not equality. */
function nameOverlap(a?: string, b?: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const xs = new Set(x.split(" ").filter((t) => t.length > 2));
  const ys = y.split(" ").filter((t) => t.length > 2);
  if (!xs.size || !ys.length) return false;
  const shared = ys.filter((t) => xs.has(t)).length;
  // both sides are short, so require most of the smaller side to be present
  return shared >= Math.max(1, Math.min(xs.size, ys.length) - 0);
}

function addrOverlap(a?: string, b?: string): boolean {
  const x = normAddr(a);
  const y = normAddr(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const xs = new Set(x.split(" ").filter((t) => t.length > 3));
  const shared = y.split(" ").filter((t) => t.length > 3 && xs.has(t)).length;
  return shared >= 2; // two substantive venue tokens in common
}

const DAY = 86_400_000;

/**
 * Score one (order, thread) pair. Weights are deliberately blunt and additive:
 * with 30 orders and no labelled training data, a tuned model would be false
 * precision. What carries the decision is the exact-identity evidence (contact
 * email, resolved ids), with names and dates as corroboration.
 */
export function scoreLink(order: OrderSide, thread: ThreadSide): LinkScore {
  const parsed = parseOrderName(order.name);
  const features: Feature[] = [];
  const add = (name: string, weight: number, hit: boolean, evaluable: boolean, detail?: string) =>
    features.push({ name, weight, hit, evaluable, detail });

  // --- identity: the strongest available evidence
  const threadEmails = [thread.contact_email, ...(thread.participants ?? [])].filter(Boolean).map((e) => e!.toLowerCase());
  const emailHit = !!order.contact_email && threadEmails.includes(order.contact_email.toLowerCase());
  add("contact_email", 0.40, emailHit, !!order.contact_email && threadEmails.length > 0, order.contact_email);

  const idHit = order.user_id != null && thread.user_id != null && order.user_id === thread.user_id;
  add("user_id", 0.30, idHit, order.user_id != null && thread.user_id != null, idHit ? String(order.user_id) : undefined);

  const coIdHit = order.company_id != null && thread.company_id != null && order.company_id === thread.company_id;
  add("company_id", 0.20, coIdHit, order.company_id != null && thread.company_id != null, coIdHit ? String(order.company_id) : undefined);

  // --- company by name, from the order name or the resolved company
  const orderCompany = order.company_name || parsed.company;
  const senderWord = thread.contact_email ? domainOf(thread.contact_email).split(".")[0] : "";
  const companyHit =
    nameOverlap(orderCompany, thread.company_name) ||
    // the sender's domain often carries the company name ("eclipse.co.uk")
    (!!orderCompany && !!senderWord && nameOverlap(orderCompany, senderWord));
  add("company_name", 0.20, companyHit, !!orderCompany && (!!thread.company_name || !!senderWord), orderCompany);

  // --- venue
  const venueHit = addrOverlap(parsed.venue, thread.location_text);
  add("venue", 0.15, venueHit, !!parsed.venue && !!thread.location_text, parsed.venue);

  // --- the job date the thread asked for
  const happening = order.happening ? order.happening.slice(0, 10) : "";
  const dateHit = !!happening && (thread.dates ?? []).some((d) => (d || "").slice(0, 10) === happening);
  add("happening_date", 0.20, dateHit, !!happening && !!(thread.dates ?? []).length, happening);

  // --- subject often repeats the venue or the company
  const subjectHit =
    nameOverlap(orderCompany, thread.subject) || addrOverlap(parsed.venue, thread.subject);
  add("subject_echo", 0.05, subjectHit, !!thread.subject);

  // --- plausibility: an order is raised AFTER the enquiry arrives, and near it
  let disqualified: string | undefined;
  if (order.created && thread.first_message_iso) {
    const gap = Date.parse(order.created) - Date.parse(thread.first_message_iso);
    if (gap < -2 * DAY) {
      disqualified = `order raised ${Math.round(-gap / DAY)}d before the thread started`;
    } else {
      add("raised_after_enquiry", 0.10, gap <= 120 * DAY, true, `${Math.round(gap / DAY)}d after`);
    }
  }

  const evaluable = features.filter((f) => f.evaluable);
  const total = evaluable.reduce((n, f) => n + f.weight, 0);
  const got = evaluable.reduce((n, f) => n + (f.hit ? f.weight : 0), 0);
  return {
    order_id: order.id,
    thread_id: thread.thread_id,
    score: total ? Math.min(1, got / total) : 0,
    strength: got,
    features,
    disqualified,
  };
}

/** Decisive on its own: the same contact email, or the same resolved contact id. */
function hasIdentityEvidence(s: LinkScore): boolean {
  return s.features.some((f) => (f.name === "contact_email" || f.name === "user_id") && f.hit);
}

export interface DecideOptions {
  /** score at or above which a link may be made at all */
  linkFloor?: number;
  /** the runner-up must be at least this far below the winner */
  margin?: number;
  /**
   * Absolute matched weight required, so a perfect ratio built on a single
   * evaluable feature ("the subject mentions Olympia") cannot link on its own.
   */
  minStrength?: number;
  /** and at least this many distinct features must actually match */
  minHits?: number;
}

/**
 * Pick the thread for one order, or refuse. Refusing is a valid, expected answer:
 * the backfill shows those as needs-human rather than guessing.
 */
export function decideLink(order: OrderSide, threads: ThreadSide[], opts: DecideOptions = {}): LinkDecision {
  const linkFloor = opts.linkFloor ?? 0.5;
  const margin = opts.margin ?? 0.12;
  const minStrength = opts.minStrength ?? 0.35;
  const minHits = opts.minHits ?? 2;

  const scored = threads
    .map((t) => scoreLink(order, t))
    .filter((s) => !s.disqualified)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { kind: "unmatched", order_id: order.id, reason: "no eligible thread" };

  const [best, second] = scored;

  // Identity evidence wins outright unless another candidate ALSO has it.
  if (hasIdentityEvidence(best)) {
    const others = scored.slice(1).filter(hasIdentityEvidence);
    if (others.length) {
      return {
        kind: "ambiguous", order_id: order.id,
        candidates: [best, ...others].slice(0, 5),
        reason: "more than one thread carries the same contact identity",
      };
    }
    return { kind: "linked", order_id: order.id, thread_id: best.thread_id, score: best.score, features: best.features };
  }

  if (best.score < linkFloor) {
    return { kind: "unmatched", order_id: order.id, best, reason: `best score ${best.score.toFixed(2)} below floor ${linkFloor}` };
  }
  const hits = best.features.filter((f) => f.hit).length;
  if (best.strength < minStrength || hits < minHits) {
    return {
      kind: "unmatched", order_id: order.id, best,
      reason: `too little evidence (strength ${best.strength.toFixed(2)} < ${minStrength} or ${hits} hit(s) < ${minHits})`,
    };
  }
  if (second && best.score - second.score < margin) {
    return {
      kind: "ambiguous", order_id: order.id,
      candidates: scored.slice(0, 5),
      reason: `top two within ${margin} (${best.score.toFixed(2)} vs ${second.score.toFixed(2)})`,
    };
  }
  return { kind: "linked", order_id: order.id, thread_id: best.thread_id, score: best.score, features: best.features };
}
