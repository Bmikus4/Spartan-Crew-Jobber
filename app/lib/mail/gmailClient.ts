// ============================================================================
// A Gmail reader for the app, on whichever credential is configured.
// ----------------------------------------------------------------------------
// scripts/sweep-gmail.ts has carried this logic for months against the live mailbox;
// this is the same behaviour where the RUNTIME can reach it, because the poller runs on
// Vercel and not from a terminal.
//
// The backoff is not generic politeness. Gmail signals its per-user rate limit as a 403
// with a `rateLimitExceeded` reason, NOT a 429, so treating 403 as fatal aborts a poll
// for a condition that clears in under a second — while a plain 403 (revoked, wrong
// scope) must still fail immediately and loudly. Telling those two apart is the whole of
// this file.
//
// `status` is attached to the thrown error because gmailCursor keys on it: a 404 from
// history.list is an expired cursor and a normal event, and anything else is not.
// ============================================================================
import { gmailAccessToken, GMAIL_READ_SCOPES, GMAIL_WRITE_SCOPES } from "./gmailAuth";

const API_BASE = (process.env.GMAIL_API_BASE || "https://gmail.googleapis.com/gmail/v1/users/me").replace(/\/$/, "");

export interface GmailClientOpts {
  scopes?: string[];
  /** Only used when no service account is configured; the poller does not supply one. */
  refreshToken?: () => Promise<string>;
}

export function gmailClient(opts: GmailClientOpts = {}) {
  const scopes = opts.scopes ?? GMAIL_READ_SCOPES;

  return async function get(path: string, attempt = 0): Promise<any> {
    const { token } = await gmailAccessToken({ scopes, refreshToken: opts.refreshToken });
    const res = await fetch(`${API_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });

    let body = "";
    let rateLimited403 = false;
    if (res.status === 403) {
      body = await res.text();
      rateLimited403 = /rateLimitExceeded|userRateLimitExceeded|backendError/i.test(body);
    }

    if (res.status === 429 || res.status >= 500 || rateLimited403) {
      if (attempt >= 4) {
        throw Object.assign(new Error(`gmail ${path} -> ${res.status} after ${attempt} retries`), { status: res.status });
      }
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      return get(path, attempt + 1);
    }

    if (!res.ok) {
      const detail = body || (await res.text().catch(() => ""));
      // status rides along: gmailCursor treats 404 as an expired history id and nothing else.
      throw Object.assign(new Error(`gmail ${path} -> ${res.status}: ${detail.slice(0, 300)}`), { status: res.status });
    }
    return res.json();
  };
}

/**
 * One message as raw RFC 822, plus the thread it belongs to.
 *
 * RAW is asked for rather than Gmail's parsed `payload` so the message goes through
 * app/lib/mail/rfc822.ts — the same parser the webhook intake uses, with the same tests
 * behind it. One parser, one set of edge cases, whichever door the mail came through.
 *
 * `threadId` is Gmail's own grouping and is authoritative. Header threading exists for
 * the case where nobody hands us one; when Gmail does, guessing would be strictly worse
 * (measured: 1 thread in 40 splits on headers alone).
 */
export async function getRawMessage(get: (path: string) => Promise<any>, id: string): Promise<{ raw: string; threadId: string } | null> {
  const msg = await get(`messages/${encodeURIComponent(id)}?format=RAW`);
  if (!msg?.raw) return null;
  return { raw: Buffer.from(String(msg.raw), "base64url").toString("utf8"), threadId: String(msg.threadId ?? "") };
}

/**
 * A Gmail client that can also WRITE — labels and drafts.
 *
 * Separate from gmailClient because the SCOPE is different and domain-wide delegation
 * matches scope strings character for character: asking for modify on a grant made for
 * readonly fails with invalid_scope, and the remedy is an admin edit rather than a code
 * change. Keeping the two apart means a read-only deployment stays read-only rather than
 * silently requesting a permission it was never given.
 */
export function gmailWriter(opts: GmailClientOpts = {}) {
  const scopes = opts.scopes ?? GMAIL_WRITE_SCOPES;

  return async function api(method: string, path: string, body?: any, attempt = 0): Promise<any> {
    const { token } = await gmailAccessToken({ scopes, refreshToken: opts.refreshToken });
    const res = await fetch(`${API_BASE}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

    let text = "";
    let rateLimited403 = false;
    if (res.status === 403) {
      text = await res.text();
      rateLimited403 = /rateLimitExceeded|userRateLimitExceeded|backendError/i.test(text);
    }
    if (res.status === 429 || res.status >= 500 || rateLimited403) {
      if (attempt >= 3) throw Object.assign(new Error(`gmail ${method} ${path} -> ${res.status}`), { status: res.status });
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      return api(method, path, body, attempt + 1);
    }
    if (!res.ok) {
      const detail = text || (await res.text().catch(() => ""));
      throw Object.assign(new Error(`gmail ${method} ${path} -> ${res.status}: ${detail.slice(0, 300)}`), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  };
}
