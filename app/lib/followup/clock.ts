// ============================================================================
// Who is waiting for whom, since when, and whether that wait is now overdue.
// ----------------------------------------------------------------------------
// NOTHING HERE TOUCHES A DATABASE AND NOTHING HERE EMITS. Every input is passed in
// and every output is a decision. A follow-up planned an hour ago was planned
// against an hour-old suppression, so the acting path re-reads state and asks
// again; a module that fetched its own inputs would invite a caller to decide once
// and trust it.
//
// THE STATE IS DERIVED, NOT ACCUMULATED. `since` is the timestamp of the message
// where the direction of the conversation FLIPPED, read off the thread each time.
// Nothing is incremented and nothing is stamped at processing time. Three separate
// requirements then cost no code at all:
//
//   "further messages from the same waiting party must not reset the clock"
//        a same-direction message does not move the flip point. A client who chases
//        twice is still owed a reply from when they FIRST asked.
//   "duplicate or delayed intake events must not corrupt deadlines"
//        recomputing from the same messages gives the same answer. Replay is free
//        rather than defended, so there is no event ledger to keep consistent.
//   "do not infer everything solely from the most recent Gmail message"
//        the flip point is a property of the sequence, not of its last element.
//
// THE LABEL IS A PURE PREDICATE. A thread wears "needs follow-up" exactly when it
// has an overdue, unsuppressed waiting period. Stored state is therefore needed for
// only three things, all of them facts about US rather than about the thread: that a
// human suppressed it, what Gmail currently shows (so the same call is not made
// twice), and any queued send. Nothing else is worth persisting, because everything
// else can be recomputed from the messages.
//
// A DRAFT IS NOT A MESSAGE, and it is not defended against here. Unsent drafts are
// dropped at ingest (threadMessagesDb.isAnUnsentDraft), so they never reach a caller
// of this module. If that guard is ever removed, the inversion returns HERE — a
// draft of ours would read as Spartan having answered and would silently turn "the
// client is waiting on us" into "we are waiting on the client".
// ============================================================================
import { isMachineMessage } from "../engine/normalize";
import type { ThreadMessage } from "../engine/types";

/**
 * "us"   the client spoke last and nobody has answered — Spartan owes a reply.
 *        The far more expensive silence, and the one a funnel cannot see afterwards.
 * "them" Spartan spoke last and asked for something — the client owes a reply.
 */
export type Owed = "us" | "them";

/** Both directions share one threshold. Ben's spec: the same 24 hours either way. */
export const THRESHOLD_HOURS = 24;

/**
 * The label and the draft land at the threshold. The auto-send path — off by default
 * and separately disableable — becomes eligible no earlier than threshold + grace.
 *
 * Ben confirmed this split on 2026-09-29, after the spec's own definition of the grace
 * period was lost to a truncation. It is the only thing the grace governs: nothing
 * about a draft waits for it, because a draft harms nobody by existing early.
 */
export const SEND_GRACE_HOURS = 6;

/**
 * PAST THIS, A WAIT IS DORMANT RATHER THAN OVERDUE, and no new follow-up is raised.
 *
 * Measured over the stored corpus on 2026-09-29 (scripts/followup-census.ts): of 772
 * threads, 329 carry an open wait, and at the pause 222 of those — 68% — were already
 * more than seven days old, 72 of them more than thirty, four more than ninety. A
 * clock with no horizon calls every one of them overdue, so switching the feature on
 * would chase clients about enquiries from two months ago. A thread silent that long
 * did not stall; it ended somewhere this mailbox cannot see, usually on the phone.
 *
 * IT GATES NEW LABELS ONLY, NEVER REMOVES ONE. A label already applied means a human
 * has been told this needs them, and ageing past the horizon must not quietly retract
 * that — the label comes off when the wait actually ends, or when a human says so.
 *
 * NOTE WHAT THIS DOES AT RESUME. Intake stopped 2026-09-18 and every pre-pause wait
 * is now older than the horizon, so on the day intake comes back the feature raises
 * NOTHING on the backlog and starts clean on new mail. That is deliberate and it is
 * the safest possible first day: the alternative is 329 labels in one tick, on threads
 * the team has spent a fortnight handling by hand.
 */
