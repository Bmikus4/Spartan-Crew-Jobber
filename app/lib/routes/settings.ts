// The /api/settings handlers after their auth gate, IO injected for tests (SP-50).

import { getSettings, saveSettings, coerceSettings } from "../settingsDb";

export interface SettingsIO {
  get: () => ReturnType<typeof getSettings>;
  save: (next: Parameters<typeof saveSettings>[0]) => ReturnType<typeof saveSettings>;
}

export const productionSettingsIO: SettingsIO = { get: () => getSettings(), save: (n) => saveSettings(n) };

export async function handleSettingsGet(io: SettingsIO = productionSettingsIO): Promise<Response> {
  try {
    return Response.json(await io.get());
  } catch {
    return Response.json({ ok: false, error: "settings could not be read" }, { status: 500 });
  }
}

export async function handleSettingsPost(request: Request, io: SettingsIO = productionSettingsIO): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  try {
    const saved = await io.save(coerceSettings(body));
    return Response.json({ ok: true, settings: saved });
  } catch {
    // It answered 200 "ok" when the write failed, so a switch looked flipped and was not (SP-17).
    return Response.json({ ok: false, error: "settings not saved" }, { status: 500 });
  }
}
