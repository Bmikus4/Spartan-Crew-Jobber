// ============================================================================
// Decide, for free, whether a message is worth paying a model to read.
// ----------------------------------------------------------------------------
// The mailbox is moving from "whatever a Gmail label selected" to everything, so the
// filtering that used to happen upstream has to happen here. At $0.0189 an email the
// filter IS the cost model, and every decision made in this file is one nobody pays for.
//
// Measured over the 27,830-message corpus, the free rules already account for 55.5%:
// Spartan's own mail 49.6%, machine senders 3.7%, auto-replies and bounces 1.7%, no
// sender 0.5%. The 44.5% that reaches the model is almost all real enquiry traffic
// ("crew request", "quote", "website booking form"), which is why this is ordered as
// tiers rather than as a scoring model: the cheap tiers do the work, and there is very
// little left for a clever one to do.
//
// ORDER MATTERS AND IS NOT ARBITRARY. Cheapest and most certain first: identity before
// content, structure before prose. A rule that reads a body sits below one that reads
// an address, because addresses do not lie about who sent them and copy does.
//
// THE ASYMMETRY THAT GOVERNS EVERYTHING HERE: a false skip costs a booking; a false
// admit costs $0.019. So every tier that could plausibly be wrong about a human being
// is overridable by `looksLikeRealRequest`, and the rules that are NOT overridable are
// only those where being wrong is structurally impossible — our own outbound, and mail
// from a machine that cannot receive a reply.
// ============================================================================
import { isMachineSender, isAutoReply, isFromSpartan } from "./normalize";

export type TriageVerdict = "admit" | "skip";

export interface TriageResult {
  verdict: TriageVerdict;
  /** Which rule decided, for the audit trail and for measuring each tier's yield. */
  tier: string;
  reason: string;
  /**
   * A skip a human might disagree with, and should therefore be able to see. Machine
   * notifications are not reviewable (nobody wants a queue of Xero receipts); a sender
   * the ledger parked is, because that is a judgement about a person.
   */
  reviewable: boolean;
}

export interface TriageInput {
  from: string;
  subject: string;
  body: string;
  is_from_spartan?: boolean;
  /**
   * RFC headers, when the transport forwards them. The n8n payload does NOT today, which
   * is why `bulkFromBody` exists as a weak substitute — see the note on BULK_BODY.
   */
  headers?: Record<string, string | undefined>;
}

export interface TriageDeps {
  /**
   * What the sender ledger makes of this address: "parked" when they have written
   * repeatedly and never produced a booking, "trusted" when they have. Injected so the
   * engine stays testable with no database.
   */
  senderVerdict?: (from: string) => Promise<"trusted" | "parked" | "unknown">;
}

// ---------------------------------------------------------------- the safety valve
/**
 * A dated request with a crew size, which is what a booking actually looks like. This
 * is the same rule the compiler already uses to overrule the classifier, and it exists
 * for the same measured reason: 20 of 21 discarded threads in the R&D study became real
 * OnSinch orders anyway. Anything this matches reaches the model whatever else thought.
 */
const DATE = /\b(\d{1,2}[/.\-]\d{1,2}|\d{1,2}(st|nd|rd|th)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\btomorrow\b|\bnext (week|month)\b|\d{4}-\d{2}-\d{2})/i;
const CREW = /\b(\d+\s*x?\s*(crew|staff|technicians?|carpenters?|drivers?|locals?|riggers?|hands|labourers?)|crew of \d+|\bcrew\b|\bstaffing\b|\bshift\b)/i;
const ASKS = /\b(can you|could you|are you (free|available)|do you have|availability|quote|book(ing)?|cover|crew(ing)? for)\b/i;

export function looksLikeRealRequest(subject: string, body: string): boolean {
  const t = `${subject}\n${body}`;
  // Two of three signals. A date alone is a newsletter with a date in it; a date plus
  // crew, or crew plus an ask, is somebody wanting people on a day.
  const n = (DATE.test(t) ? 1 : 0) + (CREW.test(t) ? 1 : 0) + (ASKS.test(t) ? 1 : 0);
  return n >= 2;
}

// ------------------------------------------------------------------- bulk detection
/**
 * Bulk mail identifies ITSELF in headers, and this is the highest-leverage filter that
 * exists — a newsletter is required in practice to carry List-Unsubscribe, and no human
 * writing about crew ever does. It costs one dictionary lookup and has near-zero false
 * positives, which no content heuristic can claim.
 *
 * It is also, today, unavailable: the n8n payload forwards from/to/subject/body/date and
 * nothing else. Measured consequence — body-visible bulk markers appear on 0.6% of the
 * corpus, so guessing from content finds almost none of what the header would.
 */
const BULK_HEADERS = ["list-unsubscribe", "list-id", "list-help", "x-campaign-id", "x-mailer-id"];

export function bulkFromHeaders(h?: Record<string, string | undefined>): string | null {
  if (!h) return null;
  const get = (k: string) => {
    const hit = Object.keys(h).find((n) => n.toLowerCase() === k);
    return hit ? String(h[hit] ?? "") : "";
  };
  for (const k of BULK_HEADERS) if (get(k).trim()) return k;
  const prec = get("precedence").toLowerCase();
  if (/bulk|list|junk/.test(prec)) return `precedence: ${prec}`;
  const auto = get("auto-submitted").toLowerCase();
  if (auto && auto !== "no") return `auto-submitted: ${auto}`;
  if (/^yes$/i.test(get("x-spam-flag").trim())) return "x-spam-flag: yes";
  return null;
}

/** The weak substitute, used only while headers are missing. Deliberately narrow. */
const BULK_BODY = /\bunsubscribe\b|manage (your )?preferences|view (this|it) in (your )?browser|you are receiving this (email|because)|update your email preferences/i;

