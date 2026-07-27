import { getIronSession } from "iron-session";
import { NextRequest, NextResponse } from "next/server";
import type { SessionData } from "./app/lib/session";
import { sessionOptions } from "./app/lib/session";
import { safeEqual } from "./app/lib/safeEqual";

// Gate /api/* behind a logged-in iron-session. Pages render the login screen
// client-side; every data/action call goes through /api/*, so gating the API
// locks the app to the internal team.
//
// Master switch: enforcement is OFF until AUTH_REQUIRED="true", so deploying is
// non-breaking — the lock turns on only once Google sign-in is set up + verified.
//
// Never require a human session for:
//  - /api/auth*         the login flow itself (Google OAuth + session probe)
//  - /api/n8n-inbound    authenticated by its own N8N_WEBHOOK_SECRET
const SKIP = ["/api/auth", "/api/n8n-inbound"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (process.env.AUTH_REQUIRED !== "true") return NextResponse.next();
  if (SKIP.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  // Server-to-server calls carry the internal shared secret instead of a cookie.
  const internal = (process.env.INTERNAL_API_SECRET || "").trim();
  if (internal && safeEqual(req.headers.get("x-internal-secret") || "", internal)) return NextResponse.next();

  const res = NextResponse.next();
  try {
    const session = await getIronSession<SessionData>(req, res, sessionOptions);
    if (!session.name) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return res;
}

export const config = { matcher: "/api/:path*" };
