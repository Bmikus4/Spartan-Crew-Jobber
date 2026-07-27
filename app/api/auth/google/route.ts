// Start Google sign-in: stash a CSRF "state" in an httpOnly cookie, redirect to
// Google's consent screen.
import { cookies } from "next/headers";
import { appOrigin, buildAuthUrl, googleConfigured, randomState } from "../../../lib/googleAuth";

export async function GET(request: Request): Promise<Response> {
  const origin = appOrigin(request);
  if (!googleConfigured()) {
    return Response.redirect(`${origin}/?authError=google_unconfigured`, 302);
  }
  const state = randomState();
  const c = await cookies();
  c.set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return Response.redirect(buildAuthUrl(origin, state), 302);
}
