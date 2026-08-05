// ============================================================================
// Triage: what it refuses to pay for, and what it must never throw away.
// ----------------------------------------------------------------------------
// The mailbox is about to deliver everything, so this filter stands between the inbox
// and the model. It is the only place in the system where being wrong is asymmetric in
// a way that matters: a false skip costs a booking, a false admit costs $0.019.
//
// So the tests that count are the RESCUES — a parked sender, a newsletter address, a
// bulk-flagged message that nonetheless contains a dated crew request must all reach
// the model. Anything less and this file is a way to lose work cheaply.
//
// Subjects and senders below are taken from the real stream (inbound_raw, last 7 days)
// and from the corpus. Fixtures only: no database, no model, no network.
// ============================================================================
import { triage, looksLikeRealRequest, bulkFromHeaders, decisionBinds, triageModeFromEnv } from "../app/lib/engine/triage";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const msg = (o: Partial<Parameters<typeof triage>[0]>) => ({
  from: "kajaal@wearefamilylondon.com", subject: "Crew request", body: "Hi, can you cover 6 crew on 12 September?",
  ...o,
} as Parameters<typeof triage>[0]);

console.log("triage");

async function main() {

// ------------------------------------------------------------------ skips
{
  const r = await triage(msg({ from: "bookings@spartancrew.co.uk", is_from_spartan: true }));
  ok(r.verdict === "skip" && r.tier === "own-mail", "our own outbound is skipped", r.tier);
  ok(r.reviewable === false, "and is not worth a human's queue");
}
{
  const r = await triage(msg({ from: "no-reply@sinch.cz", subject: "Client created new order", body: "A new order was created for Event Concept on 12 Sept with 6 crew." }));
  ok(r.verdict === "skip" && r.tier === "machine-sender", "OnSinch's own notifier is skipped", r.tier);
}
{
  // THE ONE THAT MUST NOT BE RESCUED. The notifier describes a real booking in real
  // detail, so a content rule would admit it and the engine would re-book an existing job.
  const r = await triage(msg({
    from: "no-reply@sinch.cz",
    subject: "Client created new order",
    body: "Event Concept booked 6 crew at Tobacco Dock on 12 September, 09:00 - 16:00. Can you confirm?",
  }));
  ok(r.verdict === "skip", "a machine notification is skipped EVEN when it reads like a perfect enquiry", r.tier);
  ok(r.tier === "machine-sender", "by sender shape, not by content", r.tier);
}
{
  const r = await triage(msg({ subject: "Automatic reply: Crew for Tomorrow", body: "I am out of the office until Monday." }));
  ok(r.verdict === "skip" && r.tier === "auto-reply", "an out-of-office is skipped", r.tier);
}
{
  const r = await triage(msg({ subject: "Delivery Status Notification (Failure)", body: "Your message could not be delivered." }));
  ok(r.verdict === "skip" && r.tier === "auto-reply", "a bounce is skipped", r.tier);
}
{
  const r = await triage(msg({ from: "messaging-service@post.xero.com", subject: "Payment has been made by Blackout Limited", body: "A payment of GBP 7,650.60 has been made." }));
  ok(r.verdict === "skip", "Xero payment mail is skipped", r.tier);
  // messaging-service@ is an UNREPLIABLE address, not merely a vendor domain, so this is
  // the non-reviewable tier — there is no human behind it to put in a review queue.
  ok(r.tier === "machine-sender" && r.reviewable === false,
     "and as an unrepliable address, not a reviewable domain guess", `${r.tier}/${r.reviewable}`);
}
{
  const r = await triage(msg({ from: "a@b.com", body: "   " }));
  ok(r.verdict === "skip" && r.tier === "no-content", "an empty body is skipped", r.tier);
}

// ------------------------------------------------------- bulk, by its own admission
{
  ok(bulkFromHeaders({ "List-Unsubscribe": "<https://x/u>" }) === "list-unsubscribe", "List-Unsubscribe is detected");
  ok(bulkFromHeaders({ Precedence: "bulk" })?.includes("precedence") === true, "Precedence: bulk is detected");
  ok(bulkFromHeaders({ "Auto-Submitted": "auto-generated" })?.includes("auto-submitted") === true, "Auto-Submitted is detected");
  ok(bulkFromHeaders({ "Auto-Submitted": "no" }) === null, "Auto-Submitted: no is NOT bulk");
  ok(bulkFromHeaders({ "X-Spam-Flag": "YES" }) === "x-spam-flag: yes", "X-Spam-Flag is detected");
  ok(bulkFromHeaders({ Subject: "hello" }) === null, "an ordinary header set is not bulk");
  ok(bulkFromHeaders(undefined) === null, "no headers means no verdict, not a false positive");
}
{
  const r = await triage(msg({
    subject: "Event industry news, August", body: "Read our roundup. Unsubscribe here.",
    headers: { "List-Unsubscribe": "<https://x/u>" },
  }));
  ok(r.verdict === "skip" && r.tier === "bulk-header", "a newsletter is skipped on its header", r.tier);
}
{
  // No headers available (today's payload): the body fallback carries it.
  const r = await triage(msg({ subject: "Our August newsletter", body: "Latest news from us. Click to unsubscribe or manage your preferences." }));
  ok(r.verdict === "skip" && r.tier === "bulk-body", "without headers, body markers still catch a newsletter", r.tier);
}

// ==================================================================
// THE RESCUES. Every one of these is a booking that must not be lost.
// ==================================================================
{
  const r = await triage(msg({
    subject: "Crew request", body: "Can you cover 6 crew on 12 September at Tobacco Dock?",
    headers: { "List-Unsubscribe": "<https://x/u>" },
  }));
  ok(r.verdict === "admit", "a DATED CREW REQUEST is admitted even when flagged bulk", r.tier);
  ok(r.tier === "admit-request", "and says why it was rescued", r.tier);
}
{
  // A HUMAN on a vendor domain. The domain rule is a guess and must yield to a real request.
  const r = await triage(msg({ from: "accounts@xero.com", subject: "Crew needed", body: "Please send 4 crew on 19 September, 08:00-17:00." }));
  ok(r.verdict === "admit", "a real request from a vendor DOMAIN is still admitted", r.tier);
}
{
  // ...but ordinary vendor traffic from that same domain is skipped, and reviewable.
  const r = await triage(msg({ from: "accounts@xero.com", subject: "Your invoice", body: "Your subscription invoice is ready to view." }));
  ok(r.verdict === "skip" && r.tier === "vendor-domain", "vendor traffic is skipped as a domain guess", r.tier);
  ok(r.reviewable === true, "and a human can overturn a domain rule");
}
{
  const r = await triage(msg({ from: "invites@linkedin.com", subject: "You have 3 new invitations", body: "See who wants to connect." }));
  ok(r.verdict === "skip", "LinkedIn noise is skipped", r.tier);
}
{
  const parked = async () => "parked" as const;
  const r = await triage(msg({ subject: "Crew request", body: "Can you cover 8 crew on 3 October?" }), { senderVerdict: parked });
  ok(r.verdict === "admit", "a PARKED sender writing a real request is admitted — the ledger has no veto", r.tier);
}
{
  const parked = async () => "parked" as const;
  const r = await triage(msg({ subject: "checking in", body: "Just seeing how things are going." }), { senderVerdict: parked });
  ok(r.verdict === "skip" && r.tier === "sender-parked", "but small talk from a parked sender is skipped", r.tier);
  ok(r.reviewable === true, "and is reviewable, because it is a judgement about a person");
}
{
  const trusted = async () => "trusted" as const;
  const r = await triage(msg({ subject: "checking in", body: "Just seeing how things are going." }), { senderVerdict: trusted });
  ok(r.verdict === "admit", "small talk from a client who HAS booked is still read", r.tier);
}
{
  // A ledger outage must not filter mail.
  const broken = async () => { throw new Error("ledger down"); };
  const r = await triage(msg({ subject: "checking in", body: "hello" }), { senderVerdict: broken as never });
  ok(r.verdict === "admit", "a broken ledger admits rather than skips", r.tier);
}

// -------------------------------------------------- the rescue predicate itself
{
  ok(looksLikeRealRequest("Crew request", "6 crew on 12 September") === true, "date + crew reads as a request");
  ok(looksLikeRealRequest("Quote please", "Can you quote 4 crew?") === true, "crew + ask reads as a request");
  ok(looksLikeRealRequest("Newsletter", "Our September roundup of industry news") === false,
     "a month name alone is NOT a request");
  ok(looksLikeRealRequest("Thanks", "Great, thanks for your help") === false, "gratitude is not a request");
  ok(looksLikeRealRequest("Invoice 4592", "Payment of GBP 7,650.60 has been made") === false,
     "an invoice is not a request");
}

// ---------------------------------------- ordinary client mail is admitted untouched
{
  for (const s of ["Crew request", "Quote please", "Website booking form", "Last min booking", "Changes", "10th & 11th August"]) {
    const r = await triage(msg({ subject: s, body: "Hi, we need crew for an event next week. Can you help?" }));
    ok(r.verdict === "admit", `real subject admitted: "${s}"`, r.tier);
  }
}


// ==================================================================
// SHADOW MODE: an unproven filter must be scored, not trusted.
// ==================================================================
{
  const skip = (tier: string) => ({ verdict: "skip" as const, tier, reason: "r", reviewable: true });

  ok(decisionBinds(skip("own-mail"), "shadow") === true,
     "own-mail binds even in shadow - reading our own reply is a loop, not rigour");
  ok(decisionBinds(skip("machine-sender"), "shadow") === true,
     "an unrepliable address binds even in shadow - the OnSinch notifier re-books real jobs");
  ok(decisionBinds(skip("no-content"), "shadow") === true, "an empty body binds even in shadow");

  ok(decisionBinds(skip("sender-parked"), "shadow") === false,
     "a PARKED sender does NOT bind in shadow - that judgement has to earn its keep");
  ok(decisionBinds(skip("bulk-body"), "shadow") === false, "a bulk guess does not bind in shadow");
  ok(decisionBinds(skip("vendor-domain"), "shadow") === false, "a domain guess does not bind in shadow");

  ok(decisionBinds(skip("sender-parked"), "enforce") === true, "in enforce, a parked sender does bind");
  ok(decisionBinds({ verdict: "admit", tier: "admit", reason: "", reviewable: false }, "enforce") === false,
     "an admit never binds - there is nothing to stop");

  const before = process.env.SPARTAN_TRIAGE_MODE;
  delete process.env.SPARTAN_TRIAGE_MODE;
  ok(triageModeFromEnv() === "shadow", "SHADOW is the default - the filter starts on probation");
  process.env.SPARTAN_TRIAGE_MODE = "enforce";
  ok(triageModeFromEnv() === "enforce", "and enforce is opt-in");
  if (before === undefined) delete process.env.SPARTAN_TRIAGE_MODE; else process.env.SPARTAN_TRIAGE_MODE = before;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
