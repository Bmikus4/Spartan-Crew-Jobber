// ============================================================================
// "Has anything reached the engine lately?" — the only check that survives the
// engine being dead.
// ----------------------------------------------------------------------------
// On 2026-08-26 the Gmail credential expired. The intake failed every five
// minutes for 42 hours and nobody knew, because AN ENGINE THAT IS NOT RUNNING
// CANNOT REPORT THAT IT IS NOT RUNNING. The other three error routes all depend
// on the engine reaching a catch block. This one is asked from outside, on a
// schedule, and is the only one that would have caught that outage.
//
// The decision lives HERE and not in the n8n schedule, for the same reason
// decideCaller does: the branch that matters is "quiet, but is that expected?",
// and that is not something to verify by reading a workflow canvas. n8n asks and
// relays; it does not judge.
//
// SILENCE OUT OF HOURS IS NOT A FAULT. Spartan's mailbox is quiet overnight and
// at weekends. An alarm that cries every night is an alarm nobody reads by the
// end of the week — which is the same way the console.error sites became
// worthless.
//
// Run: npx tsx test/intakeHealth.ts
// ============================================================================
import { intakeHealth, DEFAULT_QUIET_MINUTES, BANK_HOLIDAYS } from "../app/lib/intakeHealth";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const at = (iso: string) => new Date(iso).getTime();
const MIN = 60_000;

