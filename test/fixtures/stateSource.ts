// ============================================================================
// The paused engine's conversation state as a TV source: what feed/project.ts drew from it until
// 27 Oct, when the old engine was retired (addendum Prompt 12). Production stopped passing states on
// 10-20 (DECISIONS V28); the projection tests still describe their cases in this shape, so the
// conversion lives here, with copies of the three old-engine predicates it read.
// ============================================================================
import { STATUS_TEXT, londonInstant, type FeedItem, type FeedKind, type FeedSource, type FeedWant } from "../../app/lib/feed/project";
import type { ConversationState, DesiredSlotTeam } from "../../app/lib/engine/types";
import { rNumbersIn } from "../../app/lib/engine/resolve";

const PLACEHOLDER_PLACE_IDS = new Set([2069, 6922, 87, 6581]);
const CHANGED_A_STANDING_ORDER: ReadonlySet<string> = new Set(["amend", "patch", "replace"]);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const firstName = (v: unknown) => str(v)?.split(/\s+/)[0] ?? null;

function cannotBeBooked(s: ConversationState): boolean {
  // Held for a retry, or raised by the sweep: a person is needed whatever the email was
  // classified as. Without this a confirmation-only thread whose order was deleted kept
  // no label at all (SP-08), because "not a job" returned false below.
  if (s.retry_pending || s.attention) return true;
  // An update the engine will not make is a Gmail tag (Ben, 2026-09-29; ops rarely open
  // the dashboard). It never cancels a booking, so a client cancelling one needs a person
  // — whatever the email was classified as: "we no longer need the crew" reads to the
  // model as not-a-job, and that left a booked thread untagged (verified 2026-10-01).
  if (s.cancellation === true && Number(s.onsinch_order_id) > 0) return true;
  const isJob = s.classification === "new-job" || s.classification === "update";
  if (!isJob) return false;
  // A write it HELD (a cancellation, a shrink to nothing, a suspected twin) did not
  // happen. Both were untagged: the holds returned before the tag step as `proposed`.
  if (s.status === "proposed" && s.pending_order) return true;
  if (s.status === "error") return true;
  // `needs-info` on a BOOKED thread whose only flag is a review note is not a failure
  // (every engine order names contact 2257, which raises the review flag): an
  // acknowledgement on a booked thread drew "Order Needs Updated" and, the four being
  // exclusive, lost its "Order Built" (verified 2026-10-01). Unbooked, it still held.
  if (s.status === "needs-info" && !(s.review_only && Number(s.onsinch_order_id) > 0)) return true;
  /**
   * `review_only` is the third shape, and it is NOT one of the three above: an order
   * that wrote cleanly and carries a stand-in somebody should look at — a client or a
   * venue created from a name alone, a placeholder contact, an assumed rate card.
   *
   * Those used to HOLD, and while they held, needs_human and "cannot be booked" were the
   * same sentence. Ben's rule that creating a client is never gated on information, and
   * the change that made an assumed rate card book rather than wait, made them different
   * sentences — and this predicate went on reading the old one. So every new-client
   * booking landed in the mailbox labelled unbookable, with a reason that read
   * "crew-chief rule: team of 6 -> 5 + 1 chief".
   *
   * The status check stays ABOVE this deliberately: a thread that held or threw has
   * nothing booked to review, whatever the compiler flagged on the way there.
   */
  return s.needs_human === true && s.review_only !== true;
}

function needsLabelFor(s: ConversationState): "Order Needs Built" | "Order Needs Updated" {
  if (Number(s.onsinch_order_id) > 0) return "Order Needs Updated";
  if (s.classification === "update" && s.attention?.kind !== "lost") return "Order Needs Updated";
  return "Order Needs Built";
}

/** "EAV6695", "HP1263": a client's own job reference. Postcodes ("SE9") are too short to match. */
const REF = /\b[A-Z]{2,5}-?\d{3,6}\b/g;

function wantOf(s: ConversationState): FeedWant {
  const subject = s.subject ?? "";
  const r_numbers = rNumbersIn(subject);
  const refs = new Set<string>();
  const cref = str((s.facts as { customer_reference?: unknown } | undefined)?.customer_reference);
  if (cref) refs.add(cref);
  for (const m of subject.matchAll(REF)) if (!/^R-?\d+$/i.test(m[0])) refs.add(m[0]);
  const teams: DesiredSlotTeam[] = s.desired_order?.slot_teams?.length ? s.desired_order.slot_teams : s.last_ordered_teams ?? [];
  const real = (v: unknown) => { const n = Number(v); return n > 0 && !PLACEHOLDER_PLACE_IDS.has(n) ? n : null; };
  const shifts = teams
    .map((t) => ({ b: Date.parse(String(t?.beginning ?? "")), e: Date.parse(String(t?.end ?? "")), p: real((t as { place_id?: unknown })?.place_id) }))
    .filter((x) => Number.isFinite(x.b) && Number.isFinite(x.e));
  return { r_numbers, refs: [...refs], place_id: real(s.place_id), shifts, sender: str(s.sender_email) };
}

function jobDays(s: ConversationState): string[] {
  const days = new Set<string>();
  for (const r of s.facts?.requests ?? []) if (r?.date && /^\d{4}-\d{2}-\d{2}/.test(r.date)) days.add(r.date.slice(0, 10));
  for (const t of s.desired_order?.slot_teams ?? []) if (t?.beginning && /^\d{4}-\d{2}-\d{2}/.test(t.beginning)) days.add(t.beginning.slice(0, 10));
  return [...days].sort();
}

