// ============================================================================
// A date written with no year means the NEXT one.
//
// The 100-case model-in-the-loop study read 19 dates wrong and all 19 were the
// same error: day and month right, year the year of the email. "8th March" in a
// thread dated 2026-08-24 became 2026-03-08 — a work date five months in the past.
// prompts.ts said "infer the year from surrounding context", the surrounding
// context is the email's own date, and the wrong answer satisfied the instruction.
//
// Nothing anywhere said a booking cannot be in the past, so nothing caught it: the
// parser made the identical mistake and reported no disagreement with the model.
//
// The fix is in two places and THIS is the authoritative one. A prompt cannot be
// proven; rollYearForward can, offline, for nothing, on every boundary at once.
//
// The grace period is the business rule and Ben owns the number. 14 days: long
// enough that an email chasing last week's job is not flung a year forward, short
// enough that a real forward booking always is. Change YEAR_ROLL_GRACE_DAYS and
// section [4] below says exactly what moves.
//
// Run: npx tsx test/dateYear.ts
// ============================================================================
import {
  rollYearForward, parseDates, parseDatesDetailed, reconcileRequests, YEAR_ROLL_GRACE_DAYS,
} from "../app/lib/engine/parseWork";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** The study's own reference date — the day the 100 emails were dated. */
const AUG = new Date("2026-08-24T09:00:00Z");

console.log("\n[1] the three cases named in the study, end to end");
{
  // R007, R027, R052. Model and parser both read the email's year.
  const cases: Array<[string, string, string]> = [
    ["Please book 4 crew for 8th March.", "2026-03-08", "2027-03-08"],
    ["We need 6 crew on 28th March at ExCeL", "2026-03-28", "2027-03-28"],
    ["3 crew, 22nd April please", "2026-04-22", "2027-04-22"],
  ];
  for (const [text, modelSaid, truth] of cases) {
    const { requests, report } = reconcileRequests(text, [{ date: modelSaid, size: 4 }], AUG);
    ok(requests[0].date === truth, `${JSON.stringify(text.slice(0, 28))} -> ${truth}`, String(requests[0].date));
    ok(report.rolled.length === 1, "and the roll is recorded so the ticket can say it");
  }
}

console.log("\n[2] the parser no longer makes the same mistake on its own");
{
  ok(parseDates("book crew for 8th March", AUG)[0] === "2027-03-08", "bare day+month rolls");
  ok(parseDates("8/3", AUG)[0] === "2027-03-08", "bare d/m rolls");
  ok(parseDates("March 8th", AUG)[0] === "2027-03-08", "month-first rolls");
}

console.log("\n[3] an EXPLICIT year is never touched, in the past or not");
{
  // A client can legitimately reference last year's job — an invoice query, a repeat
  // booking "same as 12 March 2026". Rolling that would invent a date nobody wrote.
  for (const [text, want] of [
    ["the job on 8 March 2026", "2026-03-08"],
    ["8/3/26", "2026-03-08"],
    ["2026-03-08", "2026-03-08"],
    ["8/3/2027", "2027-03-08"],
  ] as const) {
    ok(parseDates(text, AUG)[0] === want, `${JSON.stringify(text)} stays ${want}`, String(parseDates(text, AUG)[0]));
  }
  // And the model's own explicit-year date survives reconciliation untouched.
  const { requests, report } = reconcileRequests("the job on 8 March 2026", [{ date: "2026-03-08", size: 2 }], AUG);
  ok(requests[0].date === "2026-03-08", "reconcile leaves a stated year alone", String(requests[0].date));
  ok(report.rolled.length === 0, "and reports no roll");
}

