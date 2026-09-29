// ============================================================================
// Follow-up: whose turn it is, since when, and when the label goes on.
// ----------------------------------------------------------------------------
// The cases here are the spec's own sentences turned into assertions. The two that
// matter most are [3] — a chaser must not buy itself another 24 hours of silence —
// and [6], a reply clearing an overdue label, because those are the two ways a
// follow-up system becomes actively harmful rather than merely useless.
//
// Offline. No model, no network, no database.  npx tsx test/followupClock.ts
// ============================================================================
import {
  waitingPeriod, decide, needsResponse, closureOnly, isOverdue, sendEligible,
  THRESHOLD_HOURS, SEND_GRACE_HOURS, DORMANT_AFTER_DAYS,
} from "../app/lib/followup/clock";
import type { ThreadMessage } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const T0 = Date.parse("2026-09-14T09:00:00.000Z");
const at = (hours: number) => new Date(T0 + hours * 3_600_000).toISOString();
const when = (hours: number) => new Date(T0 + hours * 3_600_000);

let seq = 0;
const client = (hours: number, body: string): ThreadMessage => ({
  message_id: `c${++seq}`, from: "jo@wall-to-wall.example", to: ["bookings@spartancrew.co.uk"],
  date_iso: at(hours), subject: "3 x Crew 19th/20th September", body, is_from_spartan: false,
});
const spartan = (hours: number, body: string): ThreadMessage => ({
  message_id: `s${++seq}`, from: "bookings@spartancrew.co.uk", to: ["jo@wall-to-wall.example"],
  date_iso: at(hours), subject: "Re: 3 x Crew 19th/20th September", body, is_from_spartan: true,
});

const OPEN = { labelled: false, suppressed: false };
const LABELLED = { labelled: true, suppressed: false };

console.log("\n[1] a client enquiry starts a client-waiting-for-Spartan period");
{
  const w = waitingPeriod([client(0, "Can you cover 3 crew on the 19th and 20th?")]);
  ok(w?.owed_by === "us", "Spartan owes the reply", String(w?.owed_by));
  ok(w?.since_iso === at(0), "dated from the enquiry", String(w?.since_iso));
  ok(w?.due_iso === at(THRESHOLD_HOURS), "due 24 hours later", String(w?.due_iso));
}

console.log("\n[2] a Spartan message that asks starts the opposite period; one that does not, does not");
{
  const asked = waitingPeriod([
    client(0, "Can you cover 3 crew on the 19th?"),
    spartan(1, "Yes we can. Could you confirm the site contact number?"),
  ]);
  ok(asked?.owed_by === "them", "the client now owes an answer", String(asked?.owed_by));
  ok(asked?.since_iso === at(1), "dated from our question", String(asked?.since_iso));

  const told = waitingPeriod([
    client(0, "Can you cover 3 crew on the 19th?"),
    spartan(1, "Confirmed — three crew, 08:00 start, both days. See you then."),
  ]);
  ok(told === null, "a confirmation obliges the client to do nothing, so nobody is waiting",
    JSON.stringify(told));
}

console.log("\n[3] a second message from the SAME waiting party does not reset the clock");
{
  /**
   * THE RULE THIS WHOLE MODULE EXISTS FOR. A client who asks on Monday and chases on
   * Tuesday is owed a reply from MONDAY. If the chase reset the clock, the threads
   * being chased hardest would be the last ever to surface — precisely inverted.
   */
  const w = waitingPeriod([
    client(0, "Can you cover 3 crew on the 19th?"),
    client(20, "Any update on this one?"),
    client(30, "Sorry to chase again - we need to confirm with the venue."),
  ]);
  ok(w?.since_iso === at(0), "dated from the FIRST unanswered message", String(w?.since_iso));
  ok(w?.due_iso === at(THRESHOLD_HOURS), "so it was already overdue before the chases",
    String(w?.due_iso));
  ok(decide([
    client(0, "Can you cover 3 crew on the 19th?"),
    client(20, "Any update on this one?"),
  ], OPEN, when(25)).kind === "apply", "and the label goes on at 25 hours, not 44");
}

console.log("\n[3b] a courtesy sign-off of ours does not put the client in our debt");
{
  /**
   * MEASURED ON LIVE MAIL, not imagined. Thread 1a0662d09571ad87 ends with Spartan
   * writing "Just wanted to see how everything went?" after a finished job. A bare
   * question mark made that an ask, so the board raised a follow-up nobody could
   * write — outstandingAsk refused to name anything to chase for. needsResponse now
   * asks outstandingAsk, so the clock and the composer cannot disagree.
   *
   * Thread 1a08fd268be97aa8's "let us know if you need any more crew next week" is
   * the same shape: an open offer, not an outstanding item.
   */
  ok(waitingPeriod([
    client(0, "Can you cover 3 crew on the 19th?"),
    spartan(1, "All sorted, 3 crew confirmed. Just wanted to see how everything went?"),
  ]) === null, "a 'how did it go?' after the job leaves nobody waiting");

  ok(waitingPeriod([
    client(0, "Can you cover 3 crew on the 19th?"),
    spartan(1, "Please see updated quote attached. Let us know if you need any more crew next week."),
  ]) === null, "an open offer is not an outstanding item");

  ok(waitingPeriod([
    client(0, "Can you cover 3 crew on the 19th?"),
    spartan(1, "Quote attached. If you're happy to confirm please send a PO and a site contact."),
  ])?.owed_by === "them", "but a real request for a PO still puts the ball in their court");
}

