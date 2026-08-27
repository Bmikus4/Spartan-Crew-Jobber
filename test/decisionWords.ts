// ============================================================================
// The engine's words, said the way a person would say them.
// ----------------------------------------------------------------------------
// Every string tested here is a REAL one, pulled from the live tickets table on
// 2026-08-24 — not an invented example. That matters: the rules match on exact
// phrasing, so a fixture written from the regex rather than from the data would
// pass while the screen still showed "SlotTeam[0]" to the booking desk.
//
// The load-bearing property is the LAST one: anything unrecognised passes through
// unchanged. A note nobody has taught this module about is still a note somebody
// has to read, and dropping it because it did not match would hide exactly the
// unusual case that matters most.
//
// Run: npx tsx test/decisionWords.ts
// ============================================================================
import { noteWords, gateWords, classificationWords, priorityWords } from "../app/lib/decisionWords";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const says = (input: string, want: RegExp, label: string) => {
  const got = noteWords(input);
  ok(want.test(got), label, got);
};

async function main() {
  console.log("field names become the words the desk uses");
  says("this message filled company_name, contact_name, contact_email, contact_phone, location_text, requests",
    /^Read from this email: company, contact name, email, phone, venue, the crew request$/,
    "the field list is translated, in order");
  ok(!/[_[\]]/.test(noteWords("this message filled company_name, contact_phone")),
    "and no underscores or brackets survive into the sentence", noteWords("this message filled company_name, contact_phone"));

  console.log("");
  console.log("blocks are counted from one, because nobody outside the code counts from zero");
  says("SlotTeam[0] start time not stated — defaulted to 08:00",
    /^Block 1: no start time was given, so 08:00 was assumed$/, "SlotTeam[0] is Block 1");
  says("SlotTeam[1] finish time not stated — defaulted to 18:00",
    /^Block 2: no finish time was given, so 18:00 was assumed$/, "SlotTeam[1] is Block 2");
  says('SlotTeam[0] profession not recognised in "porter" — booked as Crew',
    /^Block 1: “porter” is not a role in OnSinch, so it was booked as general Crew$/, "an unknown role says what happened instead");
  // The catch-all keeps the block number even for a note this module has never seen.
  says("SlotTeam[2] something nobody has written yet",
    /^Block 3: something nobody has written yet$/, "an unknown SlotTeam note still gets its number fixed");

  console.log("");
  console.log("the facts a person acts on");
  says('new venue "Ivy Restaurant Manchester" — will be created in OnSinch on confirm',
    /^“Ivy Restaurant Manchester” is a new venue — it will be created in OnSinch when this is confirmed$/,
    "a new venue says what confirming will do");
  says('company from a name resolved before ("Blue Oak Removals")',
    /^Client matched to “Blue Oak Removals” from a name seen before$/, "a remembered client says so");
  says("matched existing OnSinch order #13633 (job J13913) (same date) — will update, not create",
    /^Matches order #13633 \(job J13913\) on the same date — that order will be updated rather than a second one raised$/,
    "a dedup match says which order and what will happen to it");
  /**
   * The wording changed with the behaviour on 2026-08-27. An assumed rate card no longer
   * HOLDS the booking — it is written and flagged — so "check it before confirming" was
   * telling a human to do something there is no longer a step for. It now says the job is
   * booked, which is the fact that changes what they do next.
   */
  const assumed = "no pricing history for company 652 — using the standard rate card 315; CHECK THE PRICE — the job is booked (I1)";
  says(assumed,
    /^No past pricing for this client, so the standard rate card \(315\) was used — the job is booked, check the price$/,
    "the rate-card warning says the job WENT, and what to check");
  ok(!/I1/.test(noteWords(assumed)),
    "and the (I1) tag, which means nothing to anybody, is gone");

  console.log("");
  console.log("the crew-chief note, which is the one most often misread as extra crew");
  says("crew-chief rule: team of 6 -> 5 + 1 chief (headcount unchanged)",
    /^Crew chief: the 6 asked for is 5 crew plus 1 chief — the same 6 people, not one more$/,
    "it says the headcount did not change, in numbers");

  console.log("");
  console.log("why a message never reached the model");
  ok(gateWords("filtered before the model [own-mail]: sent by Spartan (bookings@spartancrew.co.uk)")
     === "Skipped before the model: Spartan sent this itself, from bookings@spartancrew.co.uk",
     "own mail says who sent it", gateWords("filtered before the model [own-mail]: sent by Spartan (bookings@spartancrew.co.uk)"));
  ok(/no-reply address, so there is nobody to answer$/.test(
       gateWords("filtered before the model [machine-sender]: unrepliable address (no-reply@sinch.cz)")),
     "an unrepliable address says WHY that matters");
  ok(gateWords("machine mail from mike@wearefamilylondon.com — not a client enquiry")
     === "Automated mail from mike@wearefamilylondon.com — not a client enquiry", "machine mail reads plainly");
  ok(/shadow mode is on, so it was read anyway$/.test(
       gateWords("triage WOULD have skipped this [bulk-body]: body carries newsletter markers (no headers available) — shadow mode, read anyway")),
     "shadow mode explains that nothing was actually dropped");
  ok(gateWords(null) === "" && gateWords("") === "", "no reason renders nothing rather than the word null");

  console.log("");
  console.log("the decision itself");
  ok(classificationWords("not-a-job").label === "Not a job", "not-a-job loses its hyphens");
  ok(/no crew/.test(classificationWords("not-a-job").gloss), "and says what it means");
  ok(classificationWords("update").label === "A change to an existing job",
     "an update says what changed, not the word update", classificationWords("update").label);
  ok(classificationWords("something-new").label === "something-new",
     "an unknown classification is shown as it is, not as 'unknown'");
  ok(priorityWords("high") === "High — answer today", "high priority says what to do about it");
  ok(priorityWords("") === "", "and an absent one says nothing");

  console.log("");
  console.log("ANYTHING UNRECOGNISED SURVIVES WORD FOR WORD");
  const odd = "some future note format nobody has seen: 42 things";
  ok(noteWords(odd) === odd, "an unknown note is returned unchanged");
  ok(gateWords(odd) === odd, "so is an unknown gate reason");
  ok(noteWords("  padded  ") === "padded", "only whitespace is taken off");
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