/**
 * Senders that are real companies writing real mail, but never about crew: accounting,
 * compliance, e-signature, payment rails. Kept as a list of DOMAINS because the local
 * part varies and the domain does not. normalize.ts already covers the no-reply SHAPE;
 * these are the ones that write from an ordinary-looking address.
 */
const NON_JOB_DOMAINS = [
  "xero.com", "crezco.com", "handshq.com", "quickbooks.com", "intuit.com",
  "sage.com", "docusign.net", "docusign.com", "adobesign.com", "hellosign.com",
  "stripe.com", "gocardless.com", "worldpay.com", "sumup.com",
  "linkedin.com", "indeed.com", "totaljobs.com", "reed.co.uk",
  "mailchimp.com", "sendgrid.net", "hubspot.com", "salesforce.com",
];

/**
 * Addresses that structurally cannot receive a reply. Mirrors normalize.ts's localpart
 * list on purpose: this file needs to tell "no human is behind this" apart from "this
 * company usually writes about invoices", and normalize.ts answers both as one boolean.
 */
const UNREPLIABLE_LOCALPART =
  /^(no-?reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce[sd]?|notifications?|automated|auto-?confirm|messaging-service)\b/i;

function domainOf(addr: string): string {
  const at = (addr || "").toLowerCase().trim();
  const i = at.lastIndexOf("@");
  return i < 0 ? "" : at.slice(i + 1).replace(/>$/, "").trim();
}

function isNonJobDomain(from: string): string | null {
  const d = domainOf(from);
  if (!d) return null;
  const hit = NON_JOB_DOMAINS.find((n) => d === n || d.endsWith("." + n));
  return hit ?? null;
}

// ---------------------------------------------------------------------------
/**
 * Triage one message. Pure apart from the injected ledger lookup, so every tier is
 * testable against a fixture.
 */
export async function triage(m: TriageInput, deps: TriageDeps = {}): Promise<TriageResult> {
  const from = String(m.from ?? "").trim();
  const subject = String(m.subject ?? "");
  const body = String(m.body ?? "");
  const rescued = looksLikeRealRequest(subject, body);

  // T0 — nothing to read. Not reviewable: there is no content to review.
  if (!from || !body.trim()) {
    return { verdict: "skip", tier: "no-content", reason: "no sender or no body", reviewable: false };
  }

  // T1 — our own outbound. Structurally never a client request, and replying to it loops.
  if (m.is_from_spartan || isFromSpartan(from)) {
    return { verdict: "skip", tier: "own-mail", reason: `sent by Spartan (${from})`, reviewable: false };
  }

  // T2 — a machine, and the distinction inside it matters.
  //
  // An UNREPLIABLE ADDRESS (no-reply@, mailer-daemon@, messaging-service@) is a fact
  // about the mailbox, not a guess: there is no human behind it to book a job with, so
  // this is the one tier a dated crew request may NOT override. That exemption is load
  // bearing — OnSinch's own notifier describes a real booking in real detail, and
  // rescuing it would have the engine re-book jobs OnSinch has already created.
  //
  // A VENDOR DOMAIN (xero.com, handshq.com) is only a guess, and a domain has humans on
  // it. `accounts@xero.com` asking for four crew on the 19th is a booking, and dropping
  // it unrescuably would trade a real job for a tidy rule. So the domain half is
  // overridable and reviewable, while the address half is neither.
  if (isMachineSender(from)) {
    const local = from.toLowerCase().split("@")[0] ?? "";
    if (UNREPLIABLE_LOCALPART.test(local)) {
      return { verdict: "skip", tier: "machine-sender", reason: `unrepliable address (${from})`, reviewable: false };
    }
    if (!rescued) {
      return { verdict: "skip", tier: "vendor-domain", reason: `${domainOf(from)} does not send crew enquiries`, reviewable: true };
    }
  }

  // T3 — bulk, by its own admission. Overridable, because a client on an events
  // newsletter list can still send crew requests from that address.
  const bulkHdr = bulkFromHeaders(m.headers);
  if (bulkHdr && !rescued) {
    return { verdict: "skip", tier: "bulk-header", reason: `bulk mail header (${bulkHdr})`, reviewable: true };
  }

  // T4 — an out-of-office or a bounce from a human address.
  if (isAutoReply(subject, body)) {
    return { verdict: "skip", tier: "auto-reply", reason: "out-of-office or delivery notification", reviewable: false };
  }

  // T5 — a business that never writes about crew.
  const nonJob = isNonJobDomain(from);
  if (nonJob && !rescued) {
    return { verdict: "skip", tier: "non-job-domain", reason: `${nonJob} does not send crew enquiries`, reviewable: true };
  }

  // T6 — bulk guessed from the body. Below the header tier because it is a guess, and
  // only trusted when the message does not read like a request.
  if (!m.headers && BULK_BODY.test(body) && !rescued) {
    return { verdict: "skip", tier: "bulk-body", reason: "body carries newsletter markers (no headers available)", reviewable: true };
  }

  // T7 — the ledger. A person who has written repeatedly and never produced a booking.
  // Always overridable: this is a judgement about a human, and the whole asymmetry of
  // the problem says to err towards reading it.
  if (deps.senderVerdict && !rescued) {
    const v = await deps.senderVerdict(from).catch(() => "unknown" as const);
    if (v === "parked") {
      return { verdict: "skip", tier: "sender-parked", reason: `${from} has written repeatedly without ever booking`, reviewable: true };
    }
  }

  return {
    verdict: "admit",
    tier: rescued ? "admit-request" : "admit",
    reason: rescued ? "states a date and a crew requirement" : "nothing cheap ruled it out",
    reviewable: false,
  };
}
