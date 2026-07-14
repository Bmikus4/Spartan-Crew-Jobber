export const runtime = "nodejs";

// Settings read/write for the Settings screen. GET returns current settings;
// POST persists a partial update. The launch default is draft-only.

import { getSettings, saveSettings } from "../../lib/settingsDb";
import type { Settings } from "../../lib/engine/types";

export async function GET(): Promise<Response> {
  return Response.json(await getSettings());
}

export async function POST(request: Request): Promise<Response> {
  let body: Partial<Settings>;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const next: Partial<Settings> = {};
  if (body.order_mode === "draft-only" || body.order_mode === "auto") next.order_mode = body.order_mode;
  const saved = await saveSettings(next);
  return Response.json({ ok: true, settings: saved });
}
