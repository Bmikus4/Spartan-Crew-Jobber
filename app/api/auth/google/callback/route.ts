// Google redirects back with ?code&state. Verify state (CSRF), exchange the code,
// check the verified email against the allowlist, and set the iron-session.
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "../../../../lib/session";
import { appOrigin, exchangeCode } from "../../../../lib/googleAuth";
import { isAllowedEmail } from "../../../../lib/authAllowlist";

export async function GET(request: Request): Promise<Response> {
  const origin = appOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const c = await cookies();
  const saved = c.get("g_oauth_state")?.value;
  c.delete("g_oauth_state");

  if (!code || !state || !saved || state !== saved) {
    return Response.redirect(`${origin}/?authError=oauth_state`, 302);
  }

  const id = await exchangeCode(origin, code);
  if (!id || !id.emailVerified) {
    return Response.redirect(`${origin}/?authError=google_failed`, 302);
  }
  if (!isAllowedEmail(id.email)) {
    return Response.redirect(`${origin}/?authError=not_allowed`, 302);
  }

  const session = await getIronSession<SessionData>(c, sessionOptions);
  session.name = id.name;
  session.email = id.email;
  session.isAdmin = false;
  await session.save();

  return Response.redirect(`${origin}/?signedIn=1`, 302);
}
