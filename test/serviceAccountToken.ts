// ============================================================================
// A credential that a password change cannot revoke.
// ----------------------------------------------------------------------------
// A Gmail refresh token dies when the mailbox password changes. Google documents it,
// there is no exemption for Internal apps, Workspace domains or admin-trusted clients,
// and it cost Spartan five days of intake across 2026-08-26/27 and 09-09..11 — ~69
// enquiry threads, recovered by hand. Recall on every other day was 99.5%, so the
// credential was the whole of the problem.
//
// A service account with domain-wide delegation has no such coupling: the grant is made
// by an admin against the CLIENT, not by a user against a session, and rotating a
// mailbox password is once again ordinary hygiene.
//
// WHAT THIS FILE PINS, and every one of them is a way this fails silently or confusingly:
//
//   - `sub` is the impersonated mailbox and is NOT optional. Without it Google issues a
//     perfectly valid token for the service account ITSELF, which owns no mailbox, and
//     Gmail then answers 400/404 for reasons that read like a scope problem.
//   - the assertion is really signed, verified here against the public half rather than
//     merely shaped like a JWT.
//   - `exp` is inside Google's one-hour ceiling; longer is rejected outright.
//   - the PEM survives an env var. Keys are pasted with literal backslash-n and arrive
//     as one line; a key that looks right and does not parse is the classic half-hour.
//   - the token is cached, because minting one per message would be a second request
//     per email for no reason.
//   - `unauthorized_client` is named for what it is: DWD not granted for these scopes.
//     It is THE error this setup produces when the admin step is missed or the scope
//     list does not match character for character.
//
// Offline. No network — the token endpoint is stubbed.  npx tsx test/serviceAccountToken.ts
// ============================================================================
import { generateKeyPairSync, createVerify } from "node:crypto";
import { serviceAccountToken, __resetTokenCache, buildAssertion } from "../app/lib/mail/serviceAccountToken";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CFG = {
  clientEmail: "spartan-intake@spartan-crew.iam.gserviceaccount.com",
  privateKey: PEM,
  subject: "bookings@spartancrew.co.uk",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
};

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/** Stub the token endpoint, recording what was sent to it. */
function withToken(reply: { status: number; body: any }, run: (seen: { body: URLSearchParams | null; calls: number }) => Promise<void>) {
  const real = globalThis.fetch;
  const seen = { body: null as URLSearchParams | null, calls: 0 };
  globalThis.fetch = (async (_url: string, init: any) => {
    seen.calls++;
    seen.body = new URLSearchParams(String(init?.body ?? ""));
    return { ok: reply.status === 200, status: reply.status, async json() { return reply.body; }, async text() { return JSON.stringify(reply.body); } };
  }) as unknown as typeof fetch;
  return run(seen).finally(() => { globalThis.fetch = real; });
}

const GOOD = { status: 200, body: { access_token: "ya29.test-token", expires_in: 3600, token_type: "Bearer" } };