export const DORMANT_AFTER_DAYS = 7;

export interface WaitingPeriod {
  owed_by: Owed;
  /** The flip point: when the party now waiting FIRST spoke without being answered. */
  since_iso: string;
  since_message_id: string;
  due_iso: string;
}

const HOUR = 3_600_000;

/** A response that could satisfy anyone. Machine mail cannot, and neither can nothing. */
export function substantive(m: ThreadMessage): boolean {
  return !isMachineMessage(m);
}

/**
 * Words that END a conversation rather than continue it.
 *
 * Kept deliberately tight and anchored to a SHORT body. "Thanks, and can you also
 * cover Sunday?" is not a closure, and a long message that happens to open with
 * "thanks" is almost never one either. The cost of a false positive here is a
 * follow-up nobody sends; the cost of a false negative is chasing a client who
 * already said the job was done, which is the error that makes people turn a
 * system off.
 */
const CLOSURE =
  /^\s*(many\s+)?(thanks|thank you|cheers|perfect|great|brilliant|lovely|noted|received|understood|ok|okay|will do|see you (then|there)|all good|no (further )?(action|worries))\b/i;

/**
 * Something that asks the other side for an answer.
 *
 * A question mark is the strongest signal and the cheapest; the phrases catch the
 * polite English that omits one ("let me know if that works for you.").
 */
const ASKS =
  /\?|\b(can|could|would|will) you\b|\bplease (confirm|advise|let me know|send|provide)\b|\blet me know\b|\bdo you (have|need|want)\b|\bare you able\b|\bany update\b|\bchase\b/i;

function firstLines(body: string, n = 400): string {
  return (body || "").trim().slice(0, n);
}

/** Is this message pure sign-off, with nothing asked? */
export function closureOnly(m: ThreadMessage): boolean {
  const b = firstLines(m.body, 160);
  if (!b) return false;
  if (ASKS.test(b)) return false;
  return CLOSURE.test(b) && b.length <= 160;
}

/**
 * Does this message oblige the OTHER side to answer?
 *
 * The two directions are deliberately asymmetric, and the asymmetry is the point.
 *
 *   A CLIENT message needs an answer unless it is pure sign-off. Silence toward a
 *   client is the expensive failure — it loses the booking and nobody sees it happen.
 *
 *   A SPARTAN message needs an answer only when it actually asked for one. "Confirmed,
 *   three crew Friday, see you then" obliges the client to do nothing, and chasing
 *   them for a reply they never owed is the error that gets a follow-up system
 *   switched off. So an outbound message starts a waiting period only when it asks.
 */
export function needsResponse(m: ThreadMessage): boolean {
  if (closureOnly(m)) return false;
  if (m.is_from_spartan) return ASKS.test(firstLines(m.body));
  return true;
}

/**
 * The open wait on this thread, or null when nobody owes anybody anything.
 *
 * THE TRAILING RUN, NOT THE LAST MESSAGE. Everything from the flip point onward is
 * one party talking. The period stands if ANY message in that run asked for
 * something, and it dates from the FIRST of them — so a client who asks on Monday
 * and chases on Tuesday is owed a reply from Monday, and the chase does not buy
 * another 24 hours of silence. That single choice is the whole of "further messages
 * from the same waiting party must not continually reset the clock".
 */
