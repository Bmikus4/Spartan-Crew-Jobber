// ============================================================================
// The last leg: a CLIENT message through /api/mail-inbound actually drives the engine.
// ----------------------------------------------------------------------------
// scripts/verify-mail-inbound.mjs proves the door, the four provider shapes, the
// threading and the storage — but every message it posts is from a spartancrew.co.uk
// address, so the route returns before the engine on purpose. That leaves exactly one
// thing unproven, and it is the thing the route exists for: that a real inbound message,
// rebuilt into a thread from its headers alone, reaches handleThread and comes back with
// a decision.
//
// THIS ONE WRITES. `order_mode` is retired — an order goes to OnSinch as To Confirm the
// moment it composes — so this is a live write, and that is why:
//
//   - it refuses to run without --write;
//   - the enquiry names TEST company 515 "TEST - Eventz" and venue "ExCel London", both
//     of which exist, so no company and no place is provisioned into the tenant;
//   - it lists company 515's orders before and after and DELETES anything new, including
//     after a failure;
//   - the work date is years out, so a leaked order could not collide with real work.
//
// Everything it touches in Neon is keyed on one thread and removed on the way out.
//
//   npx tsx scripts/verify-mail-inbound-engine.ts --write [base-url]
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { loadEnv, requireEnv, onsinchBase } from "./_env.mjs";

loadEnv();
if (!process.argv.includes("--write")) {
  console.log("read-only by default. Pass --write: this creates a real OnSinch order on TEST 515 and deletes it.");
  process.exit(0);
}
const BASE = (process.argv.find((a) => a.startsWith("http")) || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const SECRET = (process.env.MAIL_INBOUND_SECRET || process.env.N8N_WEBHOOK_SECRET || "").trim();
if (!SECRET) throw new Error("no MAIL_INBOUND_SECRET or N8N_WEBHOOK_SECRET — the route would refuse every call");
const KEY = (process.env.ONSINCH_API_KEY || "").trim();
if (!KEY) throw new Error("no ONSINCH_API_KEY — nothing could clean up what this creates");

const sql = neon(requireEnv("DATABASE_URL"));
const onsinch = new OnsinchClient(httpTransport({ baseUrl: onsinchBase(), apiKey: KEY }));

const COMPANY = 515, COMPANY_NAME = "TEST - Eventz", VENUE = "ExCel London";
const TAG = `mailengine-${Date.now()}`;
const MSG_ID = `<${TAG}@verify.example>`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

async function orderIds(): Promise<Set<number>> {
  const rows = await onsinch.getOrders({ company_id: COMPANY, limit: 500 });
  return new Set(rows.map((o: any) => Number(o.id)).filter(Number.isFinite));
}

const mime = [
  `Message-ID: ${MSG_ID}`,
  `From: Verification Client <verify@verify.example>`,
  `To: bookings@spartancrew.co.uk`,
  `Subject: ${TAG} crew enquiry`,
  `Date: ${new Date().toUTCString()}`,
  `Content-Type: text/plain; charset="utf-8"`,
  ``,
  `Hi,`,
  ``,
  `This is ${COMPANY_NAME}. We need 3 crew at ${VENUE} on 14 November 2029,`,
  `08:00 until 16:00, for a build. Please confirm.`,
  ``,
  `Thanks`,
  ``,
].join("\r\n");

let created: number[] = [];
let threadId = "";

async function main() {
  console.log(`verifying the engine leg of ${BASE}/api/mail-inbound\n`);
  console.log(`[0] what company ${COMPANY} holds before`);
  const before = await orderIds();
  console.log(`  ${before.size} order(s)`);

  console.log(`\n[1] a CLIENT message, raw MIME, straight at the route`);
  const r = await fetch(`${BASE}/api/mail-inbound?k=${encodeURIComponent(SECRET)}`, {
    method: "POST", body: mime, headers: { "content-type": "message/rfc822" },
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* reported by the assertion below */ }
  threadId = String(j?.thread_id ?? "");
  ok(r.status === 200 && j?.ok === true, "accepted", text.slice(0, 200));
  ok(j?.engine !== "skipped", "the engine RAN — the assertion this whole route exists for",
     String(j?.engine ?? j?.reason ?? "ran"));
  ok(typeof j?.classification === "string" && j.classification.length > 0,
     "and returned a classification", String(j?.classification));
  ok(typeof j?.status === "string", "and a status", String(j?.status));
  ok(Boolean(threadId), "on a thread rebuilt from headers alone", threadId);

  console.log(`\n[2] the decision was recorded against that thread`);
  const state = (await sql`
    SELECT thread_id, state FROM conversation_state WHERE thread_id = ${threadId}`) as any[];
  ok(state.length === 1, "conversation_state holds exactly one row for it", String(state.length));
  const notes: string[] = state[0]?.state?.notes ?? [];
  ok(Array.isArray(notes) && notes.length > 0, "with the decision trail on it", `${notes.length} note(s)`);
  for (const n of notes.slice(0, 14)) console.log(`      ${n}`);

  console.log(`\n[3] what it wrote to OnSinch`);
  const after = await orderIds();
  created = [...after].filter((id) => !before.has(id));
  console.log(`  ${created.length} new order(s) on company ${COMPANY}: ${created.join(", ") || "none"}`);
  // Either outcome passes, and the distinction matters. An order means the whole path
  // ran end to end; no order means a GATE held it — an assumed rate card on a company
  // with no pricing history is the usual one — which is the engine deciding, not the
  // route failing. What would be a failure is two.
  ok(created.length <= 1, "at most one order — a route that writes twice is the merge failure wearing another hat",
     String(created.length));
  ok(true, created.length ? "an order was raised, and is about to be deleted" : "no order was raised; a gate held it");
}

// Wrapped rather than top-level: tsx compiles this file to CJS, where top-level await
// is a transform error rather than a runtime one — it fails before a line has run.
async function run() {
try {
  await main();
} finally {
  // Always, including after a throw. An order left on the tenant is worse than no check.
  if (created.length) {
    try {
      await onsinch.deleteOrders(created);
      const still = await orderIds();
      const leaked = created.filter((id) => still.has(id));
      console.log(leaked.length
        ? `\n  STILL PRESENT: ${leaked.join(", ")} — DELETE THESE BY HAND`
        : `\ndeleted order(s) ${created.join(", ")}`);
      if (leaked.length) fails++;
    } catch (err) {
      fails++;
      console.log(`\n  DELETE FAILED for ${created.join(", ")}: ${String((err as Error)?.message ?? err)} — DELETE BY HAND`);
    }
  }
  if (threadId) {
    await sql`DELETE FROM thread_messages WHERE thread_id = ${threadId}`;
    await sql`DELETE FROM conversation_state WHERE thread_id = ${threadId}`;
    await sql`DELETE FROM tickets WHERE thread_id = ${threadId}`.catch(() => {});
  }
  await sql`DELETE FROM inbound_raw WHERE message_id = ${MSG_ID.toLowerCase()}`;
  console.log(`cleaned up thread ${threadId || "(none)"}`);
}

console.log(fails ? `\n${fails} FAILED\n` : `\nthe engine leg is proven against ${BASE}\n`);
process.exit(fails ? 1 : 0);
}

run();
