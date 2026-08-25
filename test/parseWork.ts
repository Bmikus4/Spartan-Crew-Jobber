// ============================================================================
// The deterministic work parser, against the shapes this mailbox actually uses.
// ----------------------------------------------------------------------------
// Every string here is the shape of a real enquiry (times, crew counts and dates as
// Spartan's clients write them). Fixtures only — no model, no key, no spend.
//
// The parser's contract is "exact or silent", so the negative cases matter as much as
// the positive ones: a parser that guesses is worse than no parser, because compose.ts
// will happily book what it produces.
// ============================================================================
import { parseTimes, parseCrew, parseDates, reconcileRequests } from "../app/lib/engine/parseWork";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const REF = new Date("2026-08-04T00:00:00Z");

console.log("parseWork");

// ------------------------------------------------------------------- times
{
  const cases: Array<[string, string | undefined, string | undefined]> = [
    ["Crew needed 09:00 - 16:00 please", "09:00", "16:00"],
    ["9am-5pm on site", "09:00", "17:00"],
    ["08:00–17:00", "08:00", "17:00"],                 // en dash
    ["from 8 till 5", "08:00", "17:00"],               // bare hours, PM inferred for 5
    ["8am to 6pm", "08:00", "18:00"],
    ["09.00-17.00", "09:00", "17:00"],
    ["on site at 07:30, finish by 6pm", "07:30", "18:00"],
    ["until 15:30", undefined, "15:30"],               // finish only
    ["call time 06:45", "06:45", undefined],           // start only
  ];
  for (const [text, start, end] of cases) {
    const r = parseTimes(text);
    ok(r?.start === start && r?.end === end, `times: ${JSON.stringify(text)}`,
       `got ${JSON.stringify(r)} want ${start}..${end}`);
  }

  const dur = parseTimes("6x3hr at 17:00");
  ok(dur?.start === "17:00" && dur?.end === "20:00" && dur.endFromDuration === true,
     "times: duration '6x3hr at 17:00' -> 17:00-20:00", JSON.stringify(dur));
  const dur2 = parseTimes("17:00 for 4 hours");
  ok(dur2?.start === "17:00" && dur2?.end === "21:00", "times: '17:00 for 4 hours'", JSON.stringify(dur2));

  ok(parseTimes("we will confirm timings nearer the date") === null,
     "times: silent when no time is stated");
  ok(parseTimes("invoice 12345 attached") === null, "times: a bare number is not a time");
}

// -------------------------------------------------------------------- crew
{
  const one = (t: string) => JSON.stringify(parseCrew(t));
  ok(one("We need 6 crew") === '[{"size":6}]', "crew: '6 crew'", one("We need 6 crew"));
  ok(one("x4 locals") === '[{"size":4}]', "crew: 'x4 locals'", one("x4 locals"));
  ok(one("crew of 6") === '[{"size":6}]', "crew: 'crew of 6'", one("crew of 6"));
  ok(one("6 x crew") === '[{"size":6}]', "crew: '6 x crew'", one("6 x crew"));
  ok(one("4 x CSCS") === '[{"size":4,"hint":"CSCS"}]', "crew: role is captured", one("4 x CSCS"));
  ok(one("2 drivers") === '[{"size":2,"hint":"driver"}]', "crew: drivers", one("2 drivers"));
  ok(one("1 crew chief") === '[{"size":1,"hint":"crew chief"}]', "crew: chief is not general crew", one("1 crew chief"));

  const two = parseCrew("Please send 4 crew and 2 drivers");
  ok(two.length === 2 && two[0].size === 4 && two[1].size === 2,
     "crew: two roles in one sentence stay two requests", JSON.stringify(two));

  ok(parseCrew("thanks, all confirmed").length === 0, "crew: silent when none asked for");
  ok(parseCrew("PO 4592001 attached").length === 0, "crew: a PO number is not a crew count");
}

