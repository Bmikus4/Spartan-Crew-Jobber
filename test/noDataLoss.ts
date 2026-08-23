// ============================================================================
// Mail that arrives in a shape we do not understand is still kept.
// ----------------------------------------------------------------------------
// /api/n8n-inbound is built on a no-data-loss guarantee, and the restructure
// nearly broke it. The mail moved to thread_messages and the wrapper to
// `envelope`, which is the payload minus `messages` — a correct split ONLY when
// the messages were understood. A payload carrying mail under a thread-id key we
// do not recognise extracts to nothing and has its `messages` stripped, so the
// mail vanished: the exact case the "store it so the contract can be aligned"
// branch exists to catch.
//
// This pins the fallback. It is the test that should have existed before the
// payload column stopped being written.
//
// Runs against the real database with tagged rows, and removes them.
// Run: npx tsx test/noDataLoss.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { captureInboundRaw } from "../app/lib/inboundRawDb";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `nodataloss-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

async function main() {
  // 1. A shape we understand: mail goes to thread_messages, payload stays empty.
  const known = {
    thread_id: `${TAG}-known`,
    n8n: { verdict: { gate: "priceable" } },
    messages: [{ message_id: `${TAG}-k1`, from: "a@b.com", date_iso: "2026-08-01T09:00:00Z",
                 subject: "Crew", body: "Six riggers Friday." }],
  };
  await captureInboundRaw(known, "test");
  const [k] = (await sql`
    SELECT payload, envelope, message_ids FROM inbound_raw
    WHERE thread_id = ${TAG + "-known"} ORDER BY id DESC LIMIT 1`) as any[];
  ok(k.payload === null, "an understood payload is not duplicated into the payload column");
  ok((k.message_ids || []).length === 1, "its message is recorded on the delivery");
  ok(k.envelope?.n8n?.verdict?.gate === "priceable", "and the envelope keeps the verdict");

  // 2. A shape we do NOT understand, carrying mail. Nothing may be lost.
  const odd: any = {
    conversation: `${TAG}-odd`,              // not a thread-id key coerceThread knows
    messages: [{ message_id: `${TAG}-o1`, from: "c@d.com",
                 subject: "Crew for Saturday", body: "We need eight on Saturday." }],
  };
  const cap = await captureInboundRaw(odd, "test");
  ok(cap.messages_stored === 0, "nothing could be extracted from it", String(cap.messages_stored));
  const [o] = (await sql`
    SELECT payload, envelope FROM inbound_raw WHERE dedup_key = ${cap.dedup_key}`) as any[];
  ok(!!o, "the delivery was still recorded");
  ok(o.payload !== null, "the whole payload was kept verbatim");
  ok(JSON.stringify(o.payload).includes("eight on Saturday"),
     "and the mail inside it survived");
  ok(o.envelope?.messages === undefined, "the envelope still excludes the messages");

  await sql`DELETE FROM inbound_raw WHERE thread_id = ${TAG + "-known"}`;
  await sql`DELETE FROM inbound_raw WHERE dedup_key = ${cap.dedup_key}`;
  await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG + "-known"}`;
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}
main();
