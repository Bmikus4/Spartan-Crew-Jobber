// ============================================================================
// A client enquiry forwarded by a colleague must still be seen.
// ----------------------------------------------------------------------------
// Spartan's own workflow puts client requests into bookings@ second-hand. Live
// thread 19fc73c87a9f16ba: June Thompson emailed Michelle directly, Michelle
// replied and looped bookings in — "@Bookings Spartan Crew can you look into
// June's request please?" — so the bookings mailbox never received June's email.
// Both messages in the thread are from @spartancrew.co.uk, and June's actual
// request survives only as quoted text:
//
//     > Do you have availability on September 19th 2026 for a fashion show?
//
// Two things then conspire. cleanEmailBody drops every line starting with ">",
// deleting the request; and selectLatest, finding no non-Spartan message, falls
// back to the newest of all — one of Spartan's own emails. So the engine
// classified OUR outbound, correctly concluded it was asking for details rather
// than making a booking, and dismissed a real enquiry.
//
// Gmail's attribution line is machine-written and parseable:
//     On Mon, 3 Aug 2026 at 11:42, June Thompson <june@farago-projects.com> wrote:
// so the original sender and their request can be recovered rather than guessed.
//
// Narrow by design: this only applies when a thread has NO client message, which
// is exactly the shape that is otherwise guaranteed to be misjudged.
//
// Run: npx tsx test/forwardedEnquiry.ts
// ============================================================================
import { normalizeThread } from "../app/lib/engine/normalize";
import type { HydratedThread, ThreadMessage } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const m = (o: Partial<ThreadMessage>): ThreadMessage => ({
  message_id: "m", from: "bookings@spartancrew.co.uk", to: [],
  date_iso: "2026-08-03T10:00:00.000Z", subject: "", body: "", is_from_spartan: true, ...o,
});

// The live thread, near-verbatim.
const FORWARDED: HydratedThread = {
  thread_id: "19fc73c87a9f16ba",
  messages: [
    m({
      message_id: "m1",
      from: "michelle@spartancrew.co.uk",
      date_iso: "2026-08-03T10:47:28.000Z",
      subject: "Re: SPARTAN CREW - CHOPOVA LOWENA - 19 SEPTEMBER 2026",
      body:
        "Hi June, I am thank you, hope you are too! I'm sure we do, if you can let us know how many crew you would need, for how many hours and also the location, my colleagues in bookings will be happy to assist you. @Bookings Spartan Crew <bookings@spartancrew.co.uk> can you look into June's request please? Kind regards,\n" +
        "On Mon, 3 Aug 2026 at 11:42, June Thompson <june@farago-projects.com> wrote:\n" +
        "> Hi Michelle,\n> \n> Hope you're having a great summer! Do you have availability on September\n> 19th 2026 for a fashion show?\n> \n> Thanks,\n> June\n",
    }),
    m({
      message_id: "m2",
      from: "bookings@spartancrew.co.uk",
      date_iso: "2026-08-03T10:50:40.000Z",
      subject: "Re: SPARTAN CREW - CHOPOVA LOWENA - 19 SEPTEMBER 2026",
      body: "Hi June, Thank you for your email. As per Michelle's email, if you could provide the number of crew required, the location and the call start time and finish time, I will send you a price quote. Kind regards, Zac",
    }),
  ],
};

console.log("\n[1] the client's request is recovered from the forward");
{
  const { latest, machine } = normalizeThread(FORWARDED);
  console.log(`      latest.from = ${latest.from}`);
  console.log(`      latest.body = ${latest.body.slice(0, 120)}`);
  ok(!machine, "not machine mail");
  ok(latest.from === "june@farago-projects.com",
    "acts on JUNE, not on Spartan's own reply", latest.from);
  ok(latest.is_from_spartan === false, "and is marked as a client message");
  ok(/availability on September/i.test(latest.body),
    "the actual request survived", latest.body.slice(0, 80));
  ok(!/let us know how many crew you would need/i.test(latest.body),
    "Spartan's own words are NOT the thing being classified");
}