export function waitingPeriod(messages: readonly ThreadMessage[]): WaitingPeriod | null {
  const live = messages
    .filter(substantive)
    .filter((m) => Number.isFinite(Date.parse(m.date_iso)))
    .sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
  if (!live.length) return null;

  const last = live[live.length - 1];
  const owed_by: Owed = last.is_from_spartan ? "them" : "us";

  // Walk back over the unbroken run of messages from the same side.
  let i = live.length - 1;
  while (i > 0 && live[i - 1].is_from_spartan === last.is_from_spartan) i--;
  const run = live.slice(i);

  // Nobody in that run asked for anything: the conversation is finished, not waiting.
  if (!run.some(needsResponse)) return null;

  const first = run.find(needsResponse)!;
  return {
    owed_by,
    since_iso: first.date_iso,
    since_message_id: first.message_id,
    due_iso: new Date(Date.parse(first.date_iso) + THRESHOLD_HOURS * HOUR).toISOString(),
  };
}

export function isOverdue(w: WaitingPeriod, now: Date): boolean {
  return now.getTime() >= Date.parse(w.due_iso);
}

/** Silent so long that the conversation ended somewhere this mailbox cannot see. */
export function isDormant(w: WaitingPeriod, now: Date): boolean {
  return now.getTime() - Date.parse(w.since_iso) > DORMANT_AFTER_DAYS * 24 * HOUR;
}

/**
 * Whether a SEND — never a draft — would be in time. Drafting happens at the
 * threshold; this is the extra grace before anything could leave the building, and
 * it is consulted only by a path that is off by default.
 */
export function sendEligible(w: WaitingPeriod, now: Date): boolean {
  return now.getTime() >= Date.parse(w.due_iso) + SEND_GRACE_HOURS * HOUR;
}

export interface FollowupState {
  /** What Gmail currently shows, so an unchanged thread costs no API call. */
  labelled: boolean;
  /** A human said this thread does not need chasing. Outranks everything. */
  suppressed: boolean;
}

export type FollowupAction =
  | { kind: "none"; why: string }
  | { kind: "apply"; period: WaitingPeriod }
  | { kind: "clear"; why: string };

/**
 * What to do with the "needs follow-up" label right now.
 *
 * A thread wears it exactly when it has an overdue, unsuppressed waiting period —
 * so this compares that predicate to what Gmail already shows and returns the
 * difference. There is no third state and no queue to drain.
 *
 * CLEARING IS NOT CONDITIONAL ON WHY THE WAIT ENDED. A reply, a suppression, or a
 * closing "thanks" all produce the same instruction, because the label means one
 * thing — somebody is overdue — and it is either true or it is not. The caller
 * invalidates any queued send on a `clear`, which is what stops a chase going out
 * minutes after the client finally answered.
 */
export function decide(
  messages: readonly ThreadMessage[],
  state: FollowupState,
  now: Date = new Date()
): FollowupAction {
  if (state.suppressed) {
    return state.labelled
      ? { kind: "clear", why: "a human suppressed follow-ups on this thread" }
      : { kind: "none", why: "a human suppressed follow-ups on this thread" };
  }

  const period = waitingPeriod(messages);
  if (!period) {
    return state.labelled
      ? { kind: "clear", why: "nobody is waiting: the last word asked for nothing" }
      : { kind: "none", why: "nobody is waiting" };
  }

  if (!isOverdue(period, now)) {
    return state.labelled
      ? { kind: "clear", why: `the wait restarted at ${period.since_iso} and is not yet overdue` }
      : { kind: "none", why: `due ${period.due_iso}` };
  }

  if (state.labelled) return { kind: "none", why: `already labelled; overdue since ${period.due_iso}` };

  /**
   * Checked AFTER the already-labelled case, on purpose. A thread that ages past the
   * horizon while wearing the label keeps it: somebody has been told it needs them,
   * and time passing is not a reason to retract that. The horizon only decides
   * whether a NEW follow-up is worth raising.
   */
  if (isDormant(period, now)) {
    return { kind: "none", why: `dormant: waiting since ${period.since_iso}, past ${DORMANT_AFTER_DAYS} days` };
  }

  return { kind: "apply", period };
}
