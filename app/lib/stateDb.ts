// Neon-backed StateStore — the Save State Table. One row per Gmail thread; the
// whole ConversationState is stored as JSONB (the engine owns the shape). This
// is the dedup key + the confirm queue's data source. Implements the engine's
// StateStore so the pipeline is storage-agnostic.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { StateStore } from "./engine/store";
import type { ConversationState } from "./engine/types";

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
  await sql`
    CREATE TABLE IF NOT EXISTS conversation_state (
      thread_id TEXT PRIMARY KEY,
      status TEXT,
      needs_human BOOLEAN,
      onsinch_order_id BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      state JSONB NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS conversation_state_status ON conversation_state (status)`;
  _ready = true;
}

export class NeonStateStore implements StateStore {
  async get(thread_id: string): Promise<ConversationState | undefined> {
    const sql = db();
    if (!sql) return undefined;
    await ensure(sql);
    const rows = (await sql`SELECT state FROM conversation_state WHERE thread_id = ${thread_id}`) as { state: ConversationState }[];
    return rows[0]?.state;
  }
  async put(s: ConversationState): Promise<void> {
    const sql = db();
    if (!sql) return;
    await ensure(sql);
    await sql`
      INSERT INTO conversation_state (thread_id, status, needs_human, onsinch_order_id, updated_at, state)
      VALUES (${s.thread_id}, ${s.status}, ${s.needs_human}, ${s.onsinch_order_id ?? null}, now(), ${JSON.stringify(s)})
      ON CONFLICT (thread_id) DO UPDATE SET
        status = EXCLUDED.status,
        needs_human = EXCLUDED.needs_human,
        onsinch_order_id = EXCLUDED.onsinch_order_id,
        updated_at = now(),
        state = EXCLUDED.state`;
  }
  async all(): Promise<ConversationState[]> {
    const sql = db();
    if (!sql) return [];
    await ensure(sql);
    const rows = (await sql`SELECT state FROM conversation_state ORDER BY updated_at DESC LIMIT 500`) as { state: ConversationState }[];
    return rows.map((r) => r.state);
  }
}
