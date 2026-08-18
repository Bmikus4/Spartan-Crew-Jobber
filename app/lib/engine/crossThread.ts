// ============================================================================
// Is this enquiry the same job as one we are already holding, in another thread?
// ----------------------------------------------------------------------------
// A client emails twice about one job — a second thread from a different person at
// the same company, a forward that lost its history, a "re-sending as the last one
// bounced". Treated as two jobs that is two orders and crew booked twice.
//
// THE FLOOR (Ben, Q4, 2026-08-18): same client AND same date AND same venue. All
// three, no substitutions.
//
// The looser shapes were on the table and are out. Client + date alone is not a
// gate at all: across the tenant's 1,029 recent orders, 121 of 870 company+date
// keys already carry more than one order — 13.9% — so it would fire on one real
// pair in seven and be wrong the rest of the time. Company 128 has FIVE orders on
// 2026-06-09, at three different venues.
//
// WHAT A MATCH MEANS is not "duplicate". Ben, same day: two threads that agree on
// client, date and venue may be one job whose second half is an ADDITIONAL SlotTeam
// — a different time window, or a different part of the site. That is the same rule
// that splits teams inside one thread, arriving by email instead. So the finding is
// "these belong together", and how they belong is stated rather than assumed.
//
// WHAT IT PRODUCES is never an order. Ben's standing constraint: a cross-thread
// same-job suspicion produces a DRAFT EMAIL ONLY, never a draft order. And Q6: that
// email is internal, addressed to bookings@, because it is an ops question. Asking a
// client to disambiguate our own order book reads as disorganised.
//
// The reinforcers — crew size, time windows — do not open the gate and cannot close
// it. They rank what is already through it, so the strongest candidate is named
// first in an email a human still has to read.
// ============================================================================
import { normAddr } from "./resolve";

export interface ThreadShape {
  thread_id: string;
  subject?: string;
  company_id?: number;
  place_id?: number;
  /** YYYY-MM-DD, one per requested block. */
  dates: string[];
  /** "HH:MM-HH:MM" per requested block, when stated. */
  windows: string[];
  /** Crew sizes per requested block. */
  sizes: number[];
  /** The venue as the email wrote it, for the case where neither side resolved one. */
  location_text?: string;
  /** An order already exists for this thread — what a second thread would join. */
  onsinch_order_id?: number;
}

export interface CrossThreadMatch {
  thread_id: string;
  /** The dates both threads name. Never empty — a shared date is part of the floor. */
  shared_dates: string[];
  /**
   * How the two relate, as far as the shapes can say:
   *   duplicate  the same window and the same size — the second thread says nothing new
   *   extension  the same day and place, a DIFFERENT window — an additional SlotTeam
   *   unclear    they agree on the floor and nothing separates or joins them further
   */
  relation: "duplicate" | "extension" | "unclear";
  /** Ranking only. Never a threshold — the floor is the gate. */
  score: number;
  /** Plain sentences for the email. Never ids on their own. */
  reasons: string[];
}

const dayOnly = (s: string) => String(s ?? "").slice(0, 10);

/** Two venues are the same when the ids agree, or when neither side has an id. */
function sameVenue(a: ThreadShape, b: ThreadShape): boolean {
  if (a.place_id && b.place_id) return a.place_id === b.place_id;
  // A thread whose venue never resolved is not thereby a match for everything: it
  // has to say the same thing in words, and say enough of it to mean anything.
  const x = normAddr(a.location_text);
  const y = normAddr(b.location_text);
  return x.length >= 6 && x === y;
}

/**
 * Other threads that look like the same job as `current`.
 *
 * Returns strongest first. An empty array is the overwhelmingly common answer and
 * the only one that costs nothing.
 */
export function findCrossThreadMatches(current: ThreadShape, others: ThreadShape[]): CrossThreadMatch[] {
  if (!current.company_id || !current.dates.length) return [];
  const out: CrossThreadMatch[] = [];

  for (const other of others) {
    if (other.thread_id === current.thread_id) continue;
    // THE FLOOR. All three, every time.
    if (!other.company_id || other.company_id !== current.company_id) continue;
    const shared = current.dates.map(dayOnly).filter((d) => other.dates.map(dayOnly).includes(d));
    if (!shared.length) continue;
    if (!sameVenue(current, other)) continue;

    const reasons = [
      `same client (company ${current.company_id})`,
      `same date${shared.length > 1 ? "s" : ""} ${shared.join(", ")}`,
      current.place_id && other.place_id ? `same venue (place ${current.place_id})` : `same venue, by name`,
    ];

    // Reinforcers: ranking, never gating.
    let score = 3;
    const sharedWindow = current.windows.some((w) => other.windows.includes(w));
    const sharedSize = current.sizes.some((n) => other.sizes.includes(n));
    if (sharedWindow) { score += 2; reasons.push("the same time window appears in both"); }
    if (sharedSize) { score += 1; reasons.push("the same crew size appears in both"); }
    if (other.onsinch_order_id) { score += 1; reasons.push(`the other thread already has order ${other.onsinch_order_id}`); }

    /**
     * A DIFFERENT window on the same day at the same place is the interesting case:
     * it is what an additional SlotTeam looks like arriving as a second email, and
     * calling it a duplicate would delete half a job.
     */
    const bothStated = current.windows.length > 0 && other.windows.length > 0;
    const relation: CrossThreadMatch["relation"] =
      sharedWindow && sharedSize ? "duplicate"
      : bothStated && !sharedWindow ? "extension"
      : "unclear";
    if (relation === "extension") reasons.push("the windows differ — this may be an extra slot team on the same job, not a repeat");

    out.push({ thread_id: other.thread_id, shared_dates: shared, relation, score, reasons });
  }

  return out.sort((a, b) => b.score - a.score);
}

export interface InternalDraft {
  to: string;
  subject: string;
  body: string;
}

/**
 * The draft that goes to ops. Q6: internal, never client-facing.
 *
 * It states what it found and what the two possibilities are, and it asks for a
 * decision rather than announcing one — the whole reason this is an email and not
 * an order is that the engine is not sure.
 */
export function crossThreadDraft(current: ThreadShape, matches: CrossThreadMatch[]): InternalDraft | null {
  if (!matches.length) return null;
  const top = matches[0];
  const what =
    top.relation === "extension"
      ? "The times differ, so this may be an additional slot team on the job that already exists rather than a repeat of it."
      : top.relation === "duplicate"
        ? "The times and crew sizes match, so this looks like the same request arriving twice."
        : "Nothing in either thread separates them further.";

  const lines = [
    `Two threads look like one job and the engine has not acted on either.`,
    ``,
    `  this thread   ${current.thread_id}  ${current.subject ?? "(no subject)"}`,
    ...matches.map((m) => `  also          ${m.thread_id}  (${m.relation}, ${m.shared_dates.join(", ")})`),
    ``,
    `Why they matched:`,
    ...top.reasons.map((r) => `  - ${r}`),
    ``,
    what,
    ``,
    `No order has been created or changed for this. Someone needs to say whether it is`,
    `one job or two; the engine will not guess between them.`,
  ];

  return {
    to: "bookings@spartancrew.co.uk",
    subject: `Possible duplicate job: ${current.subject ?? current.thread_id}`,
    body: lines.join("\n"),
  };
}
