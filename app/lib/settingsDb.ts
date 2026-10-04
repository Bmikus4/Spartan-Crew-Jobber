// Settings store — a single JSON row in Neon (id = 'singleton'). Falls back to
// DEFAULT_SETTINGS (draft-only) when the store isn't configured, so the app and
// the automation always have a safe launch posture.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { DEFAULT_SETTINGS, type Settings } from "./engine/types";
import { reportError } from "./errorReport";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function connString(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
}
function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = connString();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}
async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  _ready = true;
}

/**
 * Whitelist an untrusted partial update. Lives here rather than inline in the
 * route so the tests exercise the REAL rule instead of a copy that can drift.
 *
 * Every field must be listed. It previously accepted only the retired order_mode, so the
 * Settings screen's replies toggle POSTed replies_enabled and it was dropped on
 * the floor - the toggle looked like it worked and changed nothing.
 */
export function coerceSettings(body: unknown): Partial<Settings> {
  const b = (body ?? {}) as Record<string, unknown>;
  const next: Partial<Settings> = {};
  if (typeof b.replies_enabled === "boolean") next.replies_enabled = b.replies_enabled;
  if (b.reply_delivery === "draft" || b.reply_delivery === "send") next.reply_delivery = b.reply_delivery;
  if (b.reply_scope === "all" || b.reply_scope === "enquiries") next.reply_scope = b.reply_scope;
  // 0 is a real value here - it means "no fallback, hold the thread" - so this
  // accepts any non-negative integer rather than treating 0 as absent.
  if (typeof b.default_rate_card === "number" && Number.isInteger(b.default_rate_card) && b.default_rate_card >= 0)
    next.default_rate_card = b.default_rate_card;
  return next;
}

/**
 * What the engine reports to n8n's reply subflow. Replies being OFF pins delivery
 * to "draft" regardless of the stored value, so a stale "send" can never email a
 * client while the master switch is off.
 */
export function replyDeliveryForWire(s: Settings): { enabled: boolean; delivery: "draft" | "send" } {
  return { enabled: s.replies_enabled, delivery: s.replies_enabled ? s.reply_delivery : "draft" };
}

/**
 * With a database configured, a failed read THROWS (SP-17). It returned the defaults, so a
 * Neon blip priced the next order at the default rate card (315, types.ts) and reset the
 * reply switches with nobody told. On intake the throw lands in the route's catch, which
 * holds the email for the sweep (SP-15). No database at all is still the defaults: that is
 * a local run, not a failure. `sql` is injected by tests.
 */
export async function getSettings(sql: NeonQueryFunction<false, false> | null = db()): Promise<Settings> {
  if (!sql) return { ...DEFAULT_SETTINGS };
  try {
    await ensure(sql);
    const rows = (await sql`SELECT value FROM app_settings WHERE id = 'singleton'`) as { value: Settings }[];
    return { ...DEFAULT_SETTINGS, ...(rows[0]?.value ?? {}) };
  } catch (err) {
    void reportError({
      route: "engine-threw", where: "settings/read", severity: "alert",
      what: "the settings could not be read, so nothing that depends on them ran",
      detail: String((err as Error)?.message ?? err),
    });
    throw err;
  }
}

/** Throws when the write fails, so the Settings screen is never told "saved" for nothing. */
export async function saveSettings(next: Partial<Settings>, sql: NeonQueryFunction<false, false> | null = db()): Promise<Settings> {
  const merged = { ...(await getSettings(sql)), ...next };
  if (!sql) return merged;
  await ensure(sql);
  await sql`
    INSERT INTO app_settings (id, value, updated_at) VALUES ('singleton', ${JSON.stringify(merged)}, now())
    ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return merged;
}
