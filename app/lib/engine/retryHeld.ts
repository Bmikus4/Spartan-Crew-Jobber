// ============================================================================
// retryHeld — the hourly sweep reads a held email again once the venue list is back.
// ----------------------------------------------------------------------------
// An email held because the venue list could not be read (state.retry_pending) waited for
// a redelivery that never comes. n8n claims each message once (Dedupe Claim, then "First
// seen?", which also drops its 72-hour catch-up sweep), and the sweep reads only threads
// that hold an order. So a held first enquiry stayed held until the client wrote again
// (workflow CPIRu7CpezvKjU8d, read 2026-10-01).
//
// The venue list is read ONCE before anything is re-run, and nothing is re-run while it
// still fails: an outage costs one OnSinch read an hour and no model calls. MAX_PER_RUN
// keeps the re-runs (one model call each) inside the sweep route's 60-second ceiling.
// ============================================================================
import type { ConversationState } from "./types";

export const MAX_RETRIES_PER_RUN = 2;

export interface RetryIO {
  /** One read of the venue list; false when it still cannot be read. */
  venueListReadable: () => Promise<boolean>;
  /** Rebuild the thread from stored messages and run it; null when it cannot be rebuilt. */
  run: (threadId: string) => Promise<ConversationState | null>;
  /** False once the route is too close to its ceiling to start another re-run. */
  hasTime?: () => boolean;
}

export interface RetryOutcome { thread_id: string; result: string }

export async function retryHeld(held: ConversationState[], io: RetryIO): Promise<RetryOutcome[]> {
  const due = held.filter((s) => s.retry_pending).slice(0, MAX_RETRIES_PER_RUN);
  if (!due.length) return [];
  if (!(await io.venueListReadable())) {
    return due.map((s) => ({ thread_id: s.thread_id, result: "still held: the venue list cannot be read" }));
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