console.log("\n[4] machine mail satisfies nothing");
{
  const bounce: ThreadMessage = {
    message_id: "x1", from: "mailer-daemon@googlemail.com", to: ["bookings@spartancrew.co.uk"],
    date_iso: at(2), subject: "Delivery Status Notification (Failure)",
    body: "Address not found", is_from_spartan: false,
  };
  const w = waitingPeriod([client(0, "Can you cover 3 crew on the 19th?"), bounce]);
  ok(w?.owed_by === "us", "a bounce does not make it the client's turn", String(w?.owed_by));
  ok(w?.since_iso === at(0), "and does not move the clock", String(w?.since_iso));

  const ooo = client(2, "Thank you for your email. I am out of the office until Monday with no access to email.");
  const w2 = waitingPeriod([spartan(0, "Could you confirm the site contact?"), ooo]);
  ok(w2?.owed_by === "them", "an out-of-office does not answer our question", String(w2?.owed_by));
}

console.log("\n[5] a closed conversation stops generating follow-ups");
{
  const w = waitingPeriod([
    client(0, "Can you cover 3 crew on the 19th?"),
    spartan(1, "Confirmed - three crew, both days."),
    client(2, "Perfect, thanks!"),
  ]);
  ok(w === null, "a closing thanks leaves nobody waiting", JSON.stringify(w));
  ok(decide([
    client(0, "Can you cover 3 crew?"),
    spartan(1, "Confirmed."),
    client(2, "Perfect, thanks!"),
  ], OPEN, when(500)).kind === "none", "and 500 hours later it is still not a follow-up");
}

console.log("\n[6] a real reply clears an overdue label, and the new wait gets a fresh clock");
{
  /**
   * The second half of the spec's "clear its follow-up state and invalidate its queued
   * send". `clear` is what tells the caller to drop the queued chase — which is the
   * difference between a tidy system and one that emails a client four minutes after
   * they finally answered.
   */
  const answered = [
    client(0, "Can you cover 3 crew on the 19th?"),
    spartan(30, "Sorry for the delay - yes. Could you confirm the site contact?"),
  ];
  const d = decide(answered, LABELLED, when(31));
  ok(d.kind === "clear", "the label comes off the moment we answer", d.kind);

  const w = waitingPeriod(answered);
  ok(w?.owed_by === "them" && w.since_iso === at(30),
    "and the client's clock starts at our reply, not at the original enquiry",
    `${w?.owed_by} ${w?.since_iso}`);
  ok(decide(answered, OPEN, when(50)).kind === "none",
    "so at 50 hours - 50 since the enquiry, 20 since our reply - nothing is due yet");
  ok(decide(answered, OPEN, when(55)).kind === "apply",
    "and it becomes due 24 hours after OUR message");
}

console.log("\n[7] a human can suppress, and suppression outranks everything");
{
  const overdue = [client(0, "Can you cover 3 crew on the 19th?")];
  ok(decide(overdue, { labelled: false, suppressed: true }, when(99)).kind === "none",
    "a suppressed thread is never labelled");
  ok(decide(overdue, { labelled: true, suppressed: true }, when(99)).kind === "clear",
    "and suppressing one that is already labelled takes the label off");
}

console.log("\n[8] the label is idempotent, and replay cannot corrupt a deadline");
{
  const msgs = [client(0, "Can you cover 3 crew on the 19th?")];
  ok(decide(msgs, LABELLED, when(99)).kind === "none", "an already-labelled thread is left alone");
  const a = waitingPeriod(msgs);
  const b = waitingPeriod([...msgs, ...msgs]);           // the same event delivered twice
  const c = waitingPeriod([...msgs].reverse());          // delivered out of order
  ok(a?.due_iso === b?.due_iso && a?.due_iso === c?.due_iso,
    "duplicate and out-of-order delivery give one deadline", `${a?.due_iso} ${b?.due_iso} ${c?.due_iso}`);
}

console.log("\n[9] sending waits a further six hours; drafting does not");
{
  const w = waitingPeriod([client(0, "Can you cover 3 crew on the 19th?")])!;
  ok(isOverdue(w, when(THRESHOLD_HOURS)), "overdue exactly at the threshold");
  ok(!sendEligible(w, when(THRESHOLD_HOURS + 1)), "but not yet sendable an hour later");
  ok(sendEligible(w, when(THRESHOLD_HOURS + SEND_GRACE_HOURS)),
    "and sendable at threshold + grace");
}

console.log("\n[10] a wait past the horizon raises nothing new, but never loses a label it has");
{
  const stale = [client(0, "Can you cover 3 crew on the 19th?")];
  const wayLater = when(DORMANT_AFTER_DAYS * 24 + 1);
  ok(decide(stale, OPEN, when(25)).kind === "apply", "inside the horizon it is a follow-up");
  const dormant = decide(stale, OPEN, wayLater);
  ok(dormant.kind === "none", "past it, no NEW follow-up is raised",
    dormant.kind === "none" ? dormant.why : "");
  ok(decide(stale, LABELLED, wayLater).kind === "none",
    "and a thread already labelled keeps its label rather than having it retracted");
  ok(decide([
    client(0, "Can you cover 3 crew?"),
    spartan(1, "Confirmed - both days."),
    client(2, "Perfect, thanks!"),
  ], LABELLED, wayLater).kind === "clear",
    "but a wait that genuinely ENDED still clears, however old");
}

console.log("\n[11] the predicates themselves");
{
  ok(closureOnly(client(0, "Thanks!")), "'Thanks!' is a closure");
  ok(!closureOnly(client(0, "Thanks - and can you also cover Sunday?")),
    "'Thanks, and can you also...' is not");
  ok(needsResponse(client(0, "We need 4 crew on Friday")), "a client request needs an answer");
  ok(!needsResponse(spartan(0, "All booked, see you Friday.")), "our confirmation does not");
  ok(needsResponse(spartan(0, "Please confirm the start time.")), "our question does");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
