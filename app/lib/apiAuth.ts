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
  /** the signer's display name, for a screen to show; the actor stays the audit identity */
  name?: string | null;
  /** may change the write and reply switches (isSwitchAdmin); a service caller never may */
  admin?: boolean;
}

/**
 * WHO MAY TURN THE WRITE AND REPLY SWITCHES (addendum F34): the break-glass admin session, the
 * owner's own addresses, and any address in SPARTAN_ADMIN_EMAILS. Until 27 Oct any signed-in staff
 * member could, and isAdmin was read nowhere. The owner's addresses are the default; the env list is
 * the dial (DECISIONS A1).
 */
const OWNER_EMAILS = ["ben@samuraisolutions.co.uk", "benjamintmikus@gmail.com"];
export function isSwitchAdmin(email: string | null | undefined, sessionIsAdmin = false): boolean {
  if (sessionIsAdmin) return true;
  const e = (email || "").trim().toLowerCase();
  const extra = (process.env.SPARTAN_ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return !!e && (OWNER_EMAILS.includes(e) || extra.includes(e));
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
  if (i.sessionName) return { ok: true, kind: "human", actor: i.sessionEmail || i.sessionName, name: i.sessionName };
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
  let sessionIsAdmin = false;
  try {
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
    sessionName = session.name || null;
    sessionEmail = session.email || null;
    sessionIsAdmin = session.isAdmin === true;
  } catch {
    /* no or undecryptable cookie - treated as no session */
  }

  const caller = decideCaller({
    secretMatches: Boolean(secret && presented && safeEqual(presented, secret)),
    secretConfigured: Boolean(secret),
    sessionName,
    sessionEmail,
    authRequired: process.env.AUTH_REQUIRED === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
  return { ...caller, admin: caller.kind === "human" && isSwitchAdmin(sessionEmail, sessionIsAdmin) };
}

/**
 * The same decision for a route that only ever has a MACHINE caller.
 *
 * /api/n8n-inbound and /api/dedupe sit in the middleware SKIP list,
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
 * The same decision for a VERCEL CRON, which cannot send `x-webhook-secret` either.
 *
 * Vercel invokes a cron with `Authorization: Bearer $CRON_SECRET` and no way to add a
 * header of our own, so only the PRESENTATION of
 * the secret is re-implemented and the decision itself stays in decideMachineCall. A
 * manual trigger carrying `x-webhook-secret` is still accepted, because being able to
 * run the poll by hand is how it gets tested.
 *
 * ONCE CRON_SECRET IS SET, THE INTAKE SECRET NO LONGER OPENS THESE ROUTES (addendum F3).
 * The minute sync retries writes to OnSinch, and N8N_WEBHOOK_SECRET sits in every n8n intake
 * node, so a leak of it must not be enough to drive the sync or the labels. Until CRON_SECRET
 * is set the intake secret is still accepted: the n8n minute schedule is what runs the sync
 * until the switch-over in ADDENDUM R3, and refusing it first would leave nothing running.
 */
export function authorizeCronCall(request: Request): Caller {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const machineSecret = (process.env.N8N_WEBHOOK_SECRET || "").trim();

  const presented: string[] = [request.headers.get("x-webhook-secret") || ""];
  const auth = request.headers.get("authorization") || "";
  if (/^bearer /i.test(auth)) presented.push(auth.slice(7).trim());

  const secrets = (cronSecret ? [cronSecret] : [machineSecret]).filter(Boolean);
  return decideMachineCall({
    secretMatches: secrets.some((s) => presented.some((p) => p !== "" && safeEqual(p, s))),
    secretConfigured: secrets.length > 0,
    authRequired: process.env.AUTH_REQUIRED === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
}

/**
 * The OnSinch browser bot (/api/bot/*). Its own secret, BOT_SECRET in `x-bot-secret`, and
 * deliberately not N8N_WEBHOOK_SECRET: the bot writes to OnSinch, and a leak of the intake
 * secret must not be enough to drive it. No session is consulted, so a logged-in dashboard
 * user cannot make the bot write. The decision is decideMachineCall's, like every gate here.
 */
export function authorizeBotCall(request: Request): Caller {
  const secret = (process.env.BOT_SECRET || "").trim();
  const presented = request.headers.get("x-bot-secret") || "";
  return decideMachineCall({
    secretMatches: Boolean(secret && presented && safeEqual(presented, secret)),
    secretConfigured: Boolean(secret),
    authRequired: process.env.AUTH_REQUIRED === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
}
