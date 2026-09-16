// ============================================================================
// Raw mail in, a thread out — the routing-rule intake, with no Gmail involved.
// ----------------------------------------------------------------------------
// The whole point of routing-rule intake is that nothing on the hot path holds a
// credential that a password change can kill (docs/CREDENTIAL-DURABILITY-PLAN.md).
// The cost of that is Gmail's `threadId`, which never arrives — a routing rule
// delivers MESSAGES. Everything downstream keys on a thread, so intake has to
// rebuild the grouping from `Message-ID`, `In-Reply-To` and `References`.
//
// scripts/score-header-threading.mjs measured whether that is even possible, by
// asking Gmail for its own grouping and the headers for the same 298 messages:
//
//   whole thread    1 of 40 split (2.5%), 0 merged
//   inbound only    3 of 39 split (7.7%), 0 merged
//
// Zero merges is the number that mattered. A split costs continuity and the
// identity rule recovers it downstream; a MERGE puts two jobs on one conversation
// and applies one booking's crew change to another. The rule that keeps merges at
// zero is asserted below and is the one thing here that must never be relaxed:
// JOIN ONLY TO A REFERENCE WE ACTUALLY HOLD.
//
// Everything in this file is offline and pure — the parser is a pure function and
// the thread resolver takes its lookup as an argument.
//
// Run: npx tsx test/mailInbound.ts
// ============================================================================
import { parseRfc822 } from "../app/lib/mail/rfc822";
import {
  normaliseMessageId,
  referenceIdsOf,
  mintThreadId,
  resolveThreadId,
} from "../app/lib/mail/threading";
import { extractRawMail } from "../app/lib/mail/providers";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const section = (s: string) => console.log(`\n${s}`);

const CRLF = (s: string) => s.replace(/\n/g, "\r\n");

// ---------------------------------------------------------------------------
// Fixtures. Real shapes: a folded header, an encoded subject, quoted-printable,
// a multipart/alternative, and a References chain.
// ---------------------------------------------------------------------------
const PLAIN = CRLF(`Message-ID: <root-1@client.example>
From: Jane Smith <jane@client.example>
To: bookings@spartancrew.co.uk
Subject: Crew for Friday
Date: Tue, 8 Sep 2026 10:04:11 +0100
Content-Type: text/plain; charset="utf-8"

Hi, we need 4 crew on Friday at the Barbican, 08:00 start.
Thanks,
Jane
`);

const REPLY = CRLF(`Message-ID: <reply-2@client.example>
In-Reply-To: <root-1@client.example>
References: <root-1@client.example>
From: Jane Smith <jane@client.example>
To: bookings@spartancrew.co.uk
Subject: Re: Crew for Friday
Date: Wed, 9 Sep 2026 09:00:00 +0100

Make that 6 crew please.
`);

const FOLDED = CRLF(`Message-ID: <fold-3@client.example>
References: <root-1@client.example>
\t<mid-a@spartancrew.co.uk>
 <mid-b@client.example>
Subject: =?UTF-8?B?Q3JldyBmb3Igw4ljb2xlIC0gU2F0dXJkYXk=?=
From: "Smith, Jane" <jane@client.example>
To: bookings@spartancrew.co.uk, ops@spartancrew.co.uk
Cc: finance@client.example
Date: Wed, 9 Sep 2026 11:00:00 +0100
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

Caf=C3=A9 shift, 6 crew, =C2=A314.50/hr. Long line that the sender wrapped =
using a soft break should rejoin.
`);

const MULTIPART = CRLF(`Message-ID: <multi-4@client.example>
From: ops@client.example
To: bookings@spartancrew.co.uk
Subject: Saturday
Date: Thu, 10 Sep 2026 08:00:00 +0100
Content-Type: multipart/alternative; boundary="B1"

--B1
Content-Type: text/plain; charset="utf-8"

The plain part, which is the one we want.
--B1
Content-Type: text/html; charset="utf-8"

<html><body><p>The HTML part.</p></body></html>
--B1--
`);

const NO_ID = CRLF(`From: nobody@client.example
To: bookings@spartancrew.co.uk
Subject: No identity
Date: Thu, 10 Sep 2026 08:00:00 +0100

A message with no Message-ID at all.
`);

// A second reply to the SAME parent nobody holds, from a different sender.
const SECOND_ORPHAN = CRLF(`Message-ID: <reply-3@client.example>
In-Reply-To: <never-seen@client.example>
From: someone@else.example
To: bookings@spartancrew.co.uk
Subject: Re: Something
Date: Wed, 9 Sep 2026 09:00:00 +0100

Another orphan replying to the same message nobody has.
`);

