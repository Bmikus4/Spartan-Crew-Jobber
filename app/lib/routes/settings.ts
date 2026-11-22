// The /api/settings handlers after their auth gate, IO injected for tests (SP-50).

import { getSettings, saveSettings, coerceSettings, settingsHistory } from "../settingsDb";
import type { Settings } from "../onsinch/types";
import { reportError } from "../errorReport";
import type { Caller } from "../apiAuth";

/**
 * THE SWITCHES THAT DECIDE WHETHER THE SYSTEM ACTS WITHOUT A PERSON: writes to OnSinch, replies to clients, and
 * the lead rule that hands near work to staff. Each change is stored with its actor and time and raised to the
 * owner (addendum F34; the lead rule joined on 28 Oct, DECISIONS O8). Who may change them is CLIENT_FIELDS below.
 */
export const SWITCHES = ["bot_writes_enabled", "bot_write_classes", "replies_enabled", "reply_delivery", "create_lead_enabled", "create_lead_days", "create_lead_applies_to"] as const;

/**
 * THE ONLY SETTINGS A CLIENT SEES OR SENDS (Ben, 21 Nov, stop B): everything else is the Samurai team's
 * (apiAuth isSwitchAdmin). The server is the lock: the GET returns these fields alone to anyone else, and the
 * POST refuses a body naming any other field. The Settings screen hiding the Samurai panels is a courtesy that
 * locks nothing. A field added here becomes readable and writable by every signed-in Spartan staff member.
 */
export const CLIENT_FIELDS = ["needs_created_enabled"] as const;

export type SwitchChange = { field: string; from: unknown; to: unknown; actor: string; at: string };

export interface SettingsIO {
  get: () => ReturnType<typeof getSettings>;
  save: (next: Parameters<typeof saveSettings>[0]) => ReturnType<typeof saveSettings>;
  history: (change: SwitchChange) => Promise<void>;
  report: typeof reportError;
}

export const productionSettingsIO: SettingsIO = { get: () => getSettings(), save: (n) => saveSettings(n), history: (c) => settingsHistory(c), report: reportError };

type Who = Pick<Caller, "actor" | "admin">;
const NOBODY: Who = { actor: null, admin: false };

/** `samurai` tells the screen which panels to draw; it is not a setting and is never saved. */
export async function handleSettingsGet(io: SettingsIO = productionSettingsIO, caller: Who = NOBODY): Promise<Response> {
  let s: Settings;
  try { s = await io.get(); } catch {
    return Response.json({ ok: false, error: "settings could not be read" }, { status: 500 });
  }
  if (caller.admin) return Response.json({ ...s, samurai: true });
  // needs_created_enabled is false unless explicitly true (S-0338), so a client reads the same value the TV applies.
  return Response.json({ needs_created_enabled: s.needs_created_enabled === true, samurai: false });
}

export async function handleSettingsPost(request: Request, io: SettingsIO = productionSettingsIO, caller: Who = NOBODY): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!caller.admin) {
    // The raw keys, not the whitelisted ones: a client body naming any other field is refused whole, never trimmed
    // to the part it may send, so a screen that still sends the full row fails loudly instead of half-saving.
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
    const refused = keys.filter((k) => !(CLIENT_FIELDS as readonly string[]).includes(k));
    if (refused.length || !keys.length)
      return Response.json({ ok: false, error: refused.length ? `only the Samurai team may change ${refused.join(", ")}` : "nothing to change" }, { status: 403 });
  }
  const next = coerceSettings(body);
  let changes: SwitchChange[];
  try {
    const now = await io.get();
    const at = new Date().toISOString();
    // Stringified, not ===: bot_write_classes is an object, and a re-save of the same map is not a change.
    changes = SWITCHES.filter((k) => next[k] !== undefined && JSON.stringify(next[k]) !== JSON.stringify(now[k]))
      .map((k) => ({ field: k, from: now[k], to: next[k], actor: caller.actor ?? "unknown", at }));
  } catch {
    // Without the current values a switch change cannot be told from a re-save, so nothing is written.
    return Response.json({ ok: false, error: "settings could not be read" }, { status: 500 });
  }
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
  // A client is answered with its own fields only, as the GET would.
  return Response.json({ ok: true, settings: caller.admin ? saved : { needs_created_enabled: saved.needs_created_enabled === true } });
}
