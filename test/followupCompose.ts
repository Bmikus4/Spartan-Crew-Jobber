// ============================================================================
// What Spartan is waiting on — and when the honest answer is "nothing".
// ----------------------------------------------------------------------------
// This is the gate between a client and a nag. composeChase writes whatever it is
// told is outstanding, so if this function invents an ask, the model dutifully
// dresses it up in good English and a real person receives an email about nothing.
//
// The case in [2] is not hypothetical. Spartan's last message on live thread
// 1a0662d09571ad87 was "Hi Michael, Just wanted to see how everything went?" — a
// courtesy after a finished job. Read as an ask (it ends in a question mark) it
// produced "Hope the move went well! Just wanted to check in and see how everything
// went with the crew and van." That is the single most deletable email there is, and
// it would have gone to a real client had the two-thread check not been run first.
//
// Offline. No model, no network.  npx tsx test/followupCompose.ts
// ============================================================================
import { outstandingAsk } from "../app/lib/followup/compose";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

console.log("\n[1] a real question is the ask");
{
  ok(outstandingAsk("Hi Jo,\n\nHappy to cover that. Could you confirm the site contact number?\n\nThanks")
    === "Could you confirm the site contact number?", "the question we actually asked",
    String(outstandingAsk("Hi Jo,\n\nHappy to cover that. Could you confirm the site contact number?\n\nThanks")));
}

console.log("\n[2] a pleasantry ending in a question mark is NOT an ask");
{
  ok(outstandingAsk("Hi Michael,\n\nJust wanted to see how everything went?") === null,
    "the live case that produced a nag",
    String(outstandingAsk("Hi Michael,\n\nJust wanted to see how everything went?")));
  ok(outstandingAsk("Hope you're well? Just checking in.") === null, "hope-you're-well is not an ask");
  ok(outstandingAsk("Hi Sam, how did it go on Saturday?") === null, "nor is how-did-it-go");
}

console.log("\n[3] a greeting is never the ask, even when the ask follows it");
{
  const a = outstandingAsk("Hello Priya,\nWhat time do you need the crew on site?");
  ok(a === "What time do you need the crew on site?", "the greeting line is stripped", String(a));
}

console.log("\n[4] a statement can still name what is outstanding");
{
  ok(outstandingAsk("We'll need the purchase order number before we can book this in.")
    === "the purchase order number", "a PO is recognised without a question mark");
  ok(outstandingAsk("Once you confirm we will get this in the diary.")
    === "confirmation so the job can be booked in", "so is a confirmation");
}

console.log("\n[5] a quoted question belongs to whoever wrote it, not to us");
{
  /**
   * MEASURED, NOT IMAGINED. Two of the fourteen drafts generated on 2026-09-29 asked
   * this way: threads 1a0662d09571ad87 (">>>>>>>>>> How late is late evening?") and
   * 1a08baf3b26360a8 ("> > Do you have a contact number?"). Both are the CLIENT's own
   * question quoted inside Spartan's reply, so the chase asked them to answer
   * themselves.
   */
  ok(outstandingAsk("Thanks, noted.\n\n>>>>>>>>>> How late is late evening?") === null,
    "a quoted client question is not our ask",
    String(outstandingAsk("Thanks, noted.\n\n>>>>>>>>>> How late is late evening?")));
  ok(outstandingAsk("Booked in.\n\n> > Do you have a contact number?") === null,
    "however many quote markers it carries");
  ok(outstandingAsk("On Mon, 8 Sep 2026 at 10:04, Jo <jo@x.com> wrote:\nWhat time do you need us?") === null,
    "an attribution line's quoted body is not ours either");
  ok(outstandingAsk("Could you send the PO number?\n\n> > Do you have a contact number?")
    === "Could you send the PO number?",
    "and our own question above the quote still wins",
    String(outstandingAsk("Could you send the PO number?\n\n> > Do you have a contact number?")));
}

console.log("\n[6] nothing identifiable means nothing is sent");
{
  ok(outstandingAsk("") === null, "an empty message asks for nothing");
  ok(outstandingAsk("Thanks, all booked in. See you Friday.") === null,
    "a confirmation asks for nothing", String(outstandingAsk("Thanks, all booked in. See you Friday.")));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
