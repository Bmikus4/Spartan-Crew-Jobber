// Re-finding an order staff rebuilt (Ben, 20 Nov: keep everything about the original and cross-reference it with the
// thread's latest state, as the standard step, not a new arm). pickRebuild is the sweep's choice (links.ts sweepLinks).
//
// Offline.  npx tsx test/linksRebuild.ts
import { pickRebuild, daysOf } from "../app/lib/v2/links";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const ORIGINAL_MADE = Date.parse("2026-11-09T10:00:00Z");
const sh = (day: string, from = "09:00", to = "13:00") => `${day} ${from}:00|${day} ${to}:00`;
const was = { shifts: [sh("2026-11-24"), sh("2026-11-25")], days: ["2026-11-24", "2026-11-25"], since: ORIGINAL_MADE };
const order = (id: number, created: string, shifts: string[]) => ({ id, created, shifts });

console.log("\n[1] the days a link's shifts fall on");
ok(daysOf(was.shifts).join() === "2026-11-24,2026-11-25", "London days from the shifts", daysOf(was.shifts));

console.log("\n[2] the pick");
{
  const same = pickRebuild([order(1, "2026-11-10T09:00:00Z", was.shifts), order(2, "2026-11-01T09:00:00Z", was.shifts)], was, []);
  ok(same.id === 1 && /every shift/.test(same.how), "one newer order holding every shift: that one (the rule before 20 Nov)", same);
  const moved = pickRebuild([order(3, "2026-11-12T09:00:00Z", [sh("2026-11-24", "10:00", "14:00"), sh("2026-11-26")])], was, ["2026-11-24", "2026-11-26"]);
  ok(moved.id === 3 && /thread now asks/.test(moved.how), "times changed and a day moved, as the thread now asks: found by the thread's days", moved);
  const byOriginalDays = pickRebuild([order(4, "2026-11-12T09:00:00Z", [sh("2026-11-24", "08:00", "12:00"), sh("2026-11-25", "08:00", "12:00")])], was, []);
  ok(byOriginalDays.id === 4 && /original held/.test(byOriginalDays.how), "no dated request on the thread: the original's days decide", byOriginalDays);
  const older = pickRebuild([order(5, "2026-11-01T09:00:00Z", [sh("2026-11-24"), sh("2026-11-25")])], was, []);
  ok(older.id === null, "an order made before the original is never its rebuild", older);
  const two = pickRebuild([order(6, "2026-11-12T09:00:00Z", [sh("2026-11-24", "10:00", "14:00"), sh("2026-11-25", "10:00", "14:00")]), order(7, "2026-11-13T09:00:00Z", [sh("2026-11-24", "11:00", "15:00"), sh("2026-11-25", "11:00", "15:00")])], was, []);
  ok(two.id === null && two.fits === 2, "two orders could be it: no pick, and the count is kept for the note", two);
  ok(pickRebuild([], was, []).id === null, "nothing found: held, as before");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