// ------------------------------------------------------------------- dates
{
  const d = (t: string) => parseDates(t, REF);
  // The reference is 2026-08-04, so 12 September is five weeks ahead and the
  // next-occurrence rule leaves it in the reference's own year. Where it does NOT —
  // a bare date already well past — is test/dateYear.ts, which owns that rule.
  ok(d("12 September")[0] === "2026-09-12", "dates: '12 September' takes the reference year", d("12 September")[0]);
  ok(d("12th Sept 2027")[0] === "2027-09-12", "dates: an explicit year wins");
  ok(d("12/09/2026")[0] === "2026-09-12", "dates: 12/09 is day-first (UK)", d("12/09/2026")[0]);
  ok(d("2026-09-12")[0] === "2026-09-12", "dates: ISO passes through");
  ok(d("Sat 12 Sep")[0] === "2026-09-12", "dates: a weekday prefix is ignored");
  ok(d("September 12")[0] === "2026-09-12", "dates: month-first prose");
  ok(d("31 February")[0] === undefined, "dates: an impossible day is rejected", JSON.stringify(d("31 February")));
  ok(d("thanks for your help")[0] === undefined, "dates: silent when none stated");

  const multi = d("get-in 11 Sept, show 12 Sept, get-out 13 Sept");
  ok(multi.length === 3, "dates: three dates are three dates", JSON.stringify(multi));

  // The reason parseDates takes a reference instead of reading the clock: a thread
  // swept from October 2025 must be read against October 2025.
  ok(parseDates("12 October", new Date("2025-10-01T00:00:00Z"))[0] === "2025-10-12",
     "dates: an old thread parses against ITS year, not today's",
     parseDates("12 October", new Date("2025-10-01T00:00:00Z"))[0]);
}

// --------------------------------------------------------------- reconcile
{
  // The case the 18:00 default was hiding: a stated finish the model missed.
  const { requests, report } = reconcileRequests(
    "Please send 6 crew on 12 September, 09:00 - 16:00.",
    [{ date: "2026-09-12", size: 6 }],
    REF
  );
  ok(requests[0].start_time === "09:00" && requests[0].end_time === "16:00",
     "reconcile: fills a stated shift the model left blank", JSON.stringify(requests[0]));
  ok(report.filled.length === 2 && !report.conflicts.length, "reconcile: reports the fills, no conflict", JSON.stringify(report));
}
{
  // Disagreement must be raised, NOT silently corrected.
  const { requests, report } = reconcileRequests(
    "6 crew on 12 September, 09:00 - 16:00.",
    [{ date: "2026-09-12", size: 6, start_time: "08:00", end_time: "18:00" }],
    REF
  );
  ok(requests[0].end_time === "18:00", "reconcile: the model's value is NOT overruled");
  ok(report.conflicts.length === 2, "reconcile: both disagreements are reported", JSON.stringify(report.conflicts));
  ok(report.conflicts.some((c) => /end_time: model 18:00, text 16:00/.test(c)),
     "reconcile: the conflict names both readings", report.conflicts.join(" | "));
}
{
  // Several blocks: the parser has no idea which block a time belongs to, so it stands down.
  const { report } = reconcileRequests(
    "11 Sept 09:00-16:00 get-in, 12 Sept show day",
    [{ date: "2026-09-11", size: 4 }, { date: "2026-09-12", size: 4 }],
    REF
  );
  ok(report.filled.length === 0 && report.conflicts.length === 0,
     "reconcile: silent when the text describes more than one block", JSON.stringify(report));
}
{
  // The recovery case: the classifier threw it away and the extractor returned nothing.
  const { requests, report } = reconcileRequests(
    "Hi, could you cover 8 crew on 19 September? Thanks",
    [],
    REF
  );
  ok(requests.length === 1 && requests[0].size === 8 && requests[0].date === "2026-09-19",
     "reconcile: recovers a block from text when the model returned none", JSON.stringify(requests));
  ok(report.filled.some((f) => /recovered from text/.test(f)), "reconcile: says the block was recovered");
}
{
  // ...but only when it is unambiguous.
  const { requests } = reconcileRequests("Can you help with crew in September?", [], REF);
  ok(requests.length === 0, "reconcile: does not invent a block from vague text", JSON.stringify(requests));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
