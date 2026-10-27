// The /api/settings handlers after their auth gate, IO injected for tests (SP-50).

import { getSettings, saveSettings, coerceSettings, settingsHistory } from "../settingsDb";
import type { Settings } from "../engine/types";
import { reportError } from "../errorReport";
import type { Caller } from "../apiAuth";

/**
 * THE SWITCHES THAT DECIDE WHETHER THE SYSTEM ACTS WITHOUT A PERSON: writes to OnSinch, and replies to
 * clients. Until 27 Oct any signed-in staff member could flip them, and nothing recorded who or when
 * (addendum F34). Only an admin (apiAuth isSwitchAdmin) may change one; each change is stored with
 * its actor and time and raised to the owner. The other settings stay any signed-in user's.
 */
export const SWITCHES = ["bot_writes_enabled", "replies_enabled", "reply_delivery"] as const;

export type SwitchChange = { field: string; from: unknown; to: unknown; actor: string; at: string };

export interface SettingsIO {
  get: () => ReturnType<typeof getSettings>;
  save: (next: Parameters<typeof saveSettings>[0]) => ReturnType<typeof saveSettings>;
  history: (change: SwitchChange) => Promise<void>;
  report: typeof reportError;
}

export const productionSettingsIO: SettingsIO = { get: () => getSettings(), save: (n) => saveSettings(n), history: (c) => settingsHistory(c), report: reportError };

export async function handleSettingsGet(io: SettingsIO = productionSettingsIO): Promise<Response> {
  try {
    return Response.json(await io.get());
  } catch {
    return Response.json({ ok: false, error: "settings could not be read" }, { status: 500 });
  }
}

export async function handleSettingsPost(request: Request, io: SettingsIO = productionSettingsIO, caller: Pick<Caller, "actor" | "admin"> = { actor: null, admin: false }): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const next = coerceSettings(body);
  let changes: SwitchChange[];
  try {
    const now = await io.get();
    const at = new Date().toISOString();
    changes = SWITCHES.filter((k) => next[k] !== undefined && next[k] !== now[k])
      .map((k) => ({ field: k, from: now[k], to: next[k], actor: caller.actor ?? "unknown", at }));
  } catch {
    // Without the current values a switch change cannot be told from a re-save, so nothing is written.
    return Response.json({ ok: false, error: "settings could not be read" }, { status: 500 });
  }
  if (changes.length && !caller.admin)
    return Response.json({ ok: false, error: `only an admin may change ${changes.map((c) => c.field).join(", ")}` }, { status: 403 });
  let saved: Settings;
  try {
    saved = await io.save(next);
  } catch {
    // It answered 200 "ok" when the write failed, so a switch looked flipped and was not (SP-17).
    return Response.json({ ok: false, error: "settings not saved" }, { status: 500 });
  }
  for (const c of changes) {
    // The record is written before the owner is told; a record that fails is said in the alert itself.
    const kept = await io.history(c).then(() => true, () => false);
    void io.report({ route: "settings-changed", where: `settings/${c.field}`, what: `${c.field} changed from ${JSON.stringify(c.from)} to ${JSON.stringify(c.to)} at ${c.at}`,
      detail: `by ${c.actor}${kept ? "" : "; the history row could not be written"}` });
  }
  return Response.json({ ok: true, settings: saved });
}
