// Settings store — a single JSON row in Neon (id = 'singleton'). Falls back to
// DEFAULT_SETTINGS (draft-only) when the store isn't configured, so the app and
// the automation always have a safe launch posture.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { DEFAULT_SETTINGS, type Settings } from "./engine/types";

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

export async function getSettings(): Promise<Settings> {
  const sql = db();
  if (!sql) return { ...DEFAULT_SETTINGS };
  try {
    await ensure(sql);
    const rows = (await sql`SELECT value FROM app_settings WHERE id = 'singleton'`) as { value: Settings }[];
    return { ...DEFAULT_SETTINGS, ...(rows[0]?.value ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(next: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...next };
  const sql = db();
  if (!sql) return merged;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO app_settings (id, value, updated_at) VALUES ('singleton', ${JSON.stringify(merged)}, now())
      ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  } catch (err) {
    console.error("[settings] save failed", err);
  }
  return merged;
}
