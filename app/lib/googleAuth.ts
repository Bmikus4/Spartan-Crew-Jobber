// "Sign in with Google" via the OAuth 2.0 authorization-code flow, no extra deps.
// Confidential client: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (server-only).
// The id_token comes from Google's token endpoint over TLS in the server-to-
// server exchange, so it's authentic — we read the verified email from it.
import crypto from "node:crypto";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

export function googleConfigured(): boolean {
  return !!((process.env.GOOGLE_CLIENT_ID || "").trim() && (process.env.GOOGLE_CLIENT_SECRET || "").trim());
}

// Public origin for redirect URIs, derived from the real request host (APP_URL
// overrides). Register the callback URL in Google.
export function appOrigin(request: Request): string {
  const env = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

export function redirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

export function randomState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function buildAuthUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  // No `hd`. Google treats it as a hard filter, not a hint, so seeding it from the
  // first AUTH_ALLOWED_DOMAIN locked out everyone the allowlist admits by EMAIL —
  // Ben's own benjamintmikus@gmail.com among them, since samuraisolutions.co.uk is
  // not a Google account. The allowlist is enforced on the verified email in the
  // callback, which is the only place it can be enforced honestly anyway.
  return `${AUTHORIZE}?${p.toString()}`;
}

export interface GoogleIdentity { email: string; emailVerified: boolean; name: string }

export async function exchangeCode(origin: string, code: string): Promise<GoogleIdentity | null> {
  try {
    const body = new URLSearchParams({
      code,
      client_id: (process.env.GOOGLE_CLIENT_ID || "").trim(),
      client_secret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    });
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id_token?: string };
    if (!data.id_token) return null;
    const part = data.id_token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      email?: string; email_verified?: boolean | string; name?: string;
    };
    if (!payload.email) return null;
    return {
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
      name: payload.name || payload.email.split("@")[0],
    };
  } catch {
    return null;
  }
}
