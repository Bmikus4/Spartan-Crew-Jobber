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

console.log("\n[6] an open offer places no obligation on anyone");
{
  /**
   * ALL FOUR MEASURED ON LIVE MAIL. The corpus is full of sign-off courtesies that
   * parse as requests, and each one would have produced an email asking a client
   * whether they had anything to ask us.
   *
   * 19db58a19ee0cbc4 sat "owed" from April on "Please let me know if any is needed or
   * changed". The footer case is worse: EVERY outbound email this company sends ends
   * with "…no products or services are reserved until the booking is confirmed with a
   * Purchase Order", which supplied both a request word and a PO to 448 of 491
   * threads before the tail was cut.
   */
  ok(outstandingAsk("Thanks, all confirmed on our side. Please let me know if any is needed or changed.") === null,
    "'please let me know if…' is an offer, not a request",
    String(outstandingAsk("Thanks, all confirmed on our side. Please let me know if any is needed or changed.")));
  ok(outstandingAsk("Please see updated quote attached. Let us know if you need any more crew.") === null,
    "'please see' is politeness about a document");
  ok(outstandingAsk("Quote attached. Please note, all quotes sent from this account are valid for 14 days from the date of issue, and no products or services are reserved until the booking is confirmed with a Purchase Order.") === null,
    "the standing footer is not a request for a PO",
    String(outstandingAsk("Quote attached. Please note, all quotes sent from this account are valid for 14 days from the date of issue, and no products or services are reserved until the booking is confirmed with a Purchase Order.")));
  ok(outstandingAsk("Thank you for the PO, this is now updated on our end. Please confirm the start time.")
    === "the start time",
    "and a thing already RECEIVED is not what we chase for",
    String(outstandingAsk("Thank you for the PO, this is now updated on our end. Please confirm the start time.")));

  /**
   * THE INVERTED ORDER, which the first version of the offer strip missed entirely —
   * it required "let me know IF". Two drafts already in the live mailbox
   * (1a0b51b8edf472f9 and 1a0b48de8c41c60e) chase on exactly this sentence.
   */
  ok(outstandingAsk("All booked in. If you need anything else in the future, please let me know.") === null,
    "the conditional can come FIRST and it is still an offer",
    String(outstandingAsk("All booked in. If you need anything else in the future, please let me know.")));
  ok(outstandingAsk("Crew confirmed. If there is anything else I can help with please let me know.") === null,
    "'if there is anything else…' likewise");
  ok(outstandingAsk("Please let me know the start time.") === "the start time",
    "but a courtesy WITH an object is a real request",
    String(outstandingAsk("Please let me know the start time.")));
}

console.log("\n[7] nothing identifiable means nothing is sent");
{
  ok(outstandingAsk("") === null, "an empty message asks for nothing");
  ok(outstandingAsk("Thanks, all booked in. See you Friday.") === null,
    "a confirmation asks for nothing", String(outstandingAsk("Thanks, all booked in. See you Friday.")));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