console.log("\n[2] a thread WITH a real client message is untouched");
{
  const normal: HydratedThread = {
    thread_id: "t-normal",
    messages: [
      m({ message_id: "c1", from: "ops@bigevents.com", is_from_spartan: false, body: "We need 6 crew at ExCeL on 12 August, 08:00-18:00." }),
      m({ message_id: "s1", date_iso: "2026-08-03T11:00:00.000Z", body: "Thanks, confirming availability now. Kind regards, Zac" }),
    ],
  };
  const { latest } = normalizeThread(normal);
  ok(latest.from === "ops@bigevents.com", "still the real client message", latest.from);
  ok(/6 crew/.test(latest.body), "its body is intact");
}

console.log("\n[3] an internal thread with no client anywhere stays as it was");
{
  const internal: HydratedThread = {
    thread_id: "t-internal",
    messages: [
      m({ message_id: "s1", from: "michelle@spartancrew.co.uk", body: "Reminder: team meeting Thursday. No client involved." }),
    ],
  };
  const { latest } = normalizeThread(internal);
  ok(latest.from === "michelle@spartancrew.co.uk", "falls back to the Spartan message", latest.from);
  ok(latest.is_from_spartan === true, "still flagged as ours");
}

console.log("\n[4] a quoted SPARTAN address is not mistaken for a client");
{
  const selfQuote: HydratedThread = {
    thread_id: "t-self",
    messages: [
      m({
        message_id: "s1",
        body:
          "Following up on the below.\n" +
          "On Mon, 3 Aug 2026 at 09:00, Zac Spartan <bookings@spartancrew.co.uk> wrote:\n" +
          "> Can you confirm the crew numbers for Thursday?\n",
      }),
    ],
  };
  const { latest } = normalizeThread(selfQuote);
  ok(latest.is_from_spartan === true, "quoting ourselves does not invent a client", latest.from);
}

console.log("\n[5] a forward with no parseable attribution is left alone");
{
  const vague: HydratedThread = {
    thread_id: "t-vague",
    messages: [
      m({ message_id: "s1", body: "See below, can bookings pick this up?\n> do you have availability in September?\n" }),
    ],
  };
  const { latest } = normalizeThread(vague);
  ok(latest.is_from_spartan === true, "no sender to attribute it to, so nothing is fabricated");
}

