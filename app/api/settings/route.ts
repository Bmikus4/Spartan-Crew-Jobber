export const runtime = "nodejs";

// Settings read/write for the Settings screen. GET returns current settings;
// POST persists a partial update. The launch default is draft-only.
//
// The whitelist lives in settingsDb.coerceSettings so the route and the tests
// share one rule — it used to be inline here and accepted only order_mode, which
// silently discarded the replies toggle.

import { getSettings, saveSettings, coerceSettings } from "../../lib/settingsDb";
import { authorizeAction } from "../../lib/apiAuth";

export async function GET(): Promise<Response> {
  return Response.json(await getSettings());
}

/**
 * WHO IS CALLING is decided first. This route accepted anonymous writes in
 * production — 200 to anyone with the URL — and what it writes is
 * `replies_enabled` and `reply_delivery`, the pair that decides whether the
 * engine emails clients with no human reading the draft, plus the rate card that
 * prices invoices. middleware.ts looks like the gate and is not: it enforces
 * nothing until AUTH_REQUIRED === "true", which is set nowhere.
 *
 * authorizeAction accepts either a signed-in session or the webhook secret, so
 * the Settings screen keeps working: a human sends the session cookie the
 * break-glass sign-in (`/?admin=<ADMIN_SECRET>`) or Google leaves behind.
 */
export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const saved = await saveSettings(coerceSettings(body));
  return Response.json({ ok: true, settings: saved });
}
