// ============================================================================
// A year the client wrote down is never overruled, even when the same date is
// also mentioned without one.
// ----------------------------------------------------------------------------
// Live on order 15611, 2026-08-29. The enquiry said:
//     Event Date(s): Tuesday, October 12, 2027 - Thursday, October 14, 2027
//     Start Time: 07:00 AM on October 12th
//     End Time:   06:00 PM on October 14th
// `bareMonthDays` keyed on MM-DD and kept every month-day that appeared without
// a year, without subtracting the ones that ALSO appeared with one. So 10-12 and
// 10-14 counted as bare, the next-occurrence rule fired, and both were dragged
// back to 2026 - six weeks away - while 10-13, never written bare, kept 2027.
//
// The damage direction is the dangerous one: it moves bookings EARLIER, so crew
// are called a year before the job and the board looks entirely normal.
//
// Run: npx tsx test/yearRollStated.ts
// ============================================================================
import { bareMonthDays, reconcileRequests } from "../app/lib/engine/parseWork";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const REFERENCE = new Date("2026-08-29T00:00:00Z");
const TEXT = [
  "Event Date(s): Tuesday, October 12, 2027 - Thursday, October 14, 2027",
  "Start Time: 07:00 AM on October 12th",
  "End Time: 06:00 PM on October 14th",
].join("\n");

console.log("\n[1] a month-day stated with a year anywhere is not bare");
{
  const bare = bareMonthDays(TEXT, REFERENCE);
  ok(!bare.has("10-12"), "10-12 is not bare - the client dated it 2027", JSON.stringify([...bare]));
  ok(!bare.has("10-14"), "10-14 is not bare - the client dated it 2027", JSON.stringify([...bare]));
}

console.log("\n[2] and the roll therefore leaves the client's year alone");
{
  const requests = [
    { date: "2027-10-12", size: 15 },
    { date: "2027-10-13", size: 15 },
    { date: "2027-10-14", size: 15 },
  ];
  const { requests: out, report } = reconcileRequests(TEXT, requests, REFERENCE);
  ok(out[0].date === "2027-10-12", "day 1 keeps 2027", String(out[0].date));
  ok(out[1].date === "2027-10-13", "day 2 keeps 2027", String(out[1].date));
  ok(out[2].date === "2027-10-14", "day 3 keeps 2027", String(out[2].date));
  ok(report.rolled.length === 0, "nothing was rolled", JSON.stringify(report.rolled));
}

console.log("\n[3] a genuinely bare date still rolls - the rule is not disabled");
{
  const bareText = "Please send 4 crew on 3rd March, 08:00 to 18:00.";
  const bare = bareMonthDays(bareText, REFERENCE);
  ok(bare.has("03-03"), "03-03 is bare when no year is written anywhere", JSON.stringify([...bare]));
  const { requests: out, report } = reconcileRequests(bareText, [{ date: "2026-03-03", size: 4 }], REFERENCE);
  ok(out[0].date === "2027-03-03", "and rolls to the next occurrence", String(out[0].date));
  ok(report.rolled.length === 1, "and says so", JSON.stringify(report.rolled));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
