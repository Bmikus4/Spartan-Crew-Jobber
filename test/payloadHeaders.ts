// ============================================================================
// SP-18 (engine half): an n8n message carrying reply-chain headers stores them.
// ----------------------------------------------------------------------------
// Live mail stored no rfc_message_id, In-Reply-To or References, so the reply chain was
// unreadable from the engine's own rows. n8n's "Build Engine Payload" node gets the three
// fields per message (a separate, approved n8n edit, D16); this side ships first and is
// inert until they arrive. Pure: messagesFromPayload only.
//
// Offline.  npx tsx test/payloadHeaders.ts
// ============================================================================
import { messagesFromPayload } from "../app/lib/threadMessagesDb";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const base = { message_id: "19a1", from: "pier@redbeast.co.uk", to: ["bookings@spartancrew.co.uk"], date_iso: "2026-10-05T09:00:00Z", subject: "Re: Crew", body: "ok" };

console.log("\n[1] headers present: all three are stored, normalised like the routing intake's");
{
  const [m] = messagesFromPayload({ thread_id: "t1", messages: [{ ...base,
    rfc_message_id: "<CAB123@mail.gmail.com>",
    in_reply_to: "<prev@spartancrew.co.uk>",
    references: "<first@redbeast.co.uk> <prev@spartancrew.co.uk>" }] });
  ok(!!m.rfc_message_id && /cab123@mail\.gmail\.com/i.test(m.rfc_message_id), "rfc_message_id", String(m.rfc_message_id));
  ok((m.in_reply_to ?? []).length === 1, "in_reply_to", JSON.stringify(m.in_reply_to));
  ok((m.reference_ids ?? []).length === 2, "references, both ids", JSON.stringify(m.reference_ids));
}

console.log("\n[2] headers not sent (today's payload): nothing is invented");
{
  const [m] = messagesFromPayload({ thread_id: "t1", messages: [base] });
  ok(m.rfc_message_id === undefined && m.in_reply_to === undefined && m.reference_ids === undefined,
    "all three absent, not empty", JSON.stringify({ r: m.rfc_message_id, i: m.in_reply_to, f: m.reference_ids }));
  ok(m.cc_addresses === undefined && m.attachment_names === undefined, "Cc and attachment names absent, not empty");
}

console.log("\n[3] Cc and attachment names are stored as sent (matcher plan, 10-22)");
{
  const [m] = messagesFromPayload({ thread_id: "t1", messages: [{ ...base,
    cc: ["Ann@Client.co.uk", "ops@client.co.uk"], attachments: ["PO 1244.pdf", { filename: "image001.png" }] }] });
  ok(JSON.stringify(m.cc_addresses) === JSON.stringify(["ann@client.co.uk", "ops@client.co.uk"]), "Cc, lower-cased", JSON.stringify(m.cc_addresses));
  ok(JSON.stringify(m.attachment_names) === JSON.stringify(["PO 1244.pdf", "image001.png"]), "names, as strings or {filename}", JSON.stringify(m.attachment_names));
  ok(JSON.stringify(m.to_addresses) === JSON.stringify(["bookings@spartancrew.co.uk"]), "to_addresses unchanged: Cc is not folded in", JSON.stringify(m.to_addresses));
  const [e] = messagesFromPayload({ thread_id: "t1", messages: [{ ...base, cc: [], attachments: [] }] });
  ok(Array.isArray(e.cc_addresses) && !e.cc_addresses.length && Array.isArray(e.attachment_names) && !e.attachment_names.length, "sent and empty stays an empty list, not absent");
}

console.log("\n[4] the chain inside the older builds' `headers` is read too");
{
  const [m] = messagesFromPayload({ thread_id: "t1", messages: [{ ...base,
    headers: { "in-reply-to": "<prev@spartancrew.co.uk>", references: "<first@redbeast.co.uk> <prev@spartancrew.co.uk>" } }] });
  ok((m.in_reply_to ?? []).length === 1, "in_reply_to from headers", JSON.stringify(m.in_reply_to));
  ok((m.reference_ids ?? []).length === 2, "references from headers", JSON.stringify(m.reference_ids));
  const [top] = messagesFromPayload({ thread_id: "t1", messages: [{ ...base, in_reply_to: "<top@x.co.uk>", headers: { "in-reply-to": "<inner@x.co.uk>" } }] });
  ok(/top@x/.test(String(top.in_reply_to)), "a top-level field wins over the headers copy", JSON.stringify(top.in_reply_to));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
