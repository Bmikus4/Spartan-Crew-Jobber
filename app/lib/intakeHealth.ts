// "Has anything reached the engine lately?"
//
// AN ENGINE THAT IS NOT RUNNING CANNOT REPORT THAT IT IS NOT RUNNING. The other three error
// routes in errorReport.ts all depend on the engine reaching a catch block; when the Gmail
// credential expired on 2026-08-26 nothing threw here at all — the mail simply stopped arriving
// and every dashboard stayed green for 42 hours. So this question is asked from OUTSIDE, by an
// n8n schedule hitting /api/health/intake, and answered from inbound_raw.received_at.
//
// The judgement lives here rather than in the n8n schedule for the same reason decideCaller
// does: the branch that matters is "quiet, but is that expected?", and that is not something to
// verify by reading a workflow canvas. n8n asks and relays; it does not judge.
//
// Pinned by test/intakeHealth.ts.

/** How long a working-hours silence has to run before it means something. Long enough to ride
 *  out a genuinely slow morning, short enough that a dead credential is caught the same day. */
export const DEFAULT_QUIET_MINUTES = 90;

/** Mon–Fri, London. Spartan's mailbox is quiet overnight and at weekends; an alarm that cries
 *  every night is one nobody reads by the end of the week. */
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 18;
const ZONE = "Europe/London";

/**
 * The weekday and hour in London for an instant.
 *
 * London, not UTC: for eight months of the year they differ by an hour, so a UTC reading would
 * put the start of the working day in the wrong place for most of the summer.
 */
function londonParts(ms: number): { weekday: string; hour: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, weekday: "short", hour: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { weekday: String(parts.weekday), hour: parseInt(String(parts.hour), 10) };
}

export function withinWorkingHours(ms: number): boolean {
  const { weekday, hour } = londonParts(ms);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

export interface IntakeHealth {
  ok: boolean;
  stale: boolean;
  within_working_hours: boolean;
  /** Whole minutes since the last inbound, or null if there has never been one. */
  minutes_since: number | null;
  last_received_at: string | null;
  quiet_minutes: number;
  /** The sentence that becomes the error report's `what`. */
  what: string;
}

/**
 * Judge one reading.
 *
 * `ok` is the inverse of `stale` and exists so the n8n schedule needs no logic of its own: it
 * alerts when `ok` is false and does nothing otherwise.
 *
 * The age is reported HONESTLY even out of hours — the caller can see a ten-hour weekend gap
 * and understand why nothing fired, which is the difference between a quiet monitor and one
 * that might be broken.
 */
export function intakeHealth(
  { lastReceivedAt, now, quietMinutes = DEFAULT_QUIET_MINUTES }:
  { lastReceivedAt: number | null; now: number; quietMinutes?: number },
): IntakeHealth {
  const working = withinWorkingHours(now);
  const minutes = lastReceivedAt == null ? null : Math.floor((now - lastReceivedAt) / 60_000);

  // No inbound row at all is the loudest case, not an empty answer: it is what a brand-new
  // deployment looks like AND what a database pointed at the wrong project looks like.
  const quiet = minutes == null || minutes >= quietMinutes;
  const stale = working && quiet;

  const what =
    minutes == null
      ? "mail has NEVER reached the engine — inbound_raw has no rows at all"
      : `no mail has reached the engine for ${minutes} minutes`;

  return {
    ok: !stale,
    stale,
    within_working_hours: working,
    minutes_since: minutes,
    last_received_at: lastReceivedAt == null ? null : new Date(lastReceivedAt).toISOString(),
    quiet_minutes: quietMinutes,
    what,
  };
}
