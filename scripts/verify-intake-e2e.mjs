// End-to-end proof that the restructured intake works in PRODUCTION.
//
// The mail moved out of inbound_raw.payload into thread_messages, and the wrapper into a
// new `envelope` column. This posts to the live /api/n8n-inbound and then reads the live
// database to check what actually landed.
//
// IT COSTS NOTHING TO RUN. The payload it sends deliberately does NOT satisfy the intake
// contract, so coerceThread returns null and the route answers 200 before handleThread is
// ever called — no model call, no OnSinch call, no Gmail draft, no email. That is also the
// most important case to test, because it is the one the restructure nearly broke: mail in
// an unrecognised shape used to be stored whole, and for a while was silently dropped.
//
// Cleans up the rows it writes.
//
//   node scripts/verify-intake-e2e.mjs
//   node scripts/verify-intake-e2e.mjs http://localhost:3000
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const BASE = (process.argv[2] || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const sql = neon(requireEnv("DATABASE_URL"));
const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();

let fails = 0;
const ok = (cond, label, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

console.log(`verifying ${BASE}\n`);

// ── the live database is in the shape the restructure left it ────────────────
const [s] = await sql`
  SELECT (SELECT count(*)::int FROM inbound_raw)                          AS deliveries,
         (SELECT count(*)::int FROM inbound_raw WHERE payload IS NOT NULL) AS with_payload,
         (SELECT count(*)::int FROM inbound_raw WHERE envelope IS NULL)    AS no_envelope,
         (SELECT count(*)::int FROM thread_messages)                       AS messages,
         (SELECT count(*)::int FROM tickets)                               AS tickets,
         (SELECT count(*)::int FROM sweep_threads)                         AS swept,
         (SELECT count(*)::int FROM sweep_threads WHERE payload IS NOT NULL) AS swept_payload,
         pg_size_pretty(pg_database_size(current_database()))              AS size`;
console.log("live database");
console.log(`        ${s.size}, ${s.deliveries} deliveries, ${s.messages} messages, ${s.tickets} tickets`);
ok(s.messages > 0, "messages are stored individually", `${s.messages}`);
ok(s.no_envelope === 0, "every delivery carries an envelope", `${s.no_envelope} without`);
ok(s.swept_payload === 0, "the research corpus is out of the database", `${s.swept} header rows kept`);

// A delivery holding a payload is not wrong — it is the no-data-loss fallback — but it
// should be rare. Report rather than fail, so a spike is visible.
console.log(`        deliveries holding a raw payload (unparsed fallback): ${s.with_payload}`);

// ── each message is stored once, not once per delivery ───────────────────────
const [d] = await sql`
  SELECT count(*)::int deliveries, coalesce(sum(array_length(message_ids,1)),0)::int copies
  FROM inbound_raw WHERE message_ids IS NOT NULL`;
const ratio = s.messages ? (d.copies / s.messages) : 0;
console.log("\nduplication");
console.log(`        ${d.copies} message-references across ${d.deliveries} deliveries, ${s.messages} distinct messages`);
ok(ratio > 1, "deliveries still re-send whole threads, as n8n always did", `${ratio.toFixed(1)}x`);
ok(s.messages < d.copies, "but each message is STORED once", `${s.messages} rows for ${d.copies} references`);

// ── the live route: mail in a shape we do not understand must survive ────────
console.log(`\nPOST ${BASE}/api/n8n-inbound  (unrecognised shape — no model call)`);
const marker = `e2e-verify-${Date.now()}`;
const odd = {
  conversation: marker,                     // not a thread-id key coerceThread knows
  n8n: { verdict: { gate: "e2e-probe" } },
  messages: [{ message_id: `${marker}-1`, from: "verify@example.com",
               subject: "end to end check", body: `unique-body-${marker}` }],
};
const res = await fetch(`${BASE}/api/n8n-inbound`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(SECRET ? { "x-webhook-secret": SECRET } : {}) },
  body: JSON.stringify(odd),
});
const body = await res.json().catch(() => ({}));
ok(res.status === 200, "the route accepted it", `HTTP ${res.status}`);
ok(body.stored === true || body.ok === true, "and reported it stored", JSON.stringify(body).slice(0, 120));

const [row] = await sql`
  SELECT payload, envelope, message_ids FROM inbound_raw WHERE dedup_key = ${body.dedup_key ?? ""}`;
ok(!!row, "the delivery reached the database");
ok(row?.payload !== null && JSON.stringify(row?.payload).includes(`unique-body-${marker}`),
   "the mail inside it was KEPT VERBATIM — no data loss");
ok(row?.envelope?.n8n?.verdict?.gate === "e2e-probe", "the n8n envelope survived");

if (body.dedup_key) {
  await sql`DELETE FROM inbound_raw WHERE dedup_key = ${body.dedup_key}`;
  await sql`DELETE FROM thread_messages WHERE message_id = ${marker + "-1"}`;
}

console.log(fails ? `\n${fails} FAILED\n` : `\nintake verified end to end against ${BASE}\n`);
process.exit(fails ? 1 : 0);