(async () => {
  // A Wednesday, 11:00 London (BST, so 10:00Z). Squarely inside working hours.
  const wed11 = at("2026-08-26T10:00:00Z");

  console.log("\n[1] during working hours, silence is the alarm");
  {
    const fresh = intakeHealth({ lastReceivedAt: wed11 - 10 * MIN, now: wed11 });
    ok(fresh.within_working_hours, "Wednesday 11:00 London is working hours");
    ok(!fresh.stale, "ten minutes of quiet is normal");
    ok(fresh.minutes_since === 10, "and the age is reported", String(fresh.minutes_since));

    const quiet = intakeHealth({ lastReceivedAt: wed11 - 95 * MIN, now: wed11 });
    ok(quiet.stale, "ninety-five minutes of quiet is not");
    ok(/95 minutes/.test(quiet.what), "and it says how long", quiet.what);
  }

  console.log("\n[2] the boundary is inclusive — at the threshold it is already stale");
  {
    const on = intakeHealth({ lastReceivedAt: wed11 - DEFAULT_QUIET_MINUTES * MIN, now: wed11 });
    const under = intakeHealth({ lastReceivedAt: wed11 - (DEFAULT_QUIET_MINUTES - 1) * MIN, now: wed11 });
    ok(on.stale, `exactly ${DEFAULT_QUIET_MINUTES} minutes is stale`);
    ok(!under.stale, "one minute under is not");
  }

  console.log("\n[3] out of hours, the same silence is expected");
  {
    // Sunday 03:00 London.
    const sun3 = at("2026-08-30T02:00:00Z");
    const h = intakeHealth({ lastReceivedAt: sun3 - 600 * MIN, now: sun3 });
    ok(!h.within_working_hours, "Sunday 03:00 is not working hours");
    ok(!h.stale, "ten hours of weekend quiet raises nothing");
    ok(h.minutes_since === 600, "but the age is still reported honestly", String(h.minutes_since));

    // A Tuesday at 04:00 London — a weekday, but nobody is emailing.
    const tue4 = at("2026-08-25T03:00:00Z");
    ok(!intakeHealth({ lastReceivedAt: tue4 - 600 * MIN, now: tue4 }).within_working_hours,
      "a weekday night is not working hours either");
  }

  console.log("\n[4] the clock is London, not UTC, or half the year is wrong");
  {
    // 07:30Z. In August that is 08:30 London and the day has started; in January
    // it is 07:30 London and it has not. Reading UTC would get one of them wrong
    // for eight months of the year.
    const summer = at("2026-08-26T07:30:00Z");
    const winter = at("2026-01-28T07:30:00Z");
    ok(intakeHealth({ lastReceivedAt: summer, now: summer }).within_working_hours, "07:30Z in August is inside (BST)");
    ok(!intakeHealth({ lastReceivedAt: winter, now: winter }).within_working_hours, "07:30Z in January is outside (GMT)");
  }

  console.log("\n[5] nothing ever received is the loudest case, not an empty answer");
  {
    const h = intakeHealth({ lastReceivedAt: null, now: wed11 });
    ok(h.stale, "no inbound row at all, in working hours, is stale");
    ok(h.minutes_since === null, "with no age to report");
    ok(/never/i.test(h.what), "and it says so plainly", h.what);
  }

  console.log("\n[6] a bank holiday is not a working day");
  {
    // Monday 31 August 2026, the summer bank holiday, 11:00 London. Without this the
    // watchdog emails on the first quiet morning of every bank holiday — it very nearly
    // did on the day this was written. An alarm that is wrong on a public holiday is an
    // alarm somebody mutes, and a muted alarm is worse than no alarm.
    const augBH = at("2026-08-31T10:00:00Z");
    const h = intakeHealth({ lastReceivedAt: augBH - 16 * 60 * MIN, now: augBH });
    ok(!h.within_working_hours, "Monday 31 Aug 2026, 11:00, is the summer bank holiday");
    ok(!h.stale, "sixteen hours of holiday quiet raises nothing");
    ok(h.bank_holiday === true, "and the answer says why it is quiet");

    // The Monday after is an ordinary working day and must go back to judging.
    const nextMon = at("2026-09-07T10:00:00Z");
    const n = intakeHealth({ lastReceivedAt: nextMon - 16 * 60 * MIN, now: nextMon });
    ok(n.within_working_hours, "the following Monday is a working day again");
    ok(n.stale, "and the same silence is a fault on it");
    ok(n.bank_holiday === false, "not flagged as a holiday");
  }

  console.log("[7] the holiday table is internally consistent");
  {
    // Transcribed by hand, so it is checked by machine rather than by reading. Every
    // listed date is asked what day it is in London; the rules below are what a
    // bank-holiday list cannot violate, and a slipped digit almost always breaks one.
    const wd = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" })
        .format(new Date(`${iso}T12:00:00Z`));

    const weekend = BANK_HOLIDAYS.filter((d) => wd(d) === "Sat" || wd(d) === "Sun");
    ok(weekend.length === 0, "no holiday falls on a weekend — substitutes are the point", weekend.join(" "));

    // A holiday is a Monday, a Good Friday, a substitute Tuesday, or one of the three
    // fixed dates that can land mid-week.
    const odd = BANK_HOLIDAYS.filter((d) => {
      const day = wd(d);
      const md = d.slice(5);
      const fixed = md === "12-25" || md === "12-26" || md === "01-01";
      return !(day === "Mon" || day === "Tue" || day === "Fri" || fixed);
    });
    ok(odd.length === 0, "every date is a Monday, Friday, substitute Tuesday or fixed date", odd.join(" "));
    ok(BANK_HOLIDAYS.length >= 40, `the table covers several years (${BANK_HOLIDAYS.length} dates)`);
  }

  console.log("[8] past the end of the table it judges normally, it does not go quiet");
  {
    // The table runs out. The safe direction is to keep alarming on a real silence and
    // say the table is stale — suppressing every day after the last listed year because
    // nobody topped up a list would be a watchdog that quietly switches itself off.
    const far = at("2031-03-12T11:00:00Z"); // a Wednesday, well past the table
    const h = intakeHealth({ lastReceivedAt: far - 16 * 60 * MIN, now: far });
    ok(h.within_working_hours, "a weekday beyond the table is still a working day");
    ok(h.stale, "and silence on it is still a fault");
    ok(h.holiday_table_stale === true, "but the answer says the table needs topping up");
  }

  console.log(`\n${fails ? `${fails} FAILED` : "intakeHealth: ALL PASS"}\n`);
  process.exit(fails ? 1 : 0);
})();
