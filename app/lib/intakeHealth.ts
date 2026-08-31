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

/**
 * England & Wales bank holidays, as London dates.
 *
 * THIS EXISTS BECAUSE THE WATCHDOG WAS ABOUT TO BE WRONG ON ITS FIRST HOLIDAY. It was
 * installed on Sunday 30 August 2026 and the next morning was the summer bank holiday:
 * no mail was coming, the engine was healthy, and at 08:00 it would have emailed that the
 * intake had gone quiet. An alarm that is wrong on a public holiday is an alarm somebody
 * mutes, and a muted alarm is worse than no alarm at all.
 *
 * England & Wales, not the union of all four nations. Scotland's 2 January and 30 November
 * and Northern Ireland's 17 March and 12 July are ordinary working days for a mailbox
 * answered from London, and suppressing them would blind the watchdog on four real days a
 * year. The union is one edit away if the business ever answers mail from elsewhere.
 *
 * The moveable dates were computed rather than remembered — Good Friday and Easter Monday
 * from the Gregorian computus, Early May as the first Monday, Spring and Summer as the
 * last Mondays of May and August. test/intakeHealth.ts re-checks the whole table against
 * the calendar, because a hand-typed list of dates is exactly the thing that is wrong in
 * one place and read as right forever.
 */
export const BANK_HOLIDAYS: string[] = [
  // 2026
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31",
  "2026-12-25", "2026-12-28", // Boxing Day falls on a Saturday; substitute Monday
  // 2027
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30",
  "2027-12-27", "2027-12-28", // Christmas Saturday, Boxing Day Sunday; both substituted
  // 2028
  "2028-01-03", // New Year's Day falls on a Saturday; substitute Monday
  "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-29", "2028-08-28",
  "2028-12-25", "2028-12-26",
  // 2029
  "2029-01-01", "2029-03-30", "2029-04-02", "2029-05-07", "2029-05-28", "2029-08-27",
  "2029-12-25", "2029-12-26",
  // 2030
  "2030-01-01", "2030-04-19", "2030-04-22", "2030-05-06", "2030-05-27", "2030-08-26",
  "2030-12-25", "2030-12-26",
];

const HOLIDAYS = new Set(BANK_HOLIDAYS);

/** The last year the table covers. Past it, nothing is suppressed — see intakeHealth. */
const TABLE_LAST_YEAR = 2030;

/** The London calendar date for an instant, as YYYY-MM-DD. */
function londonDate(ms: number): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return f.format(new Date(ms));
}

export function isBankHoliday(ms: number): boolean {
  return HOLIDAYS.has(londonDate(ms));
}

/** Whether this instant is past the end of the hand-maintained table. */
export function holidayTableStale(ms: number): boolean {
  return Number(londonDate(ms).slice(0, 4)) > TABLE_LAST_YEAR;
}

export function withinWorkingHours(ms: number): boolean {
  const { weekday, hour } = londonParts(ms);
  if (weekday === "Sat" || weekday === "Sun") return false;
  if (isBankHoliday(ms)) return false;
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

export interface IntakeHealth {
  ok: boolean;
  stale: boolean;
  within_working_hours: boolean;
  /** Quiet because England & Wales are on holiday, rather than because anything broke. */
  bank_holiday: boolean;
  /** The holiday table has run out. Nothing is suppressed; somebody should top it up. */
  holiday_table_stale: boolean;
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
    bank_holiday: isBankHoliday(now),
    holiday_table_stale: holidayTableStale(now),
    minutes_since: minutes,
    last_received_at: lastReceivedAt == null ? null : new Date(lastReceivedAt).toISOString(),
    quiet_minutes: quietMinutes,
    what,
  };
}
