// ============================================================================
// Prove the service account can read the mailbox and change a label — before any
// mail depends on it.
// ----------------------------------------------------------------------------
// Domain-wide delegation fails in exactly two ways and both arrive as an opaque OAuth
// code, minutes after an admin clicked something in a different console. This asks each
// question separately so the answer names the step that is wrong rather than "403".
//
// SAFE AGAINST THE LIVE MAILBOX. It reads, then creates a label with a unique throwaway
// name and deletes that same label by the id it just got back. None of the four real
// labels is touched, and nothing is ever applied to a thread. Deleting a label IS
// destructive in general — Gmail strips it from every thread wearing it — which is
// exactly why this only ever deletes the one it made a second earlier.
//
//   npx tsx scripts/verify-gmail-sa.ts
// ============================================================================
import { serviceAccountToken } from "../app/lib/mail/serviceAccountToken";
import { GMAIL_READ_SCOPES, GMAIL_WRITE_SCOPES, BOOKINGS_MAILBOX } from "../app/lib/mail/gmailAuth";
import { THE_FOUR } from "../app/lib/mail/gmailWrite";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
};

async function main() {
  const { loadEnv } = await import("./_env.mjs");
  loadEnv();

  const clientEmail = (process.env.GMAIL_SA_CLIENT_EMAIL || "").trim();
  const privateKey = (process.env.GMAIL_SA_PRIVATE_KEY || "").trim();
  const subject = (process.env.GMAIL_SUBJECT || BOOKINGS_MAILBOX).trim();

  console.log("=".repeat(78));
  console.log("GMAIL SERVICE ACCOUNT — can it read, and can it change a label?");
  console.log("=".repeat(78));
  console.log(`  mailbox        ${subject}`);
  console.log(`  service acct   ${clientEmail || "(not set)"}`);

  console.log("\n[1] both halves of the credential are present");
  ok(!!clientEmail, "GMAIL_SA_CLIENT_EMAIL is set");
  ok(!!privateKey, "GMAIL_SA_PRIVATE_KEY is set");
  if (!clientEmail || !privateKey) {
    console.log("\n  Half a service account counts as none, deliberately — the refresh token keeps working.");
    process.exit(1);
  }
  ok(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey.replace(/\\n/g, "\n")),
     "the key looks like a PEM", "paste `private_key` from the JSON verbatim, \\n and all");

  const cfg = { clientEmail, privateKey, subject };

  console.log("\n[2] gmail.readonly — delegation is granted for reading");
  let readToken = "";
  try {
    readToken = await serviceAccountToken({ ...cfg, scopes: GMAIL_READ_SCOPES });
    ok(true, "a token was issued for " + GMAIL_READ_SCOPES.join(" "));
  } catch (err) {
    ok(false, "token refused", String((err as Error).message).slice(0, 220));
  }

  if (readToken) {
    const r = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${readToken}` } });
    const body: any = await r.json().catch(() => ({}));
    ok(r.ok, "the mailbox answered", r.ok ? `${body.emailAddress}, ${body.messagesTotal} messages` : JSON.stringify(body).slice(0, 200));
    // The subject is the mailbox being impersonated. If this comes back as anything else,
    // GMAIL_SUBJECT is pointed at the wrong account and every later number is about it.
    ok(!r.ok || String(body.emailAddress || "").toLowerCase() === subject.toLowerCase(),
       "and it is the mailbox we meant", String(body.emailAddress || ""));
  }

  console.log("\n[3] gmail.modify — delegation is granted for writing");
  let writeToken = "";
  try {
    writeToken = await serviceAccountToken({ ...cfg, scopes: GMAIL_WRITE_SCOPES });
    ok(true, "a token was issued for " + GMAIL_WRITE_SCOPES.join(" "));
  } catch (err) {
    ok(false, "token refused", String((err as Error).message).slice(0, 220));
  }

  if (writeToken) {
    const auth = { Authorization: `Bearer ${writeToken}`, "content-type": "application/json" };

    const list = await fetch(`${API}/labels`, { headers: auth });
    const lb: any = await list.json().catch(() => ({}));
    ok(list.ok, "labels are readable", list.ok ? `${(lb.labels || []).length} labels` : JSON.stringify(lb).slice(0, 200));

    if (list.ok) {
      const names = new Set((lb.labels || []).map((l: any) => String(l.name)));
      const present = THE_FOUR.filter((n) => names.has(n));
      // Not a failure: the poller creates whichever are missing on first use. Reported
      // because "all four already there" and "none of them yet" are worth telling apart.
      console.log(`     the four labels present today: ${present.length}/4${present.length ? " — " + present.join(", ") : ""}`);
    }

    // The real question: can it CHANGE anything? A throwaway name, deleted by the id it
    // was just given, so no real label is ever at risk.
    const probe = `Spartan SA check ${Date.now()}`;
    const made = await fetch(`${API}/labels`, { method: "POST", headers: auth, body: JSON.stringify({ name: probe }) });
    const mj: any = await made.json().catch(() => ({}));
    ok(made.ok && mj?.id, "a label can be created", made.ok ? probe : JSON.stringify(mj).slice(0, 220));

    if (mj?.id) {
      const del = await fetch(`${API}/labels/${mj.id}`, { method: "DELETE", headers: auth });
      ok(del.ok || del.status === 204, "and cleaned up again", `HTTP ${del.status}`);
      if (!(del.ok || del.status === 204)) console.log(`     LEFT BEHIND: "${probe}" (${mj.id}) — delete it by hand`);
    }
  }

  console.log("\n" + "=".repeat(78));
  if (fails === 0) {
    console.log("READY. Set the three variables in Vercel, redeploy, and check");
    console.log("  /api/mail-poll?status=1  ->  \"credential\":\"service-account\"");
  } else {
    console.log(`${fails} CHECK(S) FAILED.`);
    console.log("  unauthorized_client  -> the Client ID is not in Domain-wide delegation");
    console.log("  invalid_scope        -> the scope list does not match CHARACTER FOR CHARACTER.");
    console.log("     Both must be present, comma-separated, in ONE entry:");
    console.log(`     ${GMAIL_READ_SCOPES[0]},${GMAIL_WRITE_SCOPES[0]}`);
    console.log("  invalid_grant        -> GMAIL_SUBJECT is not a real mailbox, or this box's clock is skewed");
    console.log("  403 has not been used -> enable the Gmail API on the Cloud project");
  }
  console.log("=".repeat(78));
  process.exit(fails ? 1 : 0);
}

main();
