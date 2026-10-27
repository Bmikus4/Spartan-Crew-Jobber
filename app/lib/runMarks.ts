// When each timed run last finished, and whether every step in it succeeded: what the heartbeat
// reads (heartbeat.ts). One row per run name, overwritten each time; the history is not kept.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { ensureSchema } from "./migrations";

export type RunName = "sync" | "labels";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;
async function db(): Promise<NeonQueryFunction<false, false>> {
  if (!_sql) {
    const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
    if (!url) throw new Error("no database configured");
    _sql = neon(url);
  }
  if (!_ready) {
    await ensureSchema(_sql);
    _ready = true;
  }
  return _sql;
}

export async function markRun(name: RunName, ok: boolean, detail: unknown = null): Promise<void> {
  const sql = await db();
  await sql`INSERT INTO run_marks (name, at, ok, detail) VALUES (${name}, now(), ${ok}, ${JSON.stringify(detail)}::jsonb)
    ON CONFLICT (name) DO UPDATE SET at = EXCLUDED.at, ok = EXCLUDED.ok, detail = EXCLUDED.detail`;
}

export async function lastRun(name: RunName): Promise<number | null> {
  const sql = await db();
  const [r] = (await sql`SELECT at FROM run_marks WHERE name = ${name}`) as any[];
  return r ? Date.parse(String(r.at instanceof Date ? r.at.toISOString() : r.at)) : null;
}
