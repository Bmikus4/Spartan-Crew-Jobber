export const runtime = "nodejs";

// Settings read/write for the Settings screen. GET returns current settings;
// POST persists a partial update. The launch default is draft-only.
//
// The whitelist lives in settingsDb.coerceSettings so the route and the tests
// share one rule — it used to be inline here and accepted only order_mode, which
// silently discarded the replies toggle.

import { getSettings, saveSettings, coerceSettings } from "../../lib/settingsDb";

export async function GET(): Promise<Response> {
  return Response.json(await getSettings());
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const saved = await saveSettings(coerceSettings(body));
  return Response.json({ ok: true, settings: saved });
}
