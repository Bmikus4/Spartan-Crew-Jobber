/**
 * The automation's switches. There is one engine since 27 Oct (addendum Prompt 12): the old one and
 * SPARTAN_ENGINE, which chose between them, are gone.
 *
 * SPARTAN_PAUSED=1 stops the automation where it acts (automationPausedFlag): retries, the
 * undecided sweep, test-data clears, labels. It never shuts intake or its dedupe claim
 * (addendum F31): shut at the door, the 10-21 pause left 40 client emails unstored, beyond
 * intake's 72 h catch-up. Intake stores what arrives while paused and marks it store-only
 * (n8nInbound.ts), so nothing decides it, then or after (the owner's store-only ruling,
 * decisions/2026-10-25-pause-window-store-only.md). [DECISIONS O3]
 */

/**
 * Routes that answer 503 whatever the switches say. /api/mail-poll is the Gmail-API intake: it
 * stores mail but decides none until R14 maps Gmail's thread ids to the stored ones (addendum F43),
 * and two intakes running at once would give every conversation a second thread.
 */
export const SHUT_ROUTES = ["/api/mail-poll"];

/**
 * SPARTAN_WRITES=live: the bot carries out the engine's decisions in OnSinch, for any client.
 * Unset, it decides and records only (shadow) and the bot writes on TEST 515 alone. The Settings
 * switch bot_writes_enabled must be on as well (process.ts botWrites).
 */
export function v2Writes(flag: string | undefined = process.env.SPARTAN_WRITES): boolean {
  return (flag || "").trim().toLowerCase() === "live";
}

/**
 * SPARTAN_PAUSED=1, read where the automation acts: /api/bot/* is skipped by the middleware to
 * reach each route's own machine gate, so until 10-23 the minute sync kept retrying writes,
 * clearing test data and handing labels out while paused (addendum F3). retryStopped,
 * maybeSweep, sweepUndecided, retryUnread, the labels route and intake check it.
 */
export function automationPausedFlag(flag: string | undefined = process.env.SPARTAN_PAUSED): boolean {
  return (flag || "").trim() === "1";
}

/** Whether the middleware answers 503 for this path before any auth or engine code runs. */
export function automationPaused(pathname: string): boolean {
  return SHUT_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
