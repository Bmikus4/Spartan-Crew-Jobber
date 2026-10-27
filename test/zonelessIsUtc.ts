// ============================================================================
// An OnSinch time with no zone is UTC, whatever the machine's own zone is.
// ----------------------------------------------------------------------------
// OnSinch's audit rows write a slot's old and new times as "2026-10-23 07:30:00", with no zone;
// its API writes the same slot as "2026-10-23T07:30:00+00:00". On the 10-22 copy, 1,810 of the 1,813
// slots whose last audited time fell in British Summer Time hold, in the API, exactly the audited
// time read as UTC, and none hold it read as London time (eval/patches/items-1-4.md). `new Date()`
// reads a zone-less string in the process's zone: on the New York box every staff re-time read
// 4 hours late, so every correct time change was judged wrong (eval/diagnostic-11-3.md: 1 completed
// write instead of 7). Production runs in UTC and never saw it, so only other zones can prove the fix.
// Node re-reads process.env.TZ on assignment, so one process tries several zones.
// npx tsx test/zonelessIsUtc.ts
// ============================================================================
process.env.TZ = "America/New_York";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

(async () => {
  const { utcToLondon } = await import("../app/lib/v2/bot/ops");
  const { truthKeys } = await import("../app/lib/v2/score");
  const at = (s: string) => { const r = utcToLondon(s); return `${r.date} ${r.time}`; };

  // Zone-less audit times against the London wall clock staff see, across both 2026 clock changes
  // (29 Mar and 25 Oct, at 01:00 UTC) and across midnight.
  const cases: Array<[string, string, string]> = [
    ["2026-10-23 07:30:00", "2026-10-23 08:30", "BST: 07:30 UTC is 08:30 in London"],
    ["2026-11-03T07:30:00", "2026-11-03 07:30", "GMT, the T form"],
    ["2026-10-23 07:30:00.250", "2026-10-23 08:30", "with fractional seconds"],
    ["2026-03-29 00:59:00", "2026-03-29 00:59", "spring: the last minute of GMT"],
    ["2026-03-29 01:00:00", "2026-03-29 02:00", "spring: 01:00 UTC is 02:00 BST (London skips 01:00-01:59)"],
    ["2026-10-25 00:59:00", "2026-10-25 01:59", "autumn: the last minute of BST"],
    ["2026-10-25 01:00:00", "2026-10-25 01:00", "autumn: 01:00 UTC is 01:00 GMT"],
    ["2026-10-25 00:30:00", "2026-10-25 01:30", "autumn: London's 01:30 happens twice; the first is 00:30 UTC"],
    ["2026-10-25 01:30:00", "2026-10-25 01:30", "autumn: and the second is 01:30 UTC"],
    ["2026-08-25 23:30:00", "2026-08-26 00:30", "slot 52076's audited end: BST, after midnight in London (the API holds 2026-08-25T23:30:00+00:00)"],
    ["2026-06-30 23:00:00", "2026-07-01 00:00", "BST: the month turns in London first"],
    ["2026-12-31 23:30:00", "2026-12-31 23:30", "GMT: the year does not turn early"],
  ];
  for (const zone of ["America/New_York", "UTC", "Europe/London", "Asia/Kolkata", "Pacific/Auckland"]) {
    process.env.TZ = zone;
    console.log(`\nprocess zone ${zone}`);
    if (zone !== "UTC" && zone !== "Europe/London") ok(new Date("2026-10-23 07:30:00").getTimezoneOffset() !== 0, "the process is not on UTC, so a zone-less read in it would be wrong");
    for (const [input, want, why] of cases) ok(at(input) === want, why, { input, got: at(input) });
    // A time that carries its zone is read as written, as the API's always do.
    ok(at("2026-10-23T07:30:00+00:00") === "2026-10-23 08:30", "+00:00, the API's form");
    ok(at("2026-10-23T07:30:00Z") === "2026-10-23 08:30", "Z");
    ok(at("2026-10-23T08:30:00+01:00") === "2026-10-23 08:30", "+01:00");
    ok(at("2026-10-25T00:30:00+00:00") === at("2026-10-25 00:30:00"), "the zoned and zone-less forms of one instant agree");
  }
  process.env.TZ = "America/New_York";

  console.log("\nthe scorer judges a staff re-time at the hour it was booked");
  const act = { at: "2026-10-20T10:00:00+00:00", by: 7, what: "edit", order_id: 1, number: "11000", company_id: 9, model: "Slot", model_id: 5,
    changes: { beginning: { old: "2026-10-23 06:30:00", new: "2026-10-23 07:30:00" }, end: { old: "2026-10-23 14:30:00", new: "2026-10-23 15:30:00" } } };
  const keys = truthKeys([act], () => ({ Job: [] })).keys;
  ok(keys.includes("times 1/5=2026-10-23 08:30-16:30"), "08:30-16:30 London", keys);
  const night = { ...act, changes: { beginning: { old: "2026-10-24 22:00:00", new: "2026-10-24 23:00:00" }, end: { old: "2026-10-25 04:00:00", new: "2026-10-25 05:00:00" } } };
  const k2 = truthKeys([night], () => ({ Job: [] })).keys;
  ok(k2.includes("times 1/5=2026-10-25 00:00-05:00"), "a night shift over the autumn change: starts 00:00 BST on the 25th, ends 05:00 GMT", k2);

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})();
