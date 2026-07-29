// Prove the DEPLOYED wiring the way n8n will actually call it: the dedupe claim
// (twice, to see found flip) and the engine intake with a contract-shaped payload
// built by the same node body n8n runs. Cleans up its own test rows.
//
//   node scripts/probe-live-wiring.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const SECRET = requireEnv("N8N_WEBHOOK_SECRET");
const BASE = (process.env.ENGINE_BASE_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const h = { "Content-Type": "application/json", "x-webhook-secret": SECRET };
const sql = neon(requireEnv("DATABASE_URL"));

let fails = 0;
const ok = (cond, label, extra = "") => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };
const post = async (path, body) => {
  const res = await fetch(BASE + path, { method: "POST", headers: h, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
};

const TAG = `probe-${process.pid}`;
const MSG = `${TAG}-msg-1`;
const THREAD = `${TAG}-thread-1`;

console.log(`\nprobing ${BASE}\n`);

console.log("1. /api/dedupe rejects an unauthenticated call");
{
  const res = await fetch(`${BASE}/api/dedupe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok(res.status === 401, "401 without the secret", `got ${res.status}`);
}

console.log("2. first claim");
{
  const r = await post("/api/dedupe", { message_id: MSG, thread_id: THREAD, from_address: "probe@example.com", note: TAG });
  ok(r.status === 200, "200", `got ${r.status}`);
  ok(r.json?.first_seen === true, "first_seen true");
  ok(r.json?.found === false, "found false");
  ok(r.json?.thread_first_seen === true, "thread_first_seen true -> new job");
  ok(!r.json?.degraded, "not degraded (real DB write)", r.json?.degraded || "");
}

console.log("3. same message again");
{
  const r = await post("/api/dedupe", { message_id: MSG, thread_id: THREAD });
  ok(r.json?.found === true, "found true");
  ok(r.json?.first_seen === false, "first_seen false");
  ok(r.json?.seen_count === 2, "seen_count 2", `got ${r.json?.seen_count}`);
}

console.log("4. second message on the same thread -> update, not new job");
{
  const r = await post("/api/dedupe", { message_id: `${TAG}-msg-2`, thread_id: THREAD });
  ok(r.json?.first_seen === true, "first_seen true");
  ok(r.json?.thread_first_seen === false, "thread_first_seen false -> update");
}

console.log("5. /api/n8n-inbound accepts a payload from the real node body");
// Build it with the same code n8n runs, so this tests the contract, not a guess.
const nodeSrc = readFileSync(join(ROOT_DIR, "n8n", "nodes", "build-engine-payload.js"), "utf8");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const gmailThread = {
  id: THREAD,
  messages: [{
    id: MSG,
    internalDate: "1786000000000",
    payload: {
      headers: [
        { name: "From", value: "Probe Client <probe@example.com>" },
        { name: "To", value: "bookings@spartancrew.co.uk" },
        { name: "Subject", value: `[${TAG}] crew required 12 August - ExCeL London` },
      ],
      parts: [{ mimeType: "text/plain", body: { data: b64("We need 6 crew at ExCeL London on 12 August 2026, 08:00 to 18:00.") } }],
    },
  }],
};
const fake$ = (name) => {
  const nodes = {
    "Normalize Data": { original_email: { email_id: MSG, thread_id: THREAD, from: "probe@example.com", subject: "probe", body: "We need 6 crew at ExCeL London on 12 August 2026." }, thread_history: { messages: [] } },
    "Get a thread2": gmailThread,
  };
  if (!(name in nodes)) throw new Error("no node");
  return { item: { json: nodes[name] }, all: () => [{ json: nodes[name] }] };
};
const built = new Function("$", "$json", "Buffer", nodeSrc)(fake$, {}, Buffer)[0].json;
ok(built.thread_id === THREAD, "node body produced the thread_id", built.thread_id);
ok(built.messages.length === 1, "node body produced 1 message");
{
  const r = await post("/api/n8n-inbound", built);
  ok(r.status === 200, "200 from the engine", `got ${r.status} ${r.text.slice(0, 200)}`);
  // The contract path returns thread_id/classification; the parked path returns a note.
  const parked = typeof r.json?.note === "string";
  ok(!parked, "NOT parked in inbound_raw as unaligned (the contract matched)", parked ? r.json.note : "");
  if (!parked) {
    ok(r.json?.thread_id === THREAD, "engine keyed the state on our thread", String(r.json?.thread_id));
    console.log(`     classification=${r.json?.classification} status=${r.json?.status} needs_human=${r.json?.needs_human}`);
    if (r.json?.error) console.log(`     engine error: ${r.json.error}`);
  } else {
    console.log(`     note: ${r.json.note}`);
  }
}

console.log("\ncleanup");
{
  const a = await sql`DELETE FROM message_ledger WHERE message_id LIKE ${TAG + "%"} RETURNING message_id`;
  const b = await sql`DELETE FROM inbound_raw WHERE thread_id = ${THREAD} RETURNING id`;
  const c = await sql`DELETE FROM tickets WHERE thread_id = ${THREAD} RETURNING thread_id`;
  const d = await sql`DELETE FROM conversation_state WHERE thread_id = ${THREAD} RETURNING thread_id`;
  // upsertTicketFromState also appends to ticket_events - the first version of
  // this cleanup missed that and left orphan audit rows behind.
  const e = await sql`DELETE FROM ticket_events WHERE thread_id = ${THREAD} RETURNING id`;
  console.log(`  removed ledger=${a.length} inbound_raw=${b.length} tickets=${c.length} state=${d.length} events=${e.length}`);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
