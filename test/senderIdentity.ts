// ============================================================================
// Who the counterparty is, and whether their domain means anything.
// ----------------------------------------------------------------------------
// Cross-thread dedup gates on DOMAIN, not on the sender's address, so that the
// same client writing from a colleague's mailbox still matches. That only works
// if the domain recorded is the CLIENT's:
//
//   - Spartan's own domain appears in every thread, on our replies. Recording it
//     would make every thread match every other thread.
//   - A consumer mailbox is not an organisation. gmail.com identifies nobody, so
//     it must yield no domain at all rather than a domain that matches strangers.
//
// The email is still recorded in both cases - it is the fallback key when there
// is no usable domain.
//
// Run: npx tsx test/senderIdentity.ts
// ============================================================================
import { counterpartyIdentity } from "../app/lib/engine/identity";
import type { ThreadMessage } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const msg = (from: string, date_iso: string, body = "hello"): ThreadMessage => ({
  message_id: `<${from}-${date_iso}>`, from, to: [], date_iso, subject: "Crew", body,
  is_from_spartan: false,
});

console.log("\n[1] an organisational sender gives an email and a domain");
{
  const id = counterpartyIdentity([msg("liam.oconnell@eventful.co.uk", "2026-08-28T10:00:00Z")]);
  ok(id.email === "liam.oconnell@eventful.co.uk", "email kept", String(id.email));
  ok(id.domain === "eventful.co.uk", "domain extracted", String(id.domain));
}

console.log("\n[2] Spartan's own address is never the counterparty");
{
  const id = counterpartyIdentity([
    msg("liam.oconnell@eventful.co.uk", "2026-08-28T10:00:00Z"),
    msg("bookings@spartancrew.co.uk", "2026-08-28T11:00:00Z"),
  ]);
  ok(id.domain === "eventful.co.uk", "the client's domain, not ours", String(id.domain));
  ok(id.email === "liam.oconnell@eventful.co.uk", "and the client's address", String(id.email));
}

console.log("\n[3] a consumer mailbox yields no domain, but keeps the address");
{
  for (const addr of ["sam@gmail.com", "sam@hotmail.com", "sam@yahoo.co.uk", "sam@icloud.com"]) {
    const id = counterpartyIdentity([msg(addr, "2026-08-28T10:00:00Z")]);
    ok(id.domain === null, `${addr} gives no domain`, String(id.domain));
    ok(id.email === addr, `${addr} is still recorded`, String(id.email));
  }
}

console.log("\n[4] the NEWEST client message decides");
{
  const id = counterpartyIdentity([
    msg("old@previous.co.uk", "2026-08-01T10:00:00Z"),
    msg("new@current.co.uk", "2026-08-28T10:00:00Z"),
  ]);
  ok(id.domain === "current.co.uk", "most recent client sender wins", String(id.domain));
}

console.log("\n[5] a thread with only Spartan messages has no counterparty");
{
  const id = counterpartyIdentity([msg("bookings@spartancrew.co.uk", "2026-08-28T10:00:00Z")]);
  ok(id.email === null && id.domain === null, "nothing is invented", JSON.stringify(id));
}

console.log("\n[6] addresses are normalised, and rubbish yields nothing");
{
  ok(counterpartyIdentity([msg("  Liam <LIAM@Eventful.CO.UK>  ", "2026-08-28T10:00:00Z")]).domain === "eventful.co.uk",
    "case and display name stripped");
  ok(counterpartyIdentity([msg("not-an-address", "2026-08-28T10:00:00Z")]).domain === null,
    "a malformed sender gives no domain");
}

console.log("\n[7] machine mail is never the counterparty, even when it is newest");
{
  const id = counterpartyIdentity([
    msg("liam.oconnell@eventful.co.uk", "2026-08-27T09:00:00Z"),
    msg("notifications@onsinch.com", "2026-08-28T10:00:00Z", "Client created new order #15610"),
  ]);
  ok(id.domain === "eventful.co.uk", "the earlier real client message wins, not onsinch.com", String(id.domain));
  ok(id.email === "liam.oconnell@eventful.co.uk", "and its address, not the notifier's", String(id.email));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
