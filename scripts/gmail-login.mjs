// ============================================================================
// One-time Gmail login for the historical sweep, from this terminal.
// ----------------------------------------------------------------------------
// The Gmail credential the live workflow uses lives inside n8n and cannot be read
// out of it — the public API returns credential metadata only, never the token. So
// to sweep the mailbox from here we do our own OAuth once and keep the refresh
// token locally.
//
// READ-ONLY scope. This can list and read mail; it cannot send, label, delete or
// modify anything, so a sweep can never disturb the mailbox or the live workflow's
// label-based ledger.
//
// You log in, not me: the script prints a URL, you open it and consent as the
// bookings account, and Google hands the code back to a local loopback server. The
// refresh token is appended to .env.local, which is gitignored.
//
// WHAT YOU NEED FIRST (one time, in Google Cloud Console for the project that owns
// the bookings mailbox):
//   1. Enable the Gmail API.
//   2. Credentials -> Create credentials -> OAuth client ID -> "Desktop app".
//      Desktop clients accept a loopback redirect on any port, so nothing needs
//      registering.
//   3. Put the two values in .env.local:
//        GOOGLE_CLIENT_ID=...
//        GOOGLE_CLIENT_SECRET=...
//   4. If the consent screen is in "Testing", add the bookings address as a test
//      user, or the login will be refused.
//
//   node scripts/gmail-login.mjs
// ============================================================================
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const PORT = Number(process.env.GMAIL_LOGIN_PORT || 53682);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("\nGOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not in .env.local.");
  console.error("Create a Desktop-app OAuth client for the project that owns the bookings");
  console.error("mailbox, enable the Gmail API, and put both values in .env.local. The header");
  console.error("of this file has the exact steps.\n");
  process.exit(2);
}

const REDIRECT = `http://localhost:${PORT}`;
const state = randomBytes(16).toString("hex");
const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    state,
    access_type: "offline",   // we need a refresh token
    prompt: "consent",        // force one, even if this client was authorised before
  });

console.log("\nOpen this and sign in as the BOOKINGS mailbox:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect on ${REDIRECT} …  (Ctrl-C to abort)\n`);

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    if (url.pathname !== "/") { res.writeHead(404).end(); return; }
    const err = url.searchParams.get("error");
    const got = url.searchParams.get("code");
    const gotState = url.searchParams.get("state");
    const done = (msg) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body style="font:16px system-ui;padding:40px">${msg}</body></html>`);
      server.close();
    };
    if (err) { done(`Refused: ${err}. You can close this tab.`); reject(new Error(err)); return; }
    if (gotState !== state) { done("State mismatch — ignored."); reject(new Error("state mismatch")); return; }
    if (!got) { done("No code returned."); reject(new Error("no code")); return; }
    done("Signed in. You can close this tab and go back to the terminal.");
    resolve(got);
  });
  server.on("error", reject);
  server.listen(PORT);
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT, grant_type: "authorization_code",
  }),
});
const tok = await res.json();
if (!res.ok || !tok.refresh_token) {
  console.error(`\ntoken exchange failed ${res.status}: ${JSON.stringify(tok).slice(0, 400)}`);
  if (!tok.refresh_token) console.error("No refresh_token came back — Google only sends one with access_type=offline and a fresh consent.");
  process.exit(1);
}

// Confirm which mailbox we actually got, so a wrong account is caught now rather
// than after a 12-month sweep of the wrong inbox.
const who = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
  headers: { Authorization: `Bearer ${tok.access_token}` },
}).then((r) => r.json()).catch(() => ({}));

const envPath = join(ROOT_DIR, ".env.local");
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const line = `GMAIL_REFRESH_TOKEN=${tok.refresh_token}`;
const next = /^GMAIL_REFRESH_TOKEN=.*$/m.test(existing)
  ? existing.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, line)
  : existing.replace(/\s*$/, "\n") + `\n# Gmail read-only, for the historical sweep (scripts/gmail-login.mjs)\n${line}\n`;
writeFileSync(envPath, next);

console.log(`\nsigned in as : ${who.emailAddress ?? "(unknown)"}`);
console.log(`total messages: ${who.messagesTotal ?? "?"}   threads: ${who.threadsTotal ?? "?"}`);
console.log(`scope         : ${SCOPE} (read-only)`);
console.log(`refresh token : written to .env.local (gitignored)`);
if (who.emailAddress && !/bookings@spartancrew\.co\.uk/i.test(who.emailAddress)) {
  console.log(`\nNOTE: that is not bookings@spartancrew.co.uk. Re-run and pick the right account`);
  console.log(`      before sweeping, or the corpus will be the wrong mailbox.`);
}
console.log(`\nNext: node scripts/sweep-gmail.mjs --months 12 --dry\n`);
