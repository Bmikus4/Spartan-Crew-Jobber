// ============================================================================
// The auto-reply body rule must not swallow a real request.
// ----------------------------------------------------------------------------
// isMachineMessage is the most aggressive rejection in the system: it is decided
// before the model runs, so nothing downstream can rescue a message it catches.
// That is right for OnSinch's notifier and for a genuine out-of-office.
//
// Two of its three tests are safe, because they key on shape:
//   - a machine local-part (no-reply@, mailer-daemon@, …) or a machine domain
//   - a subject that STARTS with "Out of Office" / "Automatic reply" / …
//
// The third is an unanchored substring search for phrases like "out of the
// office" over the first 600 characters of the BODY. A client can write that
// sentence while asking for crew — "our manager is out of the office this week,
// so deal with me: we need 6 crew on the 12th" — and the whole enquiry is then
// dropped before any classifier sees it.
//
// Scanned against the live corpus this had happened 0 times in 252 messages, so
// this is a guard against a real shape rather than a fix for an observed loss.
// It is worth having because the trade is lopsided: the guard costs nothing, and
// the failure costs a booking.
//
// Run: npx tsx test/autoReply.ts
// ============================================================================
import { isMachineMessage, isAutoReply, isMachineSender } from "../app/lib/engine/normalize";
import type { ThreadMessage } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const msg = (o: Partial<ThreadMessage>): ThreadMessage => ({
  message_id: "m", from: "someone@client.com", to: ["bookings@spartancrew.co.uk"],
  date_iso: "2026-08-03T09:00:00.000Z", subject: "", body: "", is_from_spartan: false, ...o,
});

console.log("\n[1] a REAL out-of-office is still machine mail (the live case)");
{
  // Verbatim shape of thread 19fc817314b0601e.
  const m = msg({
    from: "mike@wearefamilylondon.com",
    subject: "Out of Office - Back Wednesday 5th August Re: 10th & 11th August",
    body: "Hello, I am currently out of office and have no access to email. For any urgent assistance please contact ash@wearefamilylondon.com For anything else, i will reply upon my return. Kind regards Mike",
  });
  ok(isMachineMessage(m), "still caught — the SUBJECT says out of office");
}

console.log("\n[2] an enquiry that merely MENTIONS the office being empty is not machine mail");
{
  const m = msg({
    from: "ops@bigevents.com",
    subject: "Crew for 12 August - ExCeL",
    body: "Hi, our project manager is out of the office this week so please deal with me directly. We need 6 crew at ExCeL London on 12 August, 08:00-18:00. Can you confirm availability?",
  });
  ok(!isMachineMessage(m), "NOT machine mail — it is a booking request");
  ok(!isAutoReply(m.subject, m.body), "the body rule stands down when crew is requested");
}
{
  const m = msg({
    from: "sarah@client.co.uk",
    subject: "Booking - 3 crew Thursday",
    body: "I will be away from the office on Thursday but the job goes ahead: 3 crew at Olympia, 9am start.",
  });
  ok(!isMachineMessage(m), "'away from the office' plus a booking is a booking");
}

console.log("\n[3] an out-of-office with no request is still caught by the body alone");
{
  const m = msg({
    from: "helen@imagdisplays.co.uk",
    subject: "Re: Quote enquiry",   // subject gives nothing away
    body: "Thank you for your email. I am currently on annual leave and will not be checking emails until 11 August. Kind regards, Helen",
  });
  ok(isMachineMessage(m), "caught — nothing is being asked for");
}

console.log("\n[4] sender-shape rules are untouched by any of this");
{
  ok(isMachineSender("no-reply@sinch.cz"), "no-reply@ local part");
  ok(isMachineSender("anything@onsinch.com"), "machine domain");
  ok(isMachineSender("mailer-daemon@somewhere.net"), "mailer-daemon");
  ok(!isMachineSender("mike@wearefamilylondon.com"), "a named person is not a machine sender");
  // A notifier that also describes a booking must STILL be machine mail — this is
  // the expensive one, it reads as a perfect enquiry.
  const notifier = msg({
    from: "no-reply@sinch.cz",
    subject: "Client created new order",
    body: "Just Smile Ltd created an order: 4 crew at The Londoner Hotel on 2026-08-10, 09:00-13:00.",
  });
  ok(isMachineMessage(notifier), "OnSinch's notifier stays machine mail even describing crew");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