async function main() {
  console.log("\n[1] the assertion is a real signed JWT, not a JWT-shaped string");
  {
    const jwt = buildAssertion(CFG, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    ok(!!h && !!p && !!s, "three segments");
    const header = b64urlJson(h), claims = b64urlJson(p);
    ok(header.alg === "RS256" && header.typ === "JWT", "RS256", JSON.stringify(header));

    // The signature is verified against the public half. A test that only parses the
    // claims would pass just as happily on an unsigned string.
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    ok(v.verify(publicKey, Buffer.from(s, "base64url")), "and the signature actually verifies against the key");

    ok(claims.iss === CFG.clientEmail, "iss is the service account", claims.iss);
    ok(claims.aud === "https://oauth2.googleapis.com/token", "aud is the token endpoint", claims.aud);
    ok(claims.scope === CFG.scopes.join(" "), "scopes are space-joined", claims.scope);
  }

  console.log("\n[2] `sub` IS THE IMPERSONATION — without it the token is useless and looks fine");
  {
    const claims = b64urlJson(buildAssertion(CFG, 1_700_000_000).split(".")[1]);
    ok(claims.sub === "bookings@spartancrew.co.uk", "sub names the mailbox being read", claims.sub);

    // Refusing is the whole point: a token minted with no sub is VALID, and Gmail then
    // fails later with an error that reads like a scope problem. Fail here, where the
    // message can say what is actually wrong.
    let threw = "";
    try { buildAssertion({ ...CFG, subject: "" }, 1_700_000_000); } catch (e) { threw = String((e as Error).message); }
    ok(/subject|impersonat/i.test(threw), "an empty subject is refused outright", threw.slice(0, 70));
  }

  console.log("\n[3] exp is inside Google's one-hour ceiling");
  {
    const now = 1_700_000_000;
    const claims = b64urlJson(buildAssertion(CFG, now).split(".")[1]);
    ok(claims.iat === now, "iat is now", String(claims.iat));
    ok(claims.exp > now && claims.exp - now <= 3600, "exp is within an hour", `${claims.exp - now}s`);
  }

  console.log("\n[4] the PEM survives a round trip through an env var");
  {
    // How a key actually arrives: one line, literal backslash-n, often quoted.
    const escaped = PEM.replace(/\n/g, "\\n");
    const jwt = buildAssertion({ ...CFG, privateKey: escaped }, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    ok(v.verify(publicKey, Buffer.from(s, "base64url")), "a key with literal \\n still signs");

    const quoted = `"${escaped}"`;
    const jwt2 = buildAssertion({ ...CFG, privateKey: quoted }, 1_700_000_000);
    const v2 = createVerify("RSA-SHA256");
    v2.update(jwt2.split(".").slice(0, 2).join("."));
    ok(v2.verify(publicKey, Buffer.from(jwt2.split(".")[2], "base64url")), "and so does one wrapped in quotes");
  }

  console.log("\n[5] the exchange sends the JWT bearer grant Google expects");
  {
    __resetTokenCache();
    await withToken(GOOD, async (seen) => {
      const t = await serviceAccountToken(CFG);
      ok(t === "ya29.test-token", "the access token comes back", String(t));
      ok(seen.body?.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer", "grant_type is the JWT bearer grant", String(seen.body?.get("grant_type")));
      ok((seen.body?.get("assertion") ?? "").split(".").length === 3, "and the assertion rides along");
    });
  }

  console.log("\n[6] the token is cached, and re-minted once it is near expiry");
  {
    __resetTokenCache();
    await withToken(GOOD, async (seen) => {
      await serviceAccountToken(CFG);
      await serviceAccountToken(CFG);
      await serviceAccountToken(CFG);
      ok(seen.calls === 1, "three asks, one exchange", `${seen.calls}`);
    });
    __resetTokenCache();
    await withToken({ status: 200, body: { access_token: "short", expires_in: 30 } }, async (seen) => {
      await serviceAccountToken(CFG);
      await serviceAccountToken(CFG);
      // 30s is inside the refresh margin, so it must not be handed out a second time —
      // a token that expires mid-poll fails the request it was fetched for.
      ok(seen.calls === 2, "a token expiring within the margin is re-minted", `${seen.calls}`);
    });
  }

  console.log("\n[7] the admin step being missed has ONE error, and it is named");
  {
    __resetTokenCache();
    await withToken({ status: 401, body: { error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method." } }, async () => {
      let msg = "";
      try { await serviceAccountToken(CFG); } catch (e) { msg = String((e as Error).message); }
      ok(/domain-wide delegation/i.test(msg), "says domain-wide delegation, not just the raw error", msg.slice(0, 110));
      ok(msg.includes(CFG.clientEmail) || /client id/i.test(msg), "and points at what the admin has to authorise");
    });
  }

  console.log("\n[8] a scope typo is the other half of the same mistake");
  {
    __resetTokenCache();
    await withToken({ status: 400, body: { error: "invalid_scope", error_description: "Invalid oauth scope" } }, async () => {
      let msg = "";
      try { await serviceAccountToken(CFG); } catch (e) { msg = String((e as Error).message); }
      ok(/scope/i.test(msg) && /character/i.test(msg), "says the scope list must match the grant exactly", msg.slice(0, 110));
    });
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}

main();
