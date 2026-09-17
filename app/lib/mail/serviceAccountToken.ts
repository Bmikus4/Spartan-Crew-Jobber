// ============================================================================
// AN ACCESS TOKEN THAT A PASSWORD CHANGE CANNOT REVOKE.
// ----------------------------------------------------------------------------
// This is a drop-in replacement for the refresh-token grant in scripts/sweep-gmail.ts,
// and that is the entire trick: it returns the same thing — a bearer token for
// bookings@spartancrew.co.uk — so every caller downstream, the paging, the backoff, the
// 403-rateLimitExceeded handling, is unchanged. Only where the token comes from moves.
//
// WHY IT HAD TO MOVE. A refresh token carrying Gmail scopes is revoked when the mailbox
// password changes. Google documents it and there is no exemption for Internal apps,
// Workspace domains or admin-trusted clients. It cost five days of intake across
// 2026-08-26/27 and 09-09..11, ~69 enquiry threads audited by hand; recall on every
// other day was 99.5%, so the credential was the whole fault.
//
// A service account is granted by an ADMIN against the client id, not by a user against
// a session. Nothing a mailbox owner does — password, phone, leaving the company —
// touches it.
//
// THE COST, stated plainly because it is the trade Ben chose: a credential is back on
// the hot path. It is a far more durable one, but it is a private key that must be held
// somewhere, and for Kairo every tenant's admin has to grant delegation themselves.
//
// No dependency is added for this. RS256 is four lines of node:crypto, and the one
// thing a JWT library would buy — not getting the claim set wrong — is what
// test/serviceAccountToken.ts pins instead.
// ============================================================================
import { createSign } from "node:crypto";

const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";

/** Re-minted this many ms before expiry: a token that dies mid-poll fails its own request. */
const REFRESH_MARGIN_MS = 60_000;

export interface ServiceAccountConfig {
  /** `client_email` from the key JSON. */
  clientEmail: string;
  /** `private_key` from the key JSON, PEM. Env-var mangling is tolerated — see normalisePem. */
  privateKey: string;
  /** THE MAILBOX BEING READ. Not optional — see buildAssertion. */
  subject: string;
  scopes: string[];
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/**
 * A PEM that has been through an environment variable.
 *
 * Keys are pasted out of the JSON as one line with literal backslash-n, and shells and
 * dashboards variously add surrounding quotes. All of it parses to a key that looks
 * correct in a log and fails to sign, which is a long half-hour the first time.
 */
function normalisePem(key: string): string {
  let k = String(key ?? "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\r/g, "").replace(/\\n/g, "\n").trim();
}

/**
 * The signed assertion Google exchanges for an access token.
 *
 * `sub` IS THE POINT. Domain-wide delegation means "act as this user", and without a
 * subject Google issues a valid token for the service account itself — an identity that
 * owns no mailbox. Gmail then answers 400 or 404 in a way that reads like a scope
 * problem, and the real cause is two files away. So an empty subject is refused here,
 * where the message can say what is wrong.
 */
export function buildAssertion(cfg: ServiceAccountConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!cfg.subject?.trim()) {
    throw new Error(
      "service account: no subject to impersonate. Domain-wide delegation needs the MAILBOX address " +
      "(e.g. bookings@spartancrew.co.uk); without it Google issues a valid token for the service " +
      "account itself, which owns no mailbox, and Gmail fails later looking like a scope error."
    );
  }
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: cfg.clientEmail,
    sub: cfg.subject.trim(),
    scope: cfg.scopes.join(" "),
    aud: TOKEN_URL,
    iat: nowSec,
    // Google rejects anything over an hour outright, so this is the ceiling and not a choice.
    exp: nowSec + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  return `${signingInput}.${signer.sign(normalisePem(cfg.privateKey)).toString("base64url")}`;
}

const cache = new Map<string, { token: string; expiresAt: number }>();

/** Test seam: the cache is module-global, so one case would otherwise answer the next. */
export function __resetTokenCache(): void {
  cache.clear();
}

export async function serviceAccountToken(cfg: ServiceAccountConfig): Promise<string> {
  const key = `${cfg.clientEmail}|${cfg.subject}|${cfg.scopes.join(" ")}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt - REFRESH_MARGIN_MS) return hit.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(cfg),
    }),
  });

  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.access_token) {
    throw new Error(explain(res.status, body, cfg));
  }

  cache.set(key, { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 });
  return body.access_token;
}

/**
 * The two ways this setup is wrong are both admin mistakes, and both arrive as an opaque
 * OAuth error code. Naming them here is worth more than any amount of documentation,
 * because this is where somebody will be looking when it does not work.
 */
function explain(status: number, body: any, cfg: ServiceAccountConfig): string {
  const code = String(body?.error ?? "");
  const detail = String(body?.error_description ?? "").slice(0, 200);
  if (code === "unauthorized_client") {
    return (
      `service account: domain-wide delegation is not granted (${code}). A super-admin must add the ` +
      `service account's CLIENT ID for ${cfg.clientEmail} under Security -> Access and data control -> ` +
      `API controls -> Domain-wide delegation, with exactly these scopes: ${cfg.scopes.join(", ")}. ` +
      `Google says: ${detail}`
    );
  }
  if (code === "invalid_scope") {
    return (
      `service account: the scopes do not match the delegation grant character for character (${code}). ` +
      `Requested: ${cfg.scopes.join(", ")}. A grant for a different scope string, even a superset, is a ` +
      `different grant. Google says: ${detail}`
    );
  }
  if (code === "invalid_grant") {
    return (
      `service account: Google rejected the assertion (${code}). Usually the subject ` +
      `${cfg.subject} is not a real mailbox in this Workspace, or this machine's clock is wrong — ` +
      `the assertion carries iat/exp and a skewed clock invalidates it. Google says: ${detail}`
    );
  }
  return `service account: token exchange failed ${status} ${code}: ${detail}`;
}