const ATTACHMENT_ONLY = CRLF(`Message-ID: <weird-9@client.example>
From: a@b.example
To: bookings@spartancrew.co.uk
Subject: Odd
Date: Thu, 10 Sep 2026 08:00:00 +0100
Content-Type: multipart/mixed; boundary="Z"

--Z
Content-Type: application/pdf
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--Z--
`);

// EVERY fixture must parse, or an assertion below can pass for the wrong reason. A
// fixture indented into a template literal turns its headers into continuation lines
// of the one above, which is a silently different message that still "passes" any
// assertion about two ids differing.
for (const [name, raw] of Object.entries({ PLAIN, REPLY, FOLDED, MULTIPART, SECOND_ORPHAN, ATTACHMENT_ONLY })) {
  const p = parseRfc822(raw);
  if (!p.message_id || !p.from || !p.subject) {
    console.log(`  FAIL  fixture ${name} does not parse — headers folded?`, JSON.stringify(p.message_id), p.from);
    fails++;
  }
}

// ---------------------------------------------------------------------------
section("[1] headers survive the wire");
// ---------------------------------------------------------------------------
{
  const p = parseRfc822(PLAIN);
  ok(p.message_id === "<root-1@client.example>", "Message-ID is read", p.message_id);
  ok(p.from === "jane@client.example", "From is reduced to a bare address", p.from);
  ok(p.from_name === "Jane Smith", "display name is kept separately", p.from_name);
  ok(p.to.length === 1 && p.to[0] === "bookings@spartancrew.co.uk", "To is a list of addresses");
  ok(p.subject === "Crew for Friday", "Subject is read", p.subject);
  ok(p.date_iso.startsWith("2026-09-08T09:04"), "Date becomes an ISO instant in UTC", p.date_iso);
  ok(/4 crew on Friday/.test(p.body), "the body is the body");
  ok(!/Message-ID/i.test(p.body), "headers are not in the body");
}

// ---------------------------------------------------------------------------
section("[2] the awkward mail that real senders actually send");
// ---------------------------------------------------------------------------
{
  const p = parseRfc822(FOLDED);
  // A folded References header is the normal case, not an edge case — three ids
  // over three lines is what a chain of any length looks like on the wire. Read it
  // one line at a time and threading silently sees only the first id.
  ok(p.references.length === 3, "a folded References header yields every id", String(p.references.length));
  ok(p.references[2] === "<mid-b@client.example>", "including the one on the last continuation line");
  ok(p.subject === "Crew for École - Saturday", "an RFC 2047 encoded subject is decoded", p.subject);
  ok(p.from === "jane@client.example", "a quoted display name containing a comma does not split the address", p.from);
  ok(p.to.length === 2, "two recipients are two addresses", String(p.to.length));
  ok(p.cc.length === 1 && p.cc[0] === "finance@client.example", "Cc is kept");
  ok(/Café shift/.test(p.body), "quoted-printable is decoded as UTF-8, not latin-1", p.body.slice(0, 20));
  ok(/£14\.50/.test(p.body), "a pound sign survives");
  ok(/soft break should rejoin/.test(p.body) && !/=\r?\n/.test(p.body), "a soft line break is removed");
}
{
  const p = parseRfc822(MULTIPART);
  ok(/plain part/.test(p.body), "multipart/alternative yields the text/plain part", p.body.trim().slice(0, 30));
  ok(!/<html>/.test(p.body), "and not the HTML one");
  ok(!/--B1/.test(p.body), "MIME boundaries are not left in the body");
}

// ---------------------------------------------------------------------------
section("[3] normalising an id, because senders disagree about brackets and case");
// ---------------------------------------------------------------------------
{
  ok(normaliseMessageId("<A@B.com>") === "<a@b.com>", "case-folded");
  ok(normaliseMessageId("a@b.com") === "<a@b.com>", "brackets added when absent");
  ok(normaliseMessageId("  <a@b.com>  ") === "<a@b.com>", "trimmed");
  ok(normaliseMessageId("") === "", "nothing stays nothing");
}

