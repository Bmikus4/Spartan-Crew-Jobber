// ============================================================================
// The grounding parsers on the shapes clients were measured writing (sample of 25 client
// emails, 08-25..10-06). Wording is paraphrased; the date and time shapes are verbatim.
//
// Offline.  npx tsx test/v2Ground.ts
// ============================================================================
import { latestText, quoteIn, parseTime, parseDuration, parseCount, parseDate, addMinutes, poAfterLabel, oneIn, timesIn, countsIn, datesIn } from "../app/lib/v2/interpret/ground";
import { ground } from "../app/lib/v2/interpret/interpret";

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
eq(addMinutes("00:30", -60), "23:30", "an hour earlier than 00:30 wraps back to 23:30");
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
// A time after the date is not its year (O Films, 10-15: "2 Nov 0900" read as the year 900).
eq(parseDate("2 Nov 0900", "2026-10-15T10:00:00Z"), "2026-11-02", "2 Nov 0900: 0900 is the start time");
eq(parseDate("2 Nov 09:00", "2026-10-15T10:00:00Z"), "2026-11-02", "2 Nov 09:00: 09 is not 2009");
eq(parseDate("3rd November 1400", "2026-10-15T10:00:00Z"), "2026-11-03", "3rd November 1400");
eq(parseDate("November 2 0900", "2026-10-15T10:00:00Z"), "2026-11-02", "November 2 0900");
eq(parseDate("2 Nov 2027", "2026-10-15T10:00:00Z"), "2027-11-02", "a written year still counts");
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
ok(poAfterLabel("Confirmed, PO number is EAV6274.", "EAV6274"), "PO number is EAV6274 (Essential AV, set by ops 10-09)");
ok(poAfterLabel("UKPO26-13426\n\nWill be the PO number, just waiting on a PDF", "UKPO26-13426"), "a label after the reference (Creative Technology)");
ok(poAfterLabel("Please find attached PO-UK000018983 in relation to your Quote R11351", "PO-UK000018983"), "a reference that carries its own PO prefix (Solotech)");
ok(!poAfterLabel("J46250 - 13/10/26 @ The Carter Building", "J46250"), "EMS's job number is still not a PO (ops wrote 6987)");
ok(!poAfterLabel("Please find attached PO-UK0000189831", "PO-UK000018983"), "a self-labelled reference must be written whole");

console.log("shapes measured in the first shadow day (10-09)");
eq(parseTime("@ 18:30"), "18:30", "@ 18:30 (Harbour Scenic)");
eq(parseTime("0800 AM"), "08:00", "0800 AM (Wall to Wall)");
eq(parseTime("starting midday"), "12:00", "starting midday");
eq(parseTime("from 9am"), "09:00", "from 9am");
eq(parseCount("Crew Size: 2"), 2, "Crew Size: 2");
eq(parseCount("6x2hr"), 6, "6x2hr is six crew (Event Concept)");
eq(parseCount("4x2hr at 07:00"), 4, "4x2hr at 07:00");
eq(parseDuration("6x2hr"), 120, "and two hours");
const fri = "2026-10-09T11:42:00Z";
eq(parseDate("Monday", fri), "2026-10-12", "Monday, sent on a Friday (Concept Furniture)");
eq(parseDate("the Tuesday shift", fri), "2026-10-13", "the Tuesday shift (Carrier)");
eq(parseDate("Sunday", fri), "2026-10-11", "Sunday");
eq(parseDate("Friday", fri), null, "the sent day's own weekday: today or a week today");
eq(parseDate("next Friday", fri), "2026-10-16", "next Friday is that day in the following week (Bearded Kitten, sent Fri 9 Oct, ops booked the 16th)");
eq(parseDate("next Friday", "2026-10-12T09:00:00Z"), "2026-10-16", "next Friday on a Monday is that week's (Bearded Kitten wrote it again on Mon 12 Oct for the 16th)");
eq(parseDate("Monsoon at Christie's", fri), null, "Monsoon is not a Monday");
eq(parseDate("dismantle of Monsoon, Tue 13th October", fri), "2026-10-13", "nor does it contradict a written date");

console.log("shapes the harness found (10-11)");
eq(parseCount("increase to 5 crew"), 5, "increase to 5 crew is a total of 5");
eq(parseCount("make it 6 crew"), 6, "make it 6 crew");
eq(parseCount("take it up to 4"), 4, "take it up to 4");
eq(parseCount("increase by 2"), null, "increase BY 2 is not a total");
eq(parseDate("Monday the 16th", "2026-10-23T13:01:00Z"), "2026-11-16", "Monday the 16th sent Friday 23 October: the 16th that is a Monday");
eq(parseDate("Friday the 16th", "2026-10-23T13:01:00Z"), "2026-10-16", "Friday the 16th: the week-old 16th, which is a Friday");
eq(parseDate("Sunday the 16th", "2026-10-23T13:01:00Z"), null, "no 16th in reach is a Sunday: no date");
ok(poAfterLabel("The PO for R40012 is 37463.", "37463"), "The PO for R40012 is 37463");
ok(!poAfterLabel("The PO for R40012 is 374631.", "37463"), "and only the whole reference");

