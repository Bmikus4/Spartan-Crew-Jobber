// ============================================================================
// The order of the TV's list, and the date arithmetic both the server and the screen use.
// ----------------------------------------------------------------------------
// Its own module because the screen imports it: project.ts pulls in the engine, which
// must never reach the browser bundle. Type imports only from project.ts.
// ============================================================================
import type { FeedCard } from "./project";

/** A client waiting this long for our reply is red, and rises to the top (Ben, 2026-10-04). */
export const REPLY_RED_MS = 24 * 3_600_000;

/**
 * THE DIAL for sinking old cards (Ben, 2026-10-05): open work nobody has touched for this
 * long (no email either way, no engine write, no staff edit or tick; 10-06) goes below every
 * fresh card, under its own label. Sunk, never hidden: hiding one could hide a lost booking.
 * Whole days, because the screen's label says it in days.
 */
export const QUIET_MS = 7 * 86_400_000;

/** Today in London as YYYY-MM-DD. en-CA formats as ISO. */
export function londonDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

/** The first job day that has not passed, or null for an undated job. */
export function nextDay(c: FeedCard, now: number): string | null {
  const today = londonDay(now);
  return c.dates.find((d) => d >= today) ?? null;
}

/** When the job next starts: its first block not yet started, else the start of its next day. */
export function deadline(c: FeedCard, now: number): number | null {
  if (c.starts_at != null) return c.starts_at;
  const d = nextDay(c, now);
  return d ? Date.parse(`${d}T00:00:00Z`) : null;
}

/**
 * THE ORDER (Ben, 2026-10-04 and 10-05). Open work above done work. Within open work,
 * every need whose client has gone quiet (`quiet`, project.ts) sits below every fresh one:
 * a booking nobody has mentioned for a week is less likely to be the one to act on now,
 * and on 2026-10-04 four such threads held the top of the screen. Then, within each group,
 * a client who has waited a day or more for our reply comes first; then the nearest job,
 * the longer wait breaking a tie; undated jobs last. Done work newest first, so what just
 * went green sits at the top of the done group.
 */
export function orderCards(cards: FeedCard[], now: number): FeedCard[] {
  const waited = (c: FeedCard) => (c.awaiting_reply_since != null ? now - c.awaiting_reply_since : -1);
  const red = (c: FeedCard) => (waited(c) >= REPLY_RED_MS ? 0 : 1);
  const when = (c: FeedCard) => deadline(c, now) ?? Number.MAX_SAFE_INTEGER;
  const doneAt = (c: FeedCard) => c.items[0].green?.at ?? c.at;
  const open = cards.filter((c) => c.lane !== "done")
    .sort((a, b) => Number(a.quiet) - Number(b.quiet) || red(a) - red(b) || when(a) - when(b) || waited(b) - waited(a) || a.at - b.at);
  const done = cards.filter((c) => c.lane === "done").sort((a, b) => doneAt(b) - doneAt(a));
  return [...open, ...done];
}
