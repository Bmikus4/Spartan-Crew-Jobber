// ============================================================================
// Shared authorisation for the action routes.
// ----------------------------------------------------------------------------
// Two legitimate kinds of caller, and they authenticate differently:
//   - a signed-in human on the Jobs Board  -> iron-session cookie
//   - n8n / a script                        -> x-webhook-secret header
//
// confirm-order originally accepted ONLY the header, which quietly broke the
// feature draft-only mode exists for: a human clicking "confirm" sends a session
// cookie, not the secret, so the browser got 401 and the staged order could never
// be approved from the UI.
//
// The decision is split out as a PURE function (decideCaller) because the branch
// that matters most - "nothing configured, nobody signed in" - must fail closed in
// production, and that is not something to verify by reading. See test/apiAuth.ts.
// ============================================================================
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "./session";
import { safeEqual } from "./safeEqual";

export interface Caller {
  ok: boolean;
  kind: "human" | "service" | null;
  /** who to attribute the action to, for the audit trail */
  actor: string | null;
}

export interface CallerInputs {
  /** the presented secret matched the configured one */
  secretMatches: boolean;
  /** a secret is configured at all */
  secretConfigured: boolean;
  /** session identity, when a decryptable session cookie was present */
  sessionName?: string | null;
  sessionEmail?: string | null;
  /** AUTH_REQUIRED === "true" */
  authRequired: boolean;
  /** NODE_ENV === "production" */
  isProduction: boolean;
}

/**
 * The whole authorisation decision, with no I/O.
 *
 * Order matters: a valid secret wins first (cheap, and how n8n calls), then a
 * session. The last branch is the dangerous one - with no secret configured, no
 * session, and auth not enforced, we allow ONLY outside production, so a
 * misconfigured deploy cannot leave an OnSinch-writing endpoint open.
 */
export function decideCaller(i: CallerInputs): Caller {
  if (i.secretMatches) return { ok: true, kind: "service", actor: "n8n" };
  if (i.sessionName) return { ok: true, kind: "human", actor: i.sessionEmail || i.sessionName };
  if (!i.secretConfigured && !i.authRequired && !i.isProduction) {
    return { ok: true, kind: "service", actor: "dev" };
  }
  return { ok: false, kind: null, actor: null };
}

/** Authorise an action route: a valid session OR the shared secret. */
export async function authorizeAction(request: Request): Promise<Caller> {
  const secret = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  const presented = request.headers.get("x-webhook-secret") || "";

  let sessionName: string | null = null;
  let sessionEmail: string | null = null;
  try {
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
    sessionName = session.name || null;
    sessionEmail = session.email || null;
  } catch {
    /* no or undecryptable cookie - treated as no session */
  }

  return decideCaller({
    secretMatches: Boolean(secret && presented && safeEqual(presented, secret)),
    secretConfigured: Boolean(secret),
    sessionName,
    sessionEmail,
    authRequired: process.env.AUTH_REQUIRED === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
}

/**
 * The same decision for a route that only ever has a MACHINE caller.
 *
 * /api/n8n-inbound, /api/dedupe and /api/sweep-ingest sit in the middleware SKIP list,
 * so the check inside each route is the only gate in front of them — and each had
 * written that check by hand as `if (!secret) return true`, with the production guard
 * that decideCaller already had simply missing. On a preview deployment, where
 * N8N_WEBHOOK_SECRET is not set but the database variables are, that made every preview
 * URL an unauthenticated write into the production database.
 *
 * No session is consulted. A human clicking "confirm" is a legitimate caller of an
 * action route; nothing in the UI posts an inbound email, so admitting a cookie here
 * would widen the door for no caller that exists.
 */
export function decideMachineCall(i: Omit<CallerInputs, "sessionName" | "sessionEmail">): Caller {
  return decideCaller({ ...i, sessionName: null, sessionEmail: null });
}

/** decideMachineCall, reading the presented header and the environment. */
export function authorizeMachineCall(request: Request): Caller {
  const secret = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  const presented = request.headers.get("x-webhook-secret") || "";
  return decideMachineCall({
    secretMatches: Boolean(secret && presented && safeEqual(presented, secret)),
    secretConfigured: Boolean(secret),
    authRequired: process.env.AUTH_REQUIRED === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
}

/**
 * The same decision for /api/mail-inbound, whose caller CANNOT SEND A HEADER.
 *
 * SendGrid Inbound Parse, Mailgun routes and CloudMailin each POST a fixed request
 * shape with no way to add `x-webhook-secret`. What all of them do support is a
 * secret carried in the webhook URL: HTTP Basic credentials, or a query parameter.
 *
 * Only the PRESENTATION of the secret differs, so only that is re-implemented — the
 * decision itself is still decideMachineCall. Writing a second gate by hand is how
 * /api/n8n-inbound ended up with `if (secret && ...)`, which made every preview
 * deployment an unauthenticated way into the production database; test/machineRouteAuth
 * caught this route repeating that shape on the day it was written.
 */
export function authorizeMailWebhook(request: Request): Caller {
  const secret = (process.env.MAIL_INBOUND_SECRET || process.env.N8N_WEBHOOK_SECRET || "").trim();

  const presented: string[] = [request.headers.get("x-webhook-secret") || ""];
  try { presented.push(new URL(request.url).searchParams.get("k") || ""); } catch { /* not a URL we can read */ }
  const basic = request.headers.get("authorization") || "";
  if (/^basic /i.test(basic)) {
    try {
      const decoded = Buffer.from(basic.slice(6).trim(), "base64").toString("utf8");
      // Only the password half. The username is the provider's own label and varies.
      presented.push(decoded.slice(decoded.indexOf(":") + 1));
    } catch { /* an undecodable header is simply not a match */ }
  }

  return decideMachineCall({
    secretMatches: Boolean(secret) && presented.some((p) => p !== "" && safeEqual(p, secret)),
    secretConfigured: Boolean(secret),
    authRequired: process.env.AUTH_REQUIRED === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
}

/**
 * The same decision for a VERCEL CRON, which cannot send `x-webhook-secret` either.
 *
 * Vercel invokes a cron with `Authorization: Bearer $CRON_SECRET` and no way to add a
 * header of our own, so — exactly as with the mail webhook — only the PRESENTATION of
 * the secret is re-implemented and the decision itself stays in decideMachineCall. A
 * manual trigger carrying `x-webhook-secret` is still accepted, because being able to
 * run the poll by hand is how it gets tested.
 *
 * CRON_SECRET is Vercel's own variable name and it sets it automatically on Pro; the
 * shared machine secret is accepted as well so a deployment that has one but not the
 * other is not silently unreachable.
 */
export function authorizeCronCall(request: Request): Caller {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const machineSecret = (process.env.N8N_WEBHOOK_SECRET || "").trim();

  const presented: string[] = [request.headers.get("x-webhook-secret") || ""];
  const auth = request.headers.get("authorization") || "";
  if (/^bearer /i.test(auth)) presented.push(auth.slice(7).trim());

  const secrets = [cronSecret, machineSecret].filter(Boolean);
  return decideMachineCall({
    secretMatches: secrets.some((s) => presented.some((p) => p !== "" && safeEqual(p, s))),
    secretConfigured: secrets.length > 0,
    authRequired: process.env.AUTH_REQUIRED === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
}
