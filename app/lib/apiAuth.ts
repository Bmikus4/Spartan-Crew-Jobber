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
