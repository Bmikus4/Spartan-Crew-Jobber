// ============================================================================
// Mail relayed by our info@ Google Group is stored under the client who wrote it.
// ----------------------------------------------------------------------------
// The group rewrites From to info@spartancrew.co.uk, so a Vivid booking for 6 crew read as
// Spartan's own mail on 10-09 and the rebuild skipped it as "not a client's email". The
// headers below are the real ones n8n carried for that message.
//
// Offline.  npx tsx test/groupSender.ts
// ============================================================================
import { messagesFromPayload } from "../app/lib/threadMessagesDb";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const msg = (over: Record<string, unknown>) => ({
  message_id: "1a1201b9256de248", from: "info@spartancrew.co.uk", to: ["info@spartancrew.co.uk"],
  date_iso: "2026-10-09T10:00:26.000Z", subject: "6x Crew Sunday/ Monday", body: "We need 6 local crew", is_from_spartan: true, ...over,
});
const one = (m: Record<string, unknown>) => messagesFromPayload({ thread_id: "t", messages: [m] })[0];
const relayed = { "x-google-group-id": "262608485704", "x-original-sender": "luke@vividbroadcast.co.uk", "reply-to": "Luke Elmer <luke@vividbroadcast.co.uk>" };

console.log("relayed by the group");
{
  const s = one(msg({ headers: relayed }));
  ok(s.from_address === "luke@vividbroadcast.co.uk", "stored under the client who wrote it", s.from_address);
  ok(s.is_from_spartan === false, "and not as Spartan's own mail");
}

console.log("not trusted");
{
  const s = one(msg({ headers: { "x-original-sender": "luke@vividbroadcast.co.uk" } }));
  ok(s.from_address === "info@spartancrew.co.uk" && s.is_from_spartan, "an original-sender header without the group's id changes nothing", s.from_address);
}
{
  const s = one(msg({ from: "someone@client.com", is_from_spartan: false, headers: { ...relayed, "x-original-sender": "other@else.com" } }));
  ok(s.from_address === "someone@client.com", "a message not from our address keeps its own sender", s.from_address);
}
{
  const s = one(msg({ headers: { ...relayed, "x-original-sender": "jake@spartancrew.co.uk" } }));
  ok(s.from_address === "info@spartancrew.co.uk" && s.is_from_spartan, "staff writing to the group stay Spartan's own mail", s.from_address);
}
{
  const s = one(msg({}));
  ok(s.from_address === "info@spartancrew.co.uk" && s.is_from_spartan, "control: no headers, unchanged", s.from_address);
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
