// ============================================================================
// A message is stored once, however many times its thread is delivered.
// ----------------------------------------------------------------------------
// n8n POSTs the FULL hydrated thread on every new message, so a thread of five
// messages arrives five times carrying 1, 2, 3, 4 and 5 messages. Stored verbatim
// that is 15 message-copies for 5 messages, and on the live database it came to
// 6,644 copies of 1,354 messages. This asserts the fix: re-delivering a thread
// inserts only what is new.
//
// Runs against the real database with tagged rows, and removes them.
// Run: npx tsx test/threadMessages.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { messagesFromPayload, storeThreadMessages, rebuildThread } from "../app/lib/threadMessagesDb";
import { captureInboundRaw } from "../app/lib/inboundRawDb";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `msgtest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const msg = (n: number) => ({
  message_id: `${TAG}-m${n}`,
  from: `client${n} <c${n}@example.com>`,
  to: ["bookings@spartancrew.co.uk"],
  date_iso: `2026-08-0${n}T10:00:00Z`,
  subject: "Crew for Friday",
  body: `body of message ${n} `.repeat(20),
});
const thread = (upTo: number) => ({
  thread_id: `${TAG}-t`,
  messages: Array.from({ length: upTo }, (_, i) => msg(i + 1)),
});

async function main() {
  console.log("\nmessagesFromPayload is pure and total");
  ok(messagesFromPayload(null).length === 0, "null payload yields nothing");
  ok(messagesFromPayload({ messages: [] }).length === 0, "empty thread yields nothing");
  ok(messagesFromPayload(thread(3)).length === 3, "a thread of three yields three");
  ok(messagesFromPayload(thread(3))[0].from_address === "c1@example.com",
     "the display name is stripped from the address");
  ok(messagesFromPayload({ thread_id: "x", messages: [{ ...msg(1), message_id: "" }] }).length === 0,
     "a message with no id is not storable");

  console.log("\nre-delivery inserts only what is new");
  const a = await storeThreadMessages(thread(1));
  ok(a.inserted === 1, "first delivery inserts one", JSON.stringify(a));
  const b = await storeThreadMessages(thread(3));
  ok(b.inserted === 2, "second delivery of three inserts only the two new", JSON.stringify(b));
  const c = await storeThreadMessages(thread(3));
  ok(c.inserted === 0, "an exact re-delivery inserts nothing", JSON.stringify(c));

  const [{ n }] = (await sql`
    SELECT count(*)::int n FROM thread_messages WHERE thread_id = ${TAG + "-t"}`) as { n: number }[];
  ok(n === 3, "three messages stored for a thread delivered three times", String(n));

  console.log("\nthe thread rebuilds into the shape coerceThread accepts");
  const rebuilt = await rebuildThread(`${TAG}-t`);
  ok(!!rebuilt, "a stored thread rebuilds");
  ok(rebuilt!.messages.length === 3, "with all three messages", String(rebuilt!.messages.length));
  ok(rebuilt!.messages[0].date_iso < rebuilt!.messages[2].date_iso, "in date order");
  ok((await rebuildThread(`${TAG}-nope`)) === null, "an unknown thread rebuilds to null");

  console.log("\nthe bodies leave the ledger row; the envelope stays");
  const enveloped = { ...thread(5), n8n: { verdict: { from: "c@example.com", gate: "priceable" } } };
  const cap = await captureInboundRaw(enveloped, "test");
  ok(cap.ok, "capture succeeded", JSON.stringify(cap));
  ok(cap.messages_stored === 2, "the two new messages are the only ones stored", String(cap.messages_stored));
  const [row] = (await sql`
    SELECT payload IS NULL AS no_payload, envelope FROM inbound_raw
    WHERE thread_id = ${TAG + "-t"} ORDER BY id DESC LIMIT 1`) as {
      no_payload: boolean; envelope: Record<string, any> | null }[];
  ok(row.no_payload, "the row carries no payload");
  ok(row.envelope?.n8n?.verdict?.gate === "priceable",
     "but the n8n verdict survived", JSON.stringify(row.envelope?.n8n));
  ok(row.envelope?.messages === undefined, "and the bodies are not duplicated into it");
  const [{ n2 }] = (await sql`
    SELECT count(*)::int n2 FROM thread_messages WHERE thread_id = ${TAG + "-t"}`) as { n2: number }[];
  ok(n2 === 5, "all five messages are stored", String(n2));

  await sql`DELETE FROM inbound_raw WHERE thread_id = ${TAG + "-t"}`;
  await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG + "-t"}`;
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}
main();
