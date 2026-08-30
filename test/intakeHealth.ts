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
import { intakeHealth, DEFAULT_QUIET_MINUTES } from "../app/lib/intakeHealth";

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

  console.log(`\n${fails ? `${fails} FAILED` : "intakeHealth: ALL PASS"}\n`);
  process.exit(fails ? 1 : 0);
})();
