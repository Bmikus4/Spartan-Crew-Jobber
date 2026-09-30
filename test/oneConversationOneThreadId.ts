// ============================================================================
// The same Gmail message is the same row, whichever route read it.
// ----------------------------------------------------------------------------
// Every historical row was written by the n8n intake, which keys a message by its
// Gmail id and a thread by Gmail's bare threadId: 4,236 of 4,239 thread_messages rows
// and 749/749 conversation_state rows, measured 2026-09-29. The poller used to store
// `gmail:<threadId>` and the RFC Message-ID instead, so the first reply it read in an
// existing conversation opened a thread with no state and no order link, and a
// message both routes read was stored twice.
//
// The RFC Message-ID is still kept, in its own column, because /api/mail-inbound
// threads by In-Reply-To/References and has nothing else to join on.
//
// Run: npx tsx test/oneConversationOneThreadId.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { messagesFromPayload, rowFromGmail } from "../app/lib/threadMessagesDb";
import { parseRfc822 } from "../app/lib/mail/rfc822";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const GMAIL_ID = "19ff0292d9c8a86d";
const GMAIL_THREAD = "19ff0292d9c8a86c";
const RFC_ID = "<CAF=abc123@mail.gmail.com>";

const RAW = [
  "From: Jo Bloggs <jo@wall-to-wall.example>",
  "To: bookings@spartancrew.co.uk",
  "Subject: Re: 3 x Crew 19th/20th September",
  "Date: Fri, 18 Sep 2026 10:00:00 +0100",
  `Message-ID: ${RFC_ID}`,
  "In-Reply-To: <spartan-1@spartancrew.co.uk>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Can you make it 8?",
].join("\r\n");

// What n8n posted for this message: Gmail's ids, no RFC header.
const N8N = {
  thread_id: GMAIL_THREAD,
  messages: [{
    id: GMAIL_ID,
    from: "Jo Bloggs <jo@wall-to-wall.example>",
    to: ["bookings@spartancrew.co.uk"],
    date_iso: "2026-09-18T09:00:00.000Z",
    subject: "Re: 3 x Crew 19th/20th September",
    body: "Can you make it 8?",
  }],
};

console.log("\n[1] the poller and n8n give the same email the same keys");
{
  const viaN8n = messagesFromPayload(N8N)[0];
  const viaPoll = rowFromGmail(GMAIL_ID, GMAIL_THREAD, parseRfc822(RAW), ["INBOX"]);
  ok(viaPoll.message_id === viaN8n.message_id, "one message id", `${viaPoll.message_id} vs ${viaN8n.message_id}`);
  ok(viaPoll.thread_id === viaN8n.thread_id, "one thread id", `${viaPoll.thread_id} vs ${viaN8n.thread_id}`);
  ok(viaPoll.thread_id === GMAIL_THREAD, "the thread id is Gmail's, unprefixed", viaPoll.thread_id);
}

console.log("\n[2] the RFC Message-ID is kept beside it, for header threading");
{
  const viaPoll = rowFromGmail(GMAIL_ID, GMAIL_THREAD, parseRfc822(RAW), []);
  ok(viaPoll.rfc_message_id === RFC_ID.toLowerCase(), "rfc_message_id carries the parsed header", String(viaPoll.rfc_message_id));
  const noHeader = rowFromGmail(GMAIL_ID, GMAIL_THREAD, parseRfc822(RAW.replace(/^Message-ID:.*\r\n/m, "")), []);
  ok(noHeader.rfc_message_id === null, "no header is null, not an empty string a UNIQUE index would collide on", String(noHeader.rfc_message_id));
  // The reply chain, which the resolver reads as strong evidence (design §9.2). Kept as
  // parsed: normalised, angle-bracketed, nearest ancestor order untouched.
  ok(JSON.stringify(viaPoll.in_reply_to) === JSON.stringify(["<spartan-1@spartancrew.co.uk>"]), "In-Reply-To is kept", JSON.stringify(viaPoll.in_reply_to));
  ok(Array.isArray(viaPoll.reference_ids), "References is kept, empty when absent", JSON.stringify(viaPoll.reference_ids));
}

console.log("\n[3] the labels still reach the draft guard");
{
  const r = rowFromGmail(GMAIL_ID, GMAIL_THREAD, parseRfc822(RAW), ["DRAFT"]);
  ok(Array.isArray(r.labelIds) && r.labelIds.includes("DRAFT"), "labelIds carried", JSON.stringify(r.labelIds));
}

console.log("\n[4] both live routes use the rule rather than minting their own");
{
  // A route that builds its row by hand is how the prefix got in. Pinned in source so
  // a later tidy-up cannot put it back without this failing.
  const poll = src("app/api/mail-poll/route.ts");
  ok(poll.includes("rowFromGmail("), "mail-poll builds its row with rowFromGmail");
  ok(!/`gmail:\$\{/.test(poll), "mail-poll mints no gmail:-prefixed id");
  const inbound = src("app/api/mail-inbound/route.ts");
  ok(inbound.includes("rfc_message_id"), "mail-inbound stores the RFC id in its own column too");
  ok(inbound.includes("in_reply_to") && inbound.includes("reference_ids"), "and the reply chain");
  const db = src("app/lib/threadMessagesDb.ts");
  ok(!/ON CONFLICT \(message_id\) DO NOTHING/.test(db),
    "inserts yield on ANY unique key, so a message held under one key is not stored again under the other");
  ok(/rfc_message_id = ANY/.test(db), "header threading looks up the RFC column as well as message_id");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
