// ============================================================================
// retryHeld — the hourly sweep reads a held email again once the venue list is back.
// ----------------------------------------------------------------------------
// An email held because the venue list could not be read (state.retry_pending) waited for
// a redelivery that never comes. n8n claims each message once (Dedupe Claim, then "First
// seen?", which also drops its 72-hour catch-up sweep), and the sweep reads only threads
// that hold an order. So a held first enquiry stayed held until the client wrote again
// (workflow CPIRu7CpezvKjU8d, read 2026-10-01).
//
// The venue and company lists are read ONCE before anything is re-run, and nothing is re-run
// while either still fails: an outage costs two OnSinch reads an hour and no model calls.
// MAX_PER_RUN keeps the re-runs inside the sweep route's ceiling. A thread held by the venue
// judge (SP-06) re-runs until it has MAX_ATTEMPTS held passes, so a judge that stays down costs
// a bounded number of model calls; after that it stays held and labelled for a person.
// ============================================================================
import type { ConversationState } from "./types";
import type { StateStore } from "./store";

export const MAX_RETRIES_PER_RUN = 2;
export const MAX_ATTEMPTS = 3;

export interface RetryIO {
  /** One read of the venue and company lists; false while either still cannot be read. */
  listsReadable: () => Promise<boolean>;
  /** Rebuild the thread from stored messages and run it; null when it cannot be rebuilt. */
  run: (threadId: string) => Promise<ConversationState | null>;
  /** False once the route is too close to its ceiling to start another re-run. */
  hasTime?: () => boolean;
}

export interface RetryOutcome { thread_id: string; result: string }

export async function retryHeld(held: ConversationState[], io: RetryIO): Promise<RetryOutcome[]> {
  const due = held.filter((s) => s.retry_pending && (s.retry_attempts ?? 0) < MAX_ATTEMPTS).slice(0, MAX_RETRIES_PER_RUN);
  if (!due.length) return [];
  if (!(await io.listsReadable())) {
    return due.map((s) => ({ thread_id: s.thread_id, result: "still held: the venue or company list cannot be read" }));
  }
  const outcomes: RetryOutcome[] = [];
  for (const s of due) {
    if (io.hasTime && !io.hasTime()) { outcomes.push({ thread_id: s.thread_id, result: "deferred: no time left this run" }); continue; }
    try {
      const after = await io.run(s.thread_id);
      outcomes.push({
        thread_id: s.thread_id,
        result: after ? `${after.classification}/${after.status}${after.retry_pending ? " (still held)" : ""}` : "not rebuildable from stored messages",
      });
    } catch (err) {
      // One thread that throws does not stop the others; it stays held for the next run.
      outcomes.push({ thread_id: s.thread_id, result: `failed: ${String((err as Error)?.message ?? err)}` });
    }
  }
  return outcomes;
}

/**
 * An email the engine threw on is held for the sweep like a list outage (SP-15). n8n sends
 * each message once, so before this a throw lost the email until the client wrote again. It
 * counts as a held pass, so a thread that keeps throwing stops at MAX_ATTEMPTS and stays
 * held and labelled for a person. A thread with no state yet gets a minimal one, enough for
 * the label and the re-run; its messages are already in thread_messages from the capture.
 */
export async function markThrew(
  store: StateStore,
  thread: { thread_id: string; subject?: string },
  err: unknown,
): Promise<ConversationState> {
  const prior = await store.get(thread.thread_id);
  const why = String((err as Error)?.message ?? err).slice(0, 300);
  const base = prior ?? ({
    thread_id: thread.thread_id, subject: thread.subject, classification: "new-job", status: "error",
    notes: [], facts: { requests: [] },
  } as unknown as ConversationState);
  const next: ConversationState = {
    ...base,
    retry_pending: "engine-threw",
    retry_attempts: prior?.retry_pending ? (prior.retry_attempts ?? 1) + 1 : 1,
    needs_human: true,
    notes: [...(base.notes ?? []), `the engine threw on this thread (${why}) — held and tagged; the hourly sweep reads it again`],
  };
  await store.put(next);
  return next;
}