console.log(`\n[4] the grace period — currently ${YEAR_ROLL_GRACE_DAYS} days`);
{
  // Just inside: an email chasing a job that ran days ago is not a booking a year out.
  const inside = new Date(AUG.getTime() - 0);
  ok(rollYearForward("2026-08-20", inside) === "2026-08-20", "4 days past — left alone");
  ok(rollYearForward("2026-08-11", inside) === "2026-08-11", "13 days past — left alone");
  ok(rollYearForward("2026-08-10", inside) === "2026-08-10", "exactly 14 days past — left alone (the boundary is inclusive)");
  ok(rollYearForward("2026-08-09", inside) === "2027-08-09", "15 days past — ROLLED");
  ok(rollYearForward("2026-08-24", inside) === "2026-08-24", "the email's own date — left alone");
  ok(rollYearForward("2026-08-25", inside) === "2026-08-25", "tomorrow — left alone");
  ok(rollYearForward("2026-12-25", inside) === "2026-12-25", "four months ahead — left alone");
}

console.log("\n[5] 29 February climbs to a year that HAS one");
{
  // Neither 2026 nor 2027 is a leap year. Validity used to be checked against the
  // reference's own year BEFORE anything moved, so a bare "29 Feb" was thrown away
  // as an impossible date and the request lost its date entirely — a booking that
  // holds rather than one that is a year out, but still a date the client wrote.
  ok(parseDates("29 February", AUG)[0] === "2028-02-29", "bare 29 Feb -> 2028, the next leap year", String(parseDates("29 February", AUG)[0]));
  ok(parseDates("29/02", AUG)[0] === "2028-02-29", "and the numeric form agrees", String(parseDates("29/02", AUG)[0]));
  // An impossible date with a year written on it is still rejected, as before.
  ok(parseDates("31 February 2027", AUG).length === 0, "31 February 2027 is not a date");
}

console.log("\n[6] a two-digit year still works and is still explicit");
{
  const d = parseDatesDetailed("2.3.27", AUG);
  ok(d[0]?.iso === "2027-03-02", "2.3.27 -> 2027-03-02", String(d[0]?.iso));
  ok(d[0]?.yearStated === true, "and counts as a stated year, so it is never rolled");
}

console.log("\n[7] the reference is the EMAIL's date, not the clock");
{
  // A thread swept from last October must parse against October.
  const oct = new Date("2025-10-02T09:00:00Z");
  ok(parseDates("12 Sept", oct)[0] === "2026-09-12", "October 2025 + '12 Sept' -> 2026-09-12", String(parseDates("12 Sept", oct)[0]));
  // The edge the rule has to get right in the OTHER direction. Reading this as next
  // December is the same error as reading "8th March" as last March.
  const dec = new Date("2027-01-02T09:00:00Z");
  ok(parseDates("28th December", dec)[0] === "2026-12-28", "2 Jan + '28th December' -> the December just gone (5 days, inside grace)", String(parseDates("28th December", dec)[0]));
  // And past the grace period it goes forward again, because now it reads as a booking.
  ok(parseDates("1st December", dec)[0] === "2027-12-01", "2 Jan + '1st December' (32 days gone) -> this December", String(parseDates("1st December", dec)[0]));
  const { requests } = reconcileRequests("4 crew on 28th December", [{ date: "2027-12-28", size: 4 }], dec);
  ok(requests[0].date === "2026-12-28", "and the model's forward guess is corrected too", String(requests[0].date));
}

console.log("\n[8] an ISO date is no longer read twice");
{
  // "2027-03-08" also matches the day-first pattern as "03-08", which invented a
  // second date. reconcileRequests only fills or challenges when the text yields
  // EXACTLY ONE date, so an ISO date in an email silently switched the check off.
  const d = parseDates("crew needed on 2027-03-08", AUG);
  ok(d.length === 1, "one date, not two", JSON.stringify(d));
  ok(d[0] === "2027-03-08", "and it is the right one");
  const { report } = reconcileRequests("4 crew needed on 2027-03-08", [{ date: "2026-03-08", size: 4 }], AUG);
  ok(report.conflicts.length === 1, "so the disagreement with the model is now reported", JSON.stringify(report.conflicts));
}

console.log("\n[9] the roll never moves the day or the month");
{
  for (const iso of ["2026-01-01", "2026-03-08", "2026-06-30", "2026-07-15"]) {
    const rolled = rollYearForward(iso, AUG);
    ok(rolled.slice(5) === iso.slice(5), `${iso} keeps its month and day`, rolled);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
