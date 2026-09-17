// ============================================================================
// ONE PLACE THAT ANSWERS "a bearer token for the bookings mailbox".
// ----------------------------------------------------------------------------
// Two credentials can produce that token and they fail completely differently:
//
//   service account + domain-wide delegation   granted by an ADMIN against the client
//                                              id. A password change does nothing to it.
//   refresh token                              granted by a USER against a session.
//                                              Revoked when the mailbox password changes,
//                                              which cost five days of intake in 2026.
//
// The service account wins whenever it is configured, and the refresh token stays as the
// fallback so nothing breaks before the delegation grant exists. That is what makes the
// migration incremental rather than a cutover: set three variables and every Gmail read
// in the repo moves, with no caller changing at all.
//
// WHICH ONE IS LIVE IS REPORTED, not inferred. A silent fallback to the fragile
// credential is exactly how the last outage stayed invisible for 42 hours — the sweep
// kept working, nobody looked, and the thing that was actually broken was the thing
// nothing said out loud.
// ============================================================================
import { serviceAccountToken, type ServiceAccountConfig } from "./serviceAccountToken";

/** The mailbox everything here reads. One tenant today; the subject for delegation. */
export const BOOKINGS_MAILBOX = process.env.GMAIL_SUBJECT?.trim() || "bookings@spartancrew.co.uk";

export const GMAIL_READ_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/**
 * Labels and drafts. `gmail.modify` covers reading too, so a deployment that writes needs
 * only this one — but delegation matches scope strings CHARACTER FOR CHARACTER, so the
 * admin grant must list exactly what is asked for here. Granting readonly and later
 * wanting modify means editing the grant, not the code.
 */
export const GMAIL_WRITE_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

export type TokenSource = "service-account" | "refresh-token";

type Env = { readonly [key: string]: string | undefined };

function saConfig(env: Env, scopes: string[]): ServiceAccountConfig | null {
  const clientEmail = env.GMAIL_SA_CLIENT_EMAIL?.trim();
  const privateKey = env.GMAIL_SA_PRIVATE_KEY?.trim();
  if (!clientEmail || !privateKey) return null;
  return { clientEmail, privateKey, subject: env.GMAIL_SUBJECT?.trim() || BOOKINGS_MAILBOX, scopes };
}

/**
 * Which credential a token would come from right now.
 *
 * Both halves are required. A client email with no key is a half-finished setup, and
 * treating it as "configured" would fail every read with a signing error rather than
 * quietly using the credential that still works.
 */
export function tokenSource(env: Env = process.env, scopes: string[] = GMAIL_READ_SCOPES): TokenSource {
  return saConfig(env, scopes) ? "service-account" : "refresh-token";
}

export function serviceAccountConfigured(env: Env = process.env): boolean {
  return tokenSource(env) === "service-account";
}

/**
 * A bearer token for the bookings mailbox, from whichever credential is configured.
 *
 * Deliberately NOT falling back from a failing service account to the refresh token. If
 * delegation is set up and broken, that is a thing to fix and be told about; silently
 * reverting to the credential a password change can kill would reintroduce the exact
 * failure this was built to remove, at the moment it is least expected.
 */
export async function gmailAccessToken(
  opts: { env?: Env; scopes?: string[]; refreshToken?: () => Promise<string> } = {},
): Promise<{ token: string; source: TokenSource }> {
  const env = opts.env ?? process.env;
  const scopes = opts.scopes ?? GMAIL_READ_SCOPES;
  const sa = saConfig(env, scopes);
  if (sa) return { token: await serviceAccountToken(sa), source: "service-account" };

  if (!opts.refreshToken) {
    throw new Error(
      "no Gmail credential: set GMAIL_SA_CLIENT_EMAIL and GMAIL_SA_PRIVATE_KEY for the service " +
      "account (preferred — a password change cannot revoke it), or pass a refresh-token fetcher.",
    );
  }
  return { token: await opts.refreshToken(), source: "refresh-token" };
}
