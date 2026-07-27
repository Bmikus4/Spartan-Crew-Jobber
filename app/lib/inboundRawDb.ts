// Durable inbound ledger — EVERY payload that hits /api/n8n-inbound is written
// here FIRST, before any processing (no-data-loss guarantee). Also the message-
// level exactly-once safety net: a dedup_key UNIQUE constraint makes a re-posted
// message a no-op, on top of n8n's own label-ledger. Payloads are stored raw so
// we can inspect the real shape coming off the live workflow and align the
// contract without losing anything.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

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
    CREATE TABLE IF NOT EXISTS inbound_raw (
      id          BIGSERIAL PRIMARY KEY,
      dedup_key   TEXT UNIQUE NOT NULL,
      source      TEXT,
      thread_id   TEXT,
      message_id  TEXT,
      payload     JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS inbound_raw_received ON inbound_raw (received_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS inbound_raw_thread ON inbound_raw (thread_id)`;
  _ready = true;
}

/** Best-effort id extraction from an arbitrary inbound payload. */
function ids(p: unknown): { thread_id: string | null; message_id: string | null } {
  const o = (p ?? {}) as Record<string, unknown>;
  const oe = (o.original_email ?? {}) as Record<string, unknown>;
  const thread_id = String(o.thread_id ?? o.threadId ?? oe.thread_id ?? oe.threadId ?? "") || null;
  const message_id = String(o.message_id ?? o.messageId ?? o.id ?? oe.email_id ?? oe.message_id ?? "") || null;
  return { thread_id, message_id };
}

export interface CaptureResult { ok: boolean; captured: boolean; dedup_key: string; thread_id: string | null; message_id: string | null }

/**
 * Persist a raw inbound payload. Idempotent: keyed on message_id when present,
 * else a stable hash of the payload — a duplicate delivery inserts nothing.
 * Never throws (a ledger failure must not break intake); returns ok:false.
 */
export async function captureInboundRaw(payload: unknown, source = "n8n"): Promise<CaptureResult> {
  const { thread_id, message_id } = ids(payload);
  const dedup_key =
    message_id ||
    "sha:" + createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex").slice(0, 32);
  const sql = db();
  if (!sql) return { ok: false, captured: false, dedup_key, thread_id, message_id };
  try {
    await ensure(sql);
    const rows = (await sql`
      INSERT INTO inbound_raw (dedup_key, source, thread_id, message_id, payload)
      VALUES (${dedup_key}, ${source}, ${thread_id}, ${message_id}, ${JSON.stringify(payload ?? null)})
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id`) as { id: number }[];
    return { ok: true, captured: rows.length > 0, dedup_key, thread_id, message_id };
  } catch (err) {
    console.error("[inbound_raw] capture failed", err);
    return { ok: false, captured: false, dedup_key, thread_id, message_id };
  }
}
