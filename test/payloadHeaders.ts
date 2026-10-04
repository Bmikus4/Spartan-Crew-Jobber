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
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
