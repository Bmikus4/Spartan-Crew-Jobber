// ============================================================================
// The grounding parsers on the shapes clients were measured writing (sample of 25 client
// emails, 08-25..10-06). Wording is paraphrased; the date and time shapes are verbatim.
//
// Offline.  npx tsx test/v2Ground.ts
// ============================================================================
import { latestText, quoteIn, parseTime, parseDuration, parseCount, parseDate, addMinutes, poAfterLabel } from "../app/lib/v2/interpret/ground";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};
const eq = (got: unknown, want: unknown, label: string) => ok(got === want, label, `${JSON.stringify(got)}`);

console.log("times");
eq(parseTime("9.30am"), "09:30", "9.30am");
eq(parseTime("15:30pm"), "15:30", "15:30pm (24h with a stray pm)");
eq(parseTime("17:00pm"), "17:00", "17:00pm");
eq(parseTime("8AM"), "08:00", "8AM");
eq(parseTime("midday"), "12:00", "midday");
eq(parseTime("1800"), "18:00", "1800");
eq(parseTime("18:30hrs"), "18:30", "18:30hrs");
eq(parseTime("7pm"), "19:00", "7pm");
eq(parseTime("12am"), "00:00", "12am");
eq(parseTime("TBC"), null, "TBC is not a time");
eq(parseTime("evening"), null, "evening is not a time");
eq(parseTime("25:00"), null, "25:00 refused");

console.log("durations and counts");
eq(parseDuration("3hr call"), 180, "3hr call");
eq(parseDuration("6hrs"), 360, "6hrs");
eq(parseDuration("2-hour"), 120, "2-hour");
eq(addMinutes("22:00", 240), "02:00", "22:00 + 4h wraps");
eq(parseCount("3 x Crew"), 3, "3 x Crew");
eq(parseCount("x3 Carpenter Crew"), 3, "x3 Carpenter Crew");
eq(parseCount("X2 Crew"), 2, "X2");
eq(parseCount("4 x 2hr crew"), 4, "4 x 2hr crew (count, not hours)");
eq(parseCount("6 crew"), 6, "6 crew");
eq(parseCount("four crew"), 4, "four crew");
eq(parseCount("a couple"), null, "a couple is not a number (Ben: 'bump it up a couple' does nothing)");
eq(parseCount("some more"), null, "some more is not a number");

console.log("dates, against the sent date");
eq(parseDate("17th September", "2026-09-16T10:00:00Z"), "2026-09-17", "17th September, sent the day before");
eq(parseDate("13th Oct", "2026-09-23T10:00:00Z"), "2026-10-13", "13th Oct");
eq(parseDate("Thursday 8th October 26", "2026-10-07T12:00:00Z"), "2026-10-08", "Thursday 8th October 26");
eq(parseDate("Wednesday 8th October 26", "2026-10-07T12:00:00Z"), null, "a weekday that contradicts the date: refused");
eq(parseDate("14/10", "2026-10-07T13:00:00Z"), "2026-10-14", "14/10");
eq(parseDate("10/10/2026", "2026-10-01T09:00:00Z"), "2026-10-10", "10/10/2026");
eq(parseDate("the 30th", "2026-09-25T09:00:00Z"), "2026-09-30", "the 30th, same month");
eq(parseDate("the 2nd", "2026-09-25T09:00:00Z"), "2026-10-02", "the 2nd, rolls to next month");
eq(parseDate("Friday 9th", "2026-10-07T09:00:00Z"), "2026-10-09", "Friday 9th");
eq(parseDate("5th January", "2026-12-20T09:00:00Z"), "2027-01-05", "January written in December: next year");
eq(parseDate("31st September", "2026-09-01T09:00:00Z"), null, "31st September does not exist");
eq(parseDate("next week", "2026-09-01T09:00:00Z"), null, "next week is not a date");
eq(parseDate("the one on November 4th at BAFTA", "2026-09-17T15:39:00Z"), "2026-11-04", "November 4th (month first; read as 4 October before the fix)");
eq(parseDate("October 8 2026", "2026-09-17T15:39:00Z"), "2026-10-08", "October 8 2026");
eq(parseDate("Friday the 9th", "2026-10-07T09:00:00Z"), "2026-10-09", "a weekday word before 'the 9th' is not a month");

