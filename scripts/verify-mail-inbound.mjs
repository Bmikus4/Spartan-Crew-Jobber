// ============================================================================
// Prove /api/mail-inbound works against a DEPLOYED build, before mail depends on it.
// ----------------------------------------------------------------------------
// The unit tests (test/mailInbound.ts) prove the parser and the threading rule in
// isolation. They cannot prove the thing that actually breaks on the day: that the
// route is reachable, that the secret in the URL is the one the deployment holds,
// that the database write lands, and that a reply arriving minutes later finds the
// message it is replying to. That needs the real deployment and the real database.
//
// SAFE TO RUN AGAINST PRODUCTION, and the reason is worth stating because it is the
// only reason: every message it posts is FROM a spartancrew.co.uk address. The route
// stores outbound mail for threading and returns before the engine, so nothing here
// classifies, composes, or writes to OnSinch. No client is ever emailed and no order
// can be raised. Change the sender domain and that guarantee is gone.
//
// Rows are tagged and deleted on the way out, including after a failure.
//
//   node scripts/verify-mail-inbound.mjs [base-url]
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const BASE = (process.argv[2] || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const SECRET = (process.env.MAIL_INBOUND_SECRET || process.env.N8N_WEBHOOK_SECRET || "").trim();
if (!SECRET) throw new Error("no MAIL_INBOUND_SECRET or N8N_WEBHOOK_SECRET — the route would refuse every call");
const sql = neon(requireEnv("DATABASE_URL"));

const TAG = `mailverify-${Date.now()}`;
const ROOT_ID = `<${TAG}-root@spartancrew.co.uk>`;
const REPLY_ID = `<${TAG}-reply@spartancrew.co.uk>`;
const ORPHAN_ID = `<${TAG}-orphan@spartancrew.co.uk>`;

let fails = 0;
const ok = (cond, label, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const mime = (id, refs, subject) =>
  [
    `Message-ID: ${id}`,
    ...(refs ? [`In-Reply-To: ${refs}`, `References: ${refs}`] : []),
    // FROM SPARTAN ON PURPOSE. This is what keeps the engine out of the loop.
    `From: Verification <verify@spartancrew.co.uk>`,
    `To: bookings@spartancrew.co.uk`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: text/plain; charset="utf-8"`,
    ``,
    `${TAG} verification message, ignore.`,
    ``,
  ].join("\r\n");

const url = (q = "") => `${BASE}/api/mail-inbound?k=${encodeURIComponent(SECRET)}${q}`;

async function post(body, headers) {
  const r = await fetch(url(), { method: "POST", body, headers });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* left null so the caller can say so */ }
  return { status: r.status, json, text };
}

async function main() {
  console.log(`verifying ${BASE}/api/mail-inbound\n`);

  console.log("[1] the door");
  const live = await fetch(url(), { method: "GET" });
  ok(live.ok, "GET with the secret answers", String(live.status));
  const shut = await fetch(`${BASE}/api/mail-inbound`, { method: "GET" });
  ok(shut.status === 401, "GET with NO secret is refused — a deployment that answers this is open", String(shut.status));
  const wrong = await fetch(`${BASE}/api/mail-inbound?k=definitely-not-the-secret`, { method: "GET" });
  ok(wrong.status === 401, "and a wrong secret is refused", String(wrong.status));

  console.log("\n[2] raw MIME as the whole body, the CloudMailin shape");
  const a = await post(mime(ROOT_ID, null, `${TAG} root`), { "content-type": "message/rfc822" });
  ok(a.status === 200 && a.json?.ok === true, "accepted", a.text.slice(0, 160));
  ok(a.json?.stored === true, "the message was stored");
  ok(a.json?.joined === false, "it joined nothing, being the first of its thread");
  ok(a.json?.engine === "skipped" && /outbound/.test(String(a.json?.reason)),
     "and the engine did NOT run — this is what makes the check safe in production", String(a.json?.reason));
  const threadId = a.json?.thread_id;
  ok(typeof threadId === "string" && threadId.startsWith("mail:"), "a thread id was minted", threadId);

  console.log("\n[3] the same message again, which is what a provider retry looks like");
  const again = await post(mime(ROOT_ID, null, `${TAG} root`), { "content-type": "message/rfc822" });
  ok(again.json?.thread_id === threadId, "lands on the same thread", again.json?.thread_id);
  ok(again.json?.stored === false, "and stores nothing the second time");

  console.log("\n[4] a reply, delivered in the SendGrid multipart shape");
  const form = new FormData();
  form.set("email", mime(REPLY_ID, ROOT_ID, `Re: ${TAG} root`));
  form.set("to", "bookings@spartancrew.co.uk");
  const b = await fetch(url(), { method: "POST", body: form });
  const bj = await b.json().catch(() => null);
  ok(bj?.provider === "sendgrid", "read as a SendGrid delivery", String(bj?.provider));
  ok(bj?.joined === true, "the reply found its parent");
  ok(bj?.thread_id === threadId, "and landed on the SAME thread — the whole design in one assertion", String(bj?.thread_id));
  ok(bj?.joined_via === ROOT_ID.toLowerCase(), "via the id it referenced", String(bj?.joined_via));

  console.log("\n[5] a reply to a message nobody holds, in the Postmark shape");
  const c = await post(JSON.stringify({ RawEmail: mime(ORPHAN_ID, "<nobody-has-this@example.invalid>", `Re: ${TAG} absent`) }),
                       { "content-type": "application/json" });
  ok(c.json?.provider === "postmark", "read as a Postmark delivery", String(c.json?.provider));
  ok(c.json?.joined === false, "it joined nothing");
  ok(c.json?.thread_id !== threadId,
     "and opened its OWN thread rather than fusing — the merge that must never happen", String(c.json?.thread_id));

  console.log("\n[6] a delivery with no raw mail in it");
  const d = await post(JSON.stringify({ subject: "parsed JSON, not raw" }), { "content-type": "application/json" });
  ok(d.status === 200, "is still answered 200, so the provider does not retry for hours", String(d.status));
  ok(/no raw MIME/.test(String(d.json?.note)), "and says which provider setting is wrong", String(d.json?.note));

  console.log("\n[7] the database agrees with what the route said");
  const rows = await sql`
    SELECT message_id, thread_id, is_from_spartan FROM thread_messages
    WHERE message_id = ANY(${[ROOT_ID, REPLY_ID, ORPHAN_ID].map((s) => s.toLowerCase())})`;
  ok(rows.length === 3, "all three messages are on disk", String(rows.length));
  const threads = new Set(rows.map((r) => r.thread_id));
  ok(threads.size === 2, "in two threads, not three and not one", [...threads].join(", "));
  ok(rows.every((r) => r.is_from_spartan), "every one recorded as outbound");
}

try {
  await main();
} finally {
  // Always, including after a failure: a verification that leaves rows behind makes
  // the next person's count wrong and is worse than not running.
  const ids = [ROOT_ID, REPLY_ID, ORPHAN_ID].map((s) => s.toLowerCase());
  const gone = await sql`DELETE FROM thread_messages WHERE message_id = ANY(${ids}) RETURNING message_id`;
  await sql`DELETE FROM inbound_raw WHERE message_id = ANY(${ids})`;
  console.log(`\ncleaned up ${gone.length} row(s)`);
}

console.log(fails ? `\n${fails} FAILED\n` : `\nmail-inbound verified end to end against ${BASE}\n`);
process.exit(fails ? 1 : 0);