/**
 * When the job next starts. The ordered blocks carry real instants; a request's date and
 * start time are London wall-clock. A day with no time counts from its first minute, so
 * the countdown never promises more time than there is.
 */
function nextStart(s: ConversationState, now: number): number | null {
  const at: number[] = [];
  for (const t of s.desired_order?.slot_teams ?? []) { const v = Date.parse(String(t?.beginning ?? "")); if (Number.isFinite(v)) at.push(v); }
  for (const r of s.facts?.requests ?? []) if (r?.date && /^\d{4}-\d{2}-\d{2}/.test(r.date)) { const v = londonInstant(r.date.slice(0, 10), r.start_time ?? "00:00"); if (Number.isFinite(v)) at.push(v); }
  const future = at.filter((v) => v >= now).sort((a, b) => a - b);
  return future[0] ?? null;
}

/**
 * The busiest single day, not the sum of every block: a three-day job of eight would
 * otherwise read "24 crew" on the TV, which is nobody's headcount.
 */
function crewOf(s: ConversationState): number | null {
  const teams: DesiredSlotTeam[] = s.desired_order?.slot_teams?.length ? s.desired_order.slot_teams : s.last_ordered_teams ?? [];
  if (!teams.length) return null;
  const perDay = new Map<string, number>();
  for (const t of teams) {
    const d = String(t?.beginning ?? "").slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? 0) + (Number(t?.size) || 0));
  }
  const max = Math.max(...perDay.values());
  return max > 0 ? max : null;
}

const epochMs = (n: unknown) => { const v = Number(n); return !Number.isFinite(v) || v <= 0 ? 0 : v < 1e12 ? v * 1000 : v; };

export function stateSource(s: ConversationState, lastInbound: Map<string, number>, now: number): FeedSource {
  return {
    thread_id: s.thread_id,
    days: jobDays(s),
    /**
     * `not-a-job` yields nothing EXCEPT where the engine's own predicate still holds: a client
     * calling a booked job off reads to the model as not-a-job, and cannotBeBooked keeps
     * that thread as a need on purpose (pipeline.ts, verified 2026-10-01). Dropping it here
     * would hide the most dangerous update there is.
     */
    item: s.classification === "not-a-job" && !cannotBeBooked(s) ? null : orderItem(s, lastInbound.get(s.thread_id)),
    order_id: Number(s.onsinch_order_id) > 0 ? Number(s.onsinch_order_id) : null,
    r_number: str(s.onsinch_order_number) ? `R${String(s.onsinch_order_number).replace(/^R/i, "")}` : null,
    j_number: Number(s.onsinch_job_id) > 0 ? `J${s.onsinch_job_id}` : null,
    company_id: Number(s.company_id) > 0 ? Number(s.company_id) : null,
    company: str(s.facts?.company_name),
    contact: firstName(s.facts?.contact_name),
    venue: str(s.facts?.location_text),
    subject: s.subject ?? "",
    crew: crewOf(s),
    starts_at: nextStart(s, now),
    last_write: Math.max(0, ...(s.order_action_log ?? []).filter((a) => a.ok).map((a) => epochMs(a.ts))),
    want: wantOf(s),
    note: null,
    resolvedText: resolvedText(s),
  };
}

/**
 * A thread's one order item, or null: a need while the engine's own predicate says a
 * person is required, otherwise the latest write it made, to be checked.
 *
 * The two are exclusive for the same reason the four labels are: a failure outranks a
 * success (flagBuiltIfNeeded), so a thread that needs a person shows the need and not
 * the order it also holds.
 */
function orderItem(s: ConversationState, lastInbound: number | undefined): Omit<FeedItem, "green"> & { order_id: number | null } | null {
  const order_id = Number(s.onsinch_order_id) > 0 ? Number(s.onsinch_order_id) : null;
  if (cannotBeBooked(s)) {
    const kind: FeedKind = needsLabelFor(s) === "Order Needs Built" ? "needs-created" : "needs-updated";
    /**
     * The client's latest email is part of the key. Without it a tick on "needs updated"
     * would outlive the next change the client sends, and the card for that change would
     * arrive already green.
     */
    return {
      item_key: `${kind}:${s.thread_id}:${order_id ?? 0}:${lastInbound ?? 0}`,
      kind, status: STATUS_TEXT[kind],
      at: lastInbound ?? epochMs(s.last_processed_epoch),
      order_id,
    };
  }
  if (!order_id) return null; // nothing booked to check; a cleared order is not "was created"
  const latest = [...(s.order_action_log ?? [])].reverse().find((a) => a.ok && (a.kind === "create" || CHANGED_A_STANDING_ORDER.has(a.kind)));
  if (!latest) return null;
  const kind: FeedKind = latest.kind === "create" ? "created-check" : "updated-check";
  const oid = Number(latest.order_id) > 0 ? Number(latest.order_id) : order_id;
  return { item_key: `${kind}:${oid}:${latest.ts}`, kind, status: STATUS_TEXT[kind], at: epochMs(latest.ts), order_id: oid };
}

/** What the resolved card says happened. The engine wrote nothing, so this reads its state. */
function resolvedText(s: ConversationState): string {
  if (s.classification === "not-a-job") return "Read as not a job by the system";
  if (Number(s.onsinch_order_id) > 0) return "Linked to an order by the system";
  return "No order needed any more, per the system";
}

/** Old-engine states as the projection's sources, as project() used to make them. */
export const fromStates = (states: ConversationState[], lastInbound: Map<string, number>, now: number): FeedSource[] =>
  states.filter((s) => s?.thread_id).map((s) => stateSource(s, lastInbound, now));