console.log("quotes and the newest text");
const mail = "Hi,\n\nCould the crew arrive at 15:30pm on the 30th instead of 17:00pm?\n\nThanks\n\nOn Wed, 24 Sep 2026 at 10:00, Bookings Spartan Crew wrote:\n> Crew booked 17:00 on the 30th, 6 x crew";
const latest = latestText(mail);
ok(!latest.includes("6 x crew") && latest.includes("15:30pm"), "quoted history is dropped", JSON.stringify(latest));
ok(quoteIn(latest, "15:30PM  on the 30th"), "a quote matches across case and spacing");
ok(!quoteIn(latest, "6 x crew"), "a quote from the history does not count as the client's new words");
ok(!quoteIn(latest, ""), "an empty quote grounds nothing");
ok(latestText("Hi\n-----Original Message-----\nFrom: x\nold").trim() === "Hi", "a forwarded original is dropped");

console.log("relative days (Fairholme 10-09: \"2 crew for tomorrow at 4:30pm\")");
eq(parseDate("tomorrow", "2026-10-09T09:22:39Z"), "2026-10-10", "tomorrow, from the day it was sent");
eq(parseDate("today", "2026-10-09T09:22:39Z"), "2026-10-09", "today");
eq(parseDate("tomorrow", "2026-10-09T23:30:00Z"), "2026-10-11", "sent 00:30 London on the 10th: tomorrow is the 11th");
eq(parseDate("tomorrow at 4:30pm", "2026-10-09T09:22:39Z"), "2026-10-10", "a time beside it is not a second date");
eq(parseDate("tomorrow (Saturday)", "2026-10-09T09:22:39Z"), "2026-10-10", "a weekday that agrees");
eq(parseDate("tomorrow (Sunday)", "2026-10-09T09:22:39Z"), null, "a weekday that disagrees: no date");
eq(parseDate("tomorrow 11th", "2026-10-09T09:22:39Z"), null, "a day number that disagrees: no date");
eq(parseDate("30th", "2026-08-31T23:30:00Z"), "2026-09-30", "a bare day counts from the London day it was sent (1 Sep, not 31 Aug)");

console.log("booking-form fields (EMS 10-09)");
eq(parseCount("No. of crew:  3"), 3, "No. of crew: 3");
eq(parseCount("Crew required - 4"), 4, "Crew required - 4");
eq(parseCount("crew"), null, "a label with no number is no count");
eq(parseCount("No. of crew: TBC"), null, "No. of crew: TBC");
eq(parseDuration("Call hours:  4"), 240, "Call hours: 4");
eq(parseDuration("Hours: 5.5"), 330, "Hours: 5.5");

console.log("PO references (10-09)");
ok(poAfterLabel("PO 48963", "48963"), "PO 48963");
ok(poAfterLabel("Job code - FH0730", "FH0730"), "Job code - FH0730");
ok(poAfterLabel("13/10 British museum ref:2871", "2871"), "ref:2871");
ok(poAfterLabel("PO number: PO-2026-114", "PO-2026-114"), "a reference that starts with PO");
ok(!poAfterLabel("please find attached PO for Legal Geek - Truman Brewery 12/10/26", "Legal Geek - Truman Brewery 12/10/26"), "an event name after 'PO for' is not a PO");
ok(!poAfterLabel("Re: Price quote - R11221 We Are Family", "R11221"), "Spartan's own order number with no PO label is not a PO");
ok(!poAfterLabel("PO 489631", "48963"), "a prefix of the written reference is not it");

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
