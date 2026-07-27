import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "../../lib/session";
import { safeEqual } from "../../lib/safeEqual";

// Google-only auth. GET = session probe (also reports whether auth is enforced,
// so the client only hard-gates when it should). POST mode:"admin" = break-glass.
// DELETE = logout. User entry point is Google OAuth at GET /api/auth/google.

export async function GET(): Promise<Response> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const authRequired = process.env.AUTH_REQUIRED === "true";
  if (!session.name) return Response.json({ authenticated: false, authRequired });
  return Response.json({ authenticated: true, authRequired, name: session.name, email: session.email, isAdmin: !!session.isAdmin });
}

export async function POST(request: Request) {
  const { mode, secret } = await request.json().catch(() => ({}));
  if (mode === "admin") {
    const adminSecret = (process.env.ADMIN_SECRET || "").trim();
    if (!adminSecret || typeof secret !== "string" || !safeEqual(secret, adminSecret)) {
      return Response.json({ error: "Invalid admin secret" }, { status: 401 });
    }
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
    session.name = "Admin";
    session.email = "admin@spartancrew.co.uk";
    session.isAdmin = true;
    await session.save();
    return Response.json({ success: true, name: "Admin", email: "admin@spartancrew.co.uk" });
  }
  return Response.json({ error: "Email login is disabled — please sign in with Google." }, { status: 410 });
}

export async function DELETE() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.destroy();
  return Response.json({ success: true });
}
