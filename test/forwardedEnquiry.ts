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

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