console.log("what the checker could not read on Sol's readings (10-15)");
{
  const sent = "2026-10-15T09:00:00Z";
  eq(parseDate("yesterday", sent), "2026-10-14", "yesterday is the day before the email was sent");
  ok(oneIn("a local crew person"), "a local crew person is one person (Solotech)");
  ok(!oneIn("a two person team"), "a two person team is not one person");
  const email = "Morning, can the crew have Arrival: 12:00* instead of 13:00* on Friday please";
  const x = { intent: "change" as const, po: null, note: "", requests: [{ action: "change_times" as const, date: { value: "2026-10-16", quote: "Friday" }, start: { value: "12:00", quote: "Arrival: 12:00* instead of 13:00*" }, end: null, duration_minutes: null, crew: null, crew_add: null, venue: null, crew_chief: null, trade: null,
    target: { quote: "Arrival: 12:00* instead of 13:00*", date: null as any, start: { value: "13:00", quote: "Arrival: 12:00* instead of 13:00*" } } }] };
  const g = ground(x as any, email, sent);
  eq(g.requests[0]?.start, "12:00", "the new time is the one before 'instead of'");
  eq(g.requests[0]?.target?.start, "13:00", "the target's time is the one after it");
  eq(g.problems.length + (g.requests[0]?.problems.length ?? 0), 0, "and nothing is refused");
  ok(timesIn("Call time 2 PM").has("14:00"), "Call time 2 PM holds 14:00 (SN ExCeL)");
  ok(countsIn("Could we up this call to 4 too please Tracy?").has(4), "up this call to 4 is a total of 4 (RG Jones)");
  const nov = "Could we please book in the below new requests with you for November?\n04.11.25 Somerset House\n8x 2hr 10:00";
  const y = ground({ intent: "booking", po: null, note: "", requests: [{ action: "new_shift", date: { value: "2025-11-04", quote: "04.11.25" }, start: { value: "10:00", quote: "8x 2hr 10:00" }, end: null, duration_minutes: { value: 120, quote: "8x 2hr 10:00" }, crew: { value: 8, quote: "8x 2hr 10:00" }, crew_add: null, venue: { value: "Somerset House", quote: "Somerset House" }, crew_chief: null, trade: null, target: null }] } as any, nov, "2026-10-14T16:35:37Z");
  eq(y.requests[0]?.date, "2026-11-04", "04.11.25 written in October 2026 is the coming 4 November (Event Concept; ops booked 2026)");
}

console.log("a decrease must say it is one (crew_remove, 10-11)");
{
  const sent = "2026-10-12T09:00:00Z";
  const email = "Hi, for Friday please can you stand down 2 crew, we only need 3 crew now.";
  const req = (crew_remove: { value: number; quote: string }) => ({ intent: "change" as const, po: null, note: "", requests: [{ action: "change_crew" as const, date: { value: "2026-10-16", quote: "Friday" }, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove, venue: null, crew_chief: null, trade: null, target: null }] });
  eq(ground(req({ value: 2, quote: "stand down 2 crew" }), email, sent).requests[0]?.crew_remove, 2, "stand down 2 crew is a decrease of 2");
  eq(ground(req({ value: 3, quote: "3 crew" }), email, sent).requests[0]?.crew_remove, undefined, "a bare 3 crew is a total, never a decrease");
}

console.log("shapes HEAD still refused on 10-25 (eval/iterations.md, iteration 1)");
{
  const sent = "2026-11-10T09:00:00Z";
  eq(parseDate("28-Nov", sent), "2026-11-28", "28-Nov: a hyphen before the month name (booking tables, 7 grounding refusals)");
  eq(parseDate("2-day", sent), null, "2-day is not a date: the word after the hyphen must be a month");
  eq(parseDuration("Duration: 4"), 240, "Duration: 4 is four hours, as Call hours: 4 already was");
  ok(countsIn("can you reduce this crew to 5").has(5), "reduce this crew to 5 holds a total of 5");
  // red-team-B2 B2-7: the same verbs move times and places; neither is a headcount.
  ok(!countsIn("Can you change the start time to 8:00 please").has(8), "change the start time to 8:00 is not 8 crew");
  ok(!countsIn("change venue to 12 High Street").has(12), "change venue to 12 High Street is not 12 crew");
  ok(!countsIn("could we change the call to 9am").has(9), "change the call to 9am is not 9 crew");
  const oct = "2026-10-20T09:00:00Z";
  const both = datesIn("24th & 25th October", oct);
  ok(both.has("2026-10-24") && both.has("2026-10-25"), "24th & 25th October holds both days", [...both].join(","));
  const range = datesIn("29-31 October 2026", oct);
  ok(["2026-10-29", "2026-10-30", "2026-10-31"].every((d) => range.has(d)), "29-31 October 2026 holds every day of the range", [...range].join(","));
  ok(datesIn("1-30 November", oct).size <= 2, "a range over two weeks is not read as days");
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
