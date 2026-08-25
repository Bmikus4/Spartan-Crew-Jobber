// ============================================================================
// A shift that crosses midnight must be BOOKED across midnight.
//
// prompts.ts:178 tells the model "an end earlier than the start is an overnight
// shift — record it as given, the roll to the next day happens downstream". The
// roll did not exist. compose stamped `beginning` and `end` with the same date, so
// 20:00-02:00 went to OnSinch as a window running backwards and OnSinch refused the
// WHOLE order: 400 {"beginning":["Wrong end time (amount of hours)"]}.
//
// The 500-case corpus (.tmp-data/corpus/results.jsonl) counted 222 `POST
// /slotTeams -> 400`. 148 are a stated overnight shift. The other 74 are a
// zero-length window: a second block starting at 18:00 with no stated finish took
// the old flat 18:00 default, so beginning equalled end. One rule covers both —
// a finish AT or BEFORE the start is tomorrow's finish — and it is the same `<=`
// test shiftHours has always used to price the shift.
//
// Run: npx tsx test/overnightWindow.ts
// ============================================================================
import { composeOrder } from "../app/lib/engine/compose";
import type { ConversationFacts } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const compose = (r: ConversationFacts["requests"][number]) =>
  composeOrder({
    facts: { location_text: "ExCeL London", requests: [r] },
    company_id: 515, user_id: 2257, place_id: 49, pricelist_category_id: 197,
    orderName: "test", jobName: "test",
  });

/** Booked hours, read back off the composed ISO stamps — the number OnSinch sees. */
const hours = (b: string, e: string) => (Date.parse(e) - Date.parse(b)) / 3600000;

console.log("\n[1] the live failure: 20:00-02:00");
{
  const { order, warnings } = compose({ date: "2027-03-01", start_time: "20:00", end_time: "02:00", size: 3 });
  const t = order!.slot_teams[0];
  ok(t.beginning === "2027-03-01T20:00:00+00:00", "starts on the day the client named", t.beginning);
  ok(t.end === "2027-03-02T02:00:00+00:00", "FINISHES ON THE NEXT DAY (was 2027-03-01T02:00)", t.end);
  ok(hours(t.beginning, t.end) === 6, "six hours booked", String(hours(t.beginning, t.end)));
  ok(warnings.some((w) => /overnight/.test(w)), "the roll is said out loud");
}

console.log("\n[2] an ordinary day is untouched");
{
  const { order, warnings } = compose({ date: "2027-03-01", start_time: "08:00", end_time: "16:00", size: 3 });
  const t = order!.slot_teams[0];
  ok(t.beginning === "2027-03-01T08:00:00+00:00" && t.end === "2027-03-01T16:00:00+00:00", "same date both ends");
  ok(!warnings.some((w) => /overnight/.test(w)), "and nothing is said about a roll");
}

console.log("\n[3] the zero-length window — the other 74");
{
  // A second block at 18:00 with no stated finish. The old flat 18:00 default made
  // beginning === end, which is the same 400.
  const { order, warnings } = compose({ date: "2027-03-01", start_time: "18:00", size: 2 });
  const t = order!.slot_teams[0];
  ok(t.beginning !== t.end, "the window is not zero-length", `${t.beginning} -> ${t.end}`);
  ok(hours(t.beginning, t.end) === 10, "ten hours — the length of the 08:00-18:00 default", String(hours(t.beginning, t.end)));
  ok(t.end === "2027-03-02T04:00:00+00:00", "18:00 -> 04:00 next day", t.end);
  ok(warnings.some((w) => /defaulted to 04:00/.test(w)), "and the defaulted finish names the time it chose");
}

console.log("\n[4] the default finish is still 18:00 whenever 18:00 is after the start");
{
  for (const [start, end] of [["08:00", "2027-03-01T18:00:00+00:00"], ["06:00", "2027-03-01T18:00:00+00:00"], ["17:59", "2027-03-01T18:00:00+00:00"]]) {
    const { order } = compose({ date: "2027-03-01", start_time: start, size: 1 });
    ok(order!.slot_teams[0].end === end, `${start} -> 18:00 unchanged`, order!.slot_teams[0].end);
  }
  // No start either: the documented 08:00-18:00 default, exactly as before.
  const { order } = compose({ date: "2027-03-01", size: 1 });
  ok(order!.slot_teams[0].beginning === "2027-03-01T08:00:00+00:00", "no times at all -> 08:00 start");
  ok(order!.slot_teams[0].end === "2027-03-01T18:00:00+00:00", "no times at all -> 18:00 finish");
}

console.log("\n[5] a stated start that equals its stated finish is still a 24h shift");
{
  const { order, warnings } = compose({ date: "2027-03-01", start_time: "09:00", end_time: "09:00", size: 4 });
  const t = order!.slot_teams[0];
  ok(hours(t.beginning, t.end) === 24, "24 hours, booked as asked", String(hours(t.beginning, t.end)));
  ok(warnings.some((w) => /24h shift/.test(w)), "and flagged as something to check");
}

console.log("\n[6] the roll crosses a month, a year and a leap day");
{
  const at = (d: string) => compose({ date: d, start_time: "22:00", end_time: "06:00", size: 1 }).order!.slot_teams[0].end;
  ok(at("2027-03-31") === "2027-04-01T06:00:00+00:00", "month end", at("2027-03-31"));
  ok(at("2027-12-31") === "2028-01-01T06:00:00+00:00", "year end", at("2027-12-31"));
  ok(at("2028-02-28") === "2028-02-29T06:00:00+00:00", "into a leap day", at("2028-02-28"));
  ok(at("2027-02-28") === "2027-03-01T06:00:00+00:00", "past a non-leap February", at("2027-02-28"));
}

console.log("\n[7] an undated block still composes an empty window, not a rolled one");
{
  const { order } = compose({ start_time: "20:00", end_time: "02:00", size: 2 });
  const t = order!.slot_teams[0];
  ok(t.beginning === "" && t.end === "", "TBC stays TBC");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
