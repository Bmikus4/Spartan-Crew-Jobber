// ============================================================================
// The durable credential wins, and the fragile one is never reached for silently.
// ----------------------------------------------------------------------------
// The point of the service account is that a mailbox password change stops mattering.
// That property survives only if (a) it is actually preferred once configured, and
// (b) a FAILING service account does not quietly fall back to the refresh token — which
// would reintroduce the revocable credential at the exact moment nobody is watching, and
// the 2026-08-26 outage is what "nobody is watching" looks like: 42 hours, every
// dashboard green, because the thing that broke was not the thing being reported.
//
// Offline. No network.  npx tsx test/gmailAuth.ts
// ============================================================================
import { generateKeyPairSync } from "node:crypto";
import { gmailAccessToken, tokenSource, serviceAccountConfigured } from "../app/lib/mail/gmailAuth";
import { __resetTokenCache } from "../app/lib/mail/serviceAccountToken";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const SA_ENV = {
  GMAIL_SA_CLIENT_EMAIL: "spartan-intake@spartan-crew.iam.gserviceaccount.com",
  GMAIL_SA_PRIVATE_KEY: PEM,
  GMAIL_SUBJECT: "bookings@spartancrew.co.uk",
};

function withToken(reply: { status: number; body: any }, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: reply.status === 200, status: reply.status,
    async json() { return reply.body; }, async text() { return JSON.stringify(reply.body); },
  })) as unknown as typeof fetch;
  return run().finally(() => { globalThis.fetch = real; });
}
const GOOD = { status: 200, body: { access_token: "ya29.sa", expires_in: 3600 } };

async function main() {
  console.log("\n[1] with nothing configured, the refresh token is still the path");
  {
    ok(tokenSource({}) === "refresh-token", "no service account means the old credential", tokenSource({}));
    ok(serviceAccountConfigured({}) === false, "and it says so");
    const got = await gmailAccessToken({ env: {}, refreshToken: async () => "old-token" });
    ok(got.token === "old-token" && got.source === "refresh-token", "the fallback is used and labelled", got.source);
  }

  console.log("\n[2] configured, the service account wins — this is the whole migration");
  {
    __resetTokenCache();
    ok(tokenSource(SA_ENV) === "service-account", "detected", tokenSource(SA_ENV));
    await withToken(GOOD, async () => {
      let refreshCalled = false;
      const got = await gmailAccessToken({ env: SA_ENV, refreshToken: async () => { refreshCalled = true; return "old-token"; } });
      ok(got.token === "ya29.sa" && got.source === "service-account", "the service-account token is returned", got.source);
      ok(refreshCalled === false, "and the refresh token was never reached for");
    });
  }

  console.log("\n[3] HALF a service account is not a service account");
  {
    // A client email with no key would fail every read with a signing error. Treating it
    // as unconfigured keeps the working credential working while the setup is finished.
    ok(tokenSource({ GMAIL_SA_CLIENT_EMAIL: SA_ENV.GMAIL_SA_CLIENT_EMAIL }) === "refresh-token", "email without a key is not configured");
    ok(tokenSource({ GMAIL_SA_PRIVATE_KEY: PEM }) === "refresh-token", "key without an email is not configured");
    ok(tokenSource({ GMAIL_SA_CLIENT_EMAIL: "  ", GMAIL_SA_PRIVATE_KEY: "  " }) === "refresh-token", "and whitespace is not configuration");
  }

  console.log("\n[4] A BROKEN SERVICE ACCOUNT MUST NOT FALL BACK");
  {
    // The failure that matters. Falling back here would restore the revocable credential
    // silently, and the outage it causes would be invisible again.
    __resetTokenCache();
    await withToken({ status: 401, body: { error: "unauthorized_client", error_description: "not authorised" } }, async () => {
      let refreshCalled = false, msg = "";
      try {
        await gmailAccessToken({ env: SA_ENV, refreshToken: async () => { refreshCalled = true; return "old-token"; } });
      } catch (e) { msg = String((e as Error).message); }
      ok(refreshCalled === false, "the refresh token is NOT quietly used instead");
      ok(/domain-wide delegation/i.test(msg), "and the delegation error is what surfaces", msg.slice(0, 80));
    });
  }

  console.log("\n[5] with neither credential, it says what to set rather than what failed");
  {
    let msg = "";
    try { await gmailAccessToken({ env: {} }); } catch (e) { msg = String((e as Error).message); }
    ok(/GMAIL_SA_CLIENT_EMAIL/.test(msg) && /GMAIL_SA_PRIVATE_KEY/.test(msg), "names both variables", msg.slice(0, 90));
    ok(/password change cannot revoke/i.test(msg), "and says why that one is preferred");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}

main();