// ---------------------------------------------------------------------------
section("[4] the reference chain is read nearest-first");
// ---------------------------------------------------------------------------
{
  const p = parseRfc822(FOLDED);
  const refs = referenceIdsOf(p);
  // References runs oldest -> newest, so the NEAREST ancestor is last. Resolution
  // walks nearest first: if two ancestors somehow sit in different threads, the
  // closer one is the better answer and fusing them would be a merge.
  ok(refs[0] === "<mid-b@client.example>", "nearest ancestor first", refs[0]);
  ok(refs[refs.length - 1] === "<root-1@client.example>", "root last", refs[refs.length - 1]);

  const r = parseRfc822(REPLY);
  const rrefs = referenceIdsOf(r);
  ok(rrefs.length === 1, "an id in both In-Reply-To and References is listed once", String(rrefs.length));
}

async function main() {
  // ---------------------------------------------------------------------------
  section("[5] threading: join to what we hold, mint when we hold nothing");
  // ---------------------------------------------------------------------------
  {
    const held = new Map<string, string>([["<root-1@client.example>", "mail:abc123"]]);
    const lookup = async (ids: string[]) => {
      for (const id of ids) if (held.has(id)) return { id, thread_id: held.get(id)! };
      return null;
    };

    const root = await resolveThreadId(parseRfc822(PLAIN), async () => null);
    ok(!root.joined, "a first message joins nothing");
    ok(root.thread_id.startsWith("mail:"), "and gets a minted thread id", root.thread_id);

    const again = await resolveThreadId(parseRfc822(PLAIN), async () => null);
    ok(again.thread_id === root.thread_id, "minting is deterministic, so a re-delivery lands on the same thread");

    const reply = await resolveThreadId(parseRfc822(REPLY), lookup);
    ok(reply.joined, "a reply whose parent we hold joins it");
    ok(reply.thread_id === "mail:abc123", "onto the parent's thread", reply.thread_id);

    // THE RULE THAT KEEPS MERGES AT ZERO. A reply to a message we never received —
    // exactly what happens when a routing rule delivers inbound only and the client
    // replies to Spartan's own mail — must start its own thread, not build one
    // around an id nobody has. Two replies to the same absent parent would otherwise
    // fuse into one conversation, which is two jobs becoming one.
    const orphan = await resolveThreadId(parseRfc822(REPLY), async () => null);
    ok(!orphan.joined, "a reply to a message we do NOT hold joins nothing");
    ok(orphan.thread_id === mintThreadId("<reply-2@client.example>"),
       "and opens a thread keyed on ITSELF, never on the id it referenced", orphan.thread_id);

    const orphan2 = await resolveThreadId(parseRfc822(SECOND_ORPHAN), async () => null);
    ok(orphan2.thread_id !== orphan.thread_id,
       "two orphans replying to the SAME absent parent do not fuse — the merge that must never happen");
  }
  {
    // A message with no Message-ID has no identity to mint from. It still has to land
    // somewhere, and quietly dropping it would be data loss on the no-loss path.
    const p = parseRfc822(NO_ID);
    ok(p.message_id === "", "an absent Message-ID is absent, not invented");
    const r = await resolveThreadId(p, async () => null);
    ok(Boolean(r.thread_id), "it still gets a thread", r.thread_id);
    ok(!r.joined, "by itself");
    const r2 = await resolveThreadId(parseRfc822(NO_ID + "x"), async () => null);
    ok(r2.thread_id !== r.thread_id, "and two id-less messages are two threads, never one bucket");
  }

  // ---------------------------------------------------------------------------
  section("[6] providers: five shapes, one contract");
  // ---------------------------------------------------------------------------
  {
    // Raw MIME is the ONE contract because every provider can send it, and five
    // JSON dialects normalised by hand is five things to be wrong about.
    const post = (body: BodyInit, headers: Record<string, string>) =>
      new Request("https://x/api/mail-inbound", { method: "POST", body, headers });

    const cm = await extractRawMail(post(PLAIN, { "content-type": "message/rfc822" }));
    ok(cm?.raw === PLAIN, "message/rfc822 body is the mail itself");

    const sgForm = new FormData();
    sgForm.set("email", PLAIN);
    sgForm.set("to", "bookings@spartancrew.co.uk");
    const sg = await extractRawMail(new Request("https://x/", { method: "POST", body: sgForm }));
    ok(sg?.raw === PLAIN, "SendGrid Inbound Parse puts raw MIME in the `email` field");
    ok(!!sg?.envelope_to.includes("bookings@spartancrew.co.uk"), "and its envelope recipient is read");

    const mgForm = new FormData();
    mgForm.set("body-mime", PLAIN);
    mgForm.set("recipient", "bookings@spartancrew.co.uk");
    const mg = await extractRawMail(new Request("https://x/", { method: "POST", body: mgForm }));
    ok(mg?.raw === PLAIN, "Mailgun puts it in `body-mime`");

    const pm = await extractRawMail(post(JSON.stringify({ RawEmail: PLAIN, OriginalRecipient: "bookings@spartancrew.co.uk" }),
      { "content-type": "application/json" }));
    ok(pm?.raw === PLAIN, "Postmark puts it in `RawEmail`");
    ok(!!pm?.envelope_to.includes("bookings@spartancrew.co.uk"), "OriginalRecipient is the envelope recipient");

    const none = await extractRawMail(post(JSON.stringify({ subject: "hi" }), { "content-type": "application/json" }));
    ok(none === null, "a payload with no raw mail in it is refused, not guessed at");
  }

  // ---------------------------------------------------------------------------
  section("[7] a placeholder body never reaches the engine as mail");
  // ---------------------------------------------------------------------------
  {
    // The engine reads the newest message to decide what changed. An empty body from
    // a part we failed to decode reads as a client who said nothing, which the
    // identity rule treats as "inherit everything" — a silent wrong answer rather
    // than a loud failure. So an undecodable mail must be visibly undecodable.
    const p = parseRfc822(ATTACHMENT_ONLY);
    ok(p.body === "", "a mail with no text part yields an empty body, not the base64 of a PDF", JSON.stringify(p.body.slice(0, 20)));
    ok(p.attachments.length === 1 && p.attachments[0].content_type === "application/pdf",
       "the attachment is still noticed, so the caller can say so");
  }

  // ---------------------------------------------------------------------------
  section("[8] the secret travels in the URL, because the caller cannot send a header");
  // ---------------------------------------------------------------------------
  {
    const { authorizeMailWebhook } = await import("../app/lib/apiAuth");
    const SECRET = "s3cr3t-value-for-this-test";
    const before = { m: process.env.MAIL_INBOUND_SECRET, e: process.env.NODE_ENV, a: process.env.AUTH_REQUIRED };
    process.env.MAIL_INBOUND_SECRET = SECRET;

    const req = (url: string, headers: Record<string, string> = {}) =>
      new Request(url, { method: "POST", headers });
    const U = "https://x/api/mail-inbound";
    const basic = (u: string, p: string) => ({ authorization: "Basic " + Buffer.from(`${u}:${p}`).toString("base64") });

    ok(authorizeMailWebhook(req(`${U}?k=${SECRET}`)).ok, "a query parameter is accepted");
    ok(authorizeMailWebhook(req(U, basic("sendgrid", SECRET))).ok, "HTTP Basic is accepted, password half only");
    ok(authorizeMailWebhook(req(U, { "x-webhook-secret": SECRET })).ok, "our own header still works");
    ok(!authorizeMailWebhook(req(`${U}?k=wrong`)).ok, "a wrong query parameter is refused");
    ok(!authorizeMailWebhook(req(U, basic("x", "wrong"))).ok, "wrong Basic credentials are refused");
    ok(!authorizeMailWebhook(req(U)).ok, "presenting nothing is refused");
    ok(!authorizeMailWebhook(req(U, { authorization: "Basic !!!not base64" })).ok,
       "an undecodable Authorization header is a refusal, not a throw");

    // THE PREVIEW-DEPLOYMENT HOLE. A preview has no secret set but the production
    // database variables, so "unconfigured means allowed" put an enquiry-injecting
    // endpoint on every preview URL. This is the shared rule's job and the reason the
    // route must not write its own.
    delete process.env.MAIL_INBOUND_SECRET;
    const savedN8n = process.env.N8N_WEBHOOK_SECRET;
    delete process.env.N8N_WEBHOOK_SECRET;
    (process.env as Record<string, string>).NODE_ENV = "production";
    ok(!authorizeMailWebhook(req(U)).ok, "production with NO secret configured: refused");
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.AUTH_REQUIRED = "true";
    ok(!authorizeMailWebhook(req(U)).ok, "and refused with auth enforced, wherever it runs");

    if (before.m === undefined) delete process.env.MAIL_INBOUND_SECRET; else process.env.MAIL_INBOUND_SECRET = before.m;
    if (savedN8n === undefined) delete process.env.N8N_WEBHOOK_SECRET; else process.env.N8N_WEBHOOK_SECRET = savedN8n;
    if (before.a === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = before.a;
    (process.env as Record<string, string>).NODE_ENV = before.e ?? "test";
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}\n`);
  process.exit(fails ? 1 : 0);
}

main();