// ===========================================================================
// The OTHER Gmail quote header. Ben, 2026-08-09: "spartancrew uses only gmail,
// is this for the client or the team?" — the content is the client's, the
// forward is the team's, and the format is Gmail's second one, not a foreign
// mail client's. Gmail writes "On <date> ... wrote:" for a reply and
// "---------- Forwarded message ---------" for a forward, and only the first was
// ever read.
//
// Live thread 19e8e21517a3f085: Chanelle at Blackout asked Tracy to increase a
// shift to 9 hours, Tracy forwarded it to bookings@, and Jake handled it by
// hand. Every message is @spartancrew.co.uk, so triage's own-mail tier skipped
// the thread — and that tier is non-overridable, so no dated crew request can
// rescue it.
//
// Over the 5,835-thread corpus: 740 threads carry no client message, 51 are
// recoverable from a reply attribution, and 44 more from a forward.
// ===========================================================================
console.log("\n[6] a client request inside a Gmail FORWARD is recovered");
{
  const forwarded: HydratedThread = {
    thread_id: "19e8e21517a3f085",
    messages: [
      m({
        message_id: "f1",
        from: "tracy@spartancrew.co.uk",
        date_iso: "2026-06-03T15:36:35.000Z",
        subject: "Fwd: Increased hours - 06/06/26 - 13:00 Excel.",
        body:
          "---------- Forwarded message ---------\n" +
          "From: Chanelle Self <chanelles@blackout.co.uk>\n" +
          "Date: Wed, 3 Jun 2026 at 15:41\n" +
          "Subject: Increased hours - 06/06/26 - 13:00 Excel.\n" +
          "To: tracy@spartancrew.co.uk <tracy@spartancrew.co.uk>\n" +
          "\n\n" +
          "Good afternoon Tracy,\n\n" +
          "The crew that I changed for 13:00 start time, could I increase to 9hours -\n" +
          "Saturday 6th June.\n\n" +
          "Kind regards\nChanelle\n",
      }),
      m({
        message_id: "f2",
        from: "bookings@spartancrew.co.uk",
        date_iso: "2026-06-03T16:06:12.000Z",
        subject: "Re: Increased hours - 06/06/26 - 13:00 Excel.",
        body: "Hi Chanelle,\n\nThat should be fine, I've changed the length of the shift to 9 hours.\n",
      }),
    ],
  };
  const { latest } = normalizeThread(forwarded);
  ok(latest.is_from_spartan === false, "the thread now acts on a client, not on us", latest.from);
  ok(latest.from === "chanelles@blackout.co.uk", "attributed to the real sender", latest.from);
  ok(/increase to 9hours/i.test(latest.body), "carrying her actual request", latest.body.slice(0, 60));
  ok(!/^From:/im.test(latest.body), "and not the forwarded header block", latest.body.slice(0, 60));
  ok(!/Forwarded message/i.test(latest.body), "nor the marker itself");
}

console.log("\n[7] the forward path cannot overreach either");
{
  // Forwarding our own mail on internally is not a client enquiry.
  const ours: HydratedThread = {
    thread_id: "t-fwd-self",
    messages: [m({
      message_id: "s1",
      body:
        "---------- Forwarded message ---------\n" +
        "From: Jake P <bookings@spartancrew.co.uk>\n" +
        "Date: Wed, 3 Jun 2026 at 15:41\n\n" +
        "Here is the updated quote for Saturday.\n",
    })],
  };
  ok(normalizeThread(ours).latest.is_from_spartan === true,
    "forwarding ourselves does not invent a client", normalizeThread(ours).latest.from);

  // A forward whose sender cannot be named is left alone rather than guessed at.
  const nameless: HydratedThread = {
    thread_id: "t-fwd-nameless",
    messages: [m({
      message_id: "s1",
      body: "---------- Forwarded message ---------\nDate: Wed, 3 Jun 2026\n\nCan you cover Saturday?\n",
    })],
  };
  ok(normalizeThread(nameless).latest.is_from_spartan === true, "no From: line, so nothing is fabricated");

  // A forward with nothing in it is not a request.
  const empty: HydratedThread = {
    thread_id: "t-fwd-empty",
    messages: [m({
      message_id: "s1",
      body: "---------- Forwarded message ---------\nFrom: Chanelle <chanelles@blackout.co.uk>\nDate: Wed\n\nok\n",
    })],
  };
  ok(normalizeThread(empty).latest.is_from_spartan === true, "a two-word forward is not an enquiry");

  // A thread that HAS a client message is untouched - the recovery is only for the
  // shape that is otherwise guaranteed to be judged on our own words.
  const hasClient: HydratedThread = {
    thread_id: "t-fwd-hasclient",
    messages: [
      m({ message_id: "c1", from: "chanelles@blackout.co.uk", is_from_spartan: false, body: "Can you cover Saturday 6th June, 4 crew?" }),
      m({ message_id: "s1", body: "---------- Forwarded message ---------\nFrom: Someone Else <other@elsewhere.com>\nDate: Wed\n\nUnrelated request about November.\n" }),
    ],
  };
  const { latest } = normalizeThread(hasClient);
  ok(latest.from === "chanelles@blackout.co.uk",
    "a real client message still wins over a forwarded one", latest.from);
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
