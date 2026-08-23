// Durable inbound ledger — EVERY delivery to /api/n8n-inbound is recorded here
// FIRST, before any processing (no-data-loss guarantee). Also the message-level
// exactly-once safety net: a dedup_key UNIQUE constraint makes a re-posted
// message a no-op, on top of n8n's own label-ledger.
//
// It records the DELIVERY, not the mail. The mail goes to thread_messages, one
// row per message. n8n POSTs the full hydrated thread every time, so storing the
// body here meant 6,644 copies of 1,354 messages and a table growing with the
// square of thread length. See docs/DATABASE-RESTRUCTURE-PLAN.md.
//
// What is kept is the ENVELOPE: the payload minus `messages`. That is n8n's
// verdict, gate reason, routing and whatever field the workflow grows next — a
// few hundred bytes, read by survey-inbound and grade-brain, and exactly the kind
// of thing that turns out to matter after it has been thrown away.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { storeThreadMessages, messagesFromPayload } from "./threadMessagesDb";

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
  // The payload column is EMPTIED, not dropped: reverting is then one line, and rows
  // captured before the restructure keep the copy the ops scripts may still read.
  await sql`ALTER TABLE inbound_raw ALTER COLUMN payload DROP NOT NULL`;
  await sql`ALTER TABLE inbound_raw ADD COLUMN IF NOT EXISTS message_ids TEXT[]`;
  await sql`ALTER TABLE inbound_raw ADD COLUMN IF NOT EXISTS envelope JSONB`;
  _ready = true;
}

/**
 * The payload with its message bodies removed. The bodies are ~all of the bytes and go to
 * thread_messages; everything else is a few hundred bytes and is kept.
 */
export function envelopeOf(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload ?? null;
  const rest = { ...(payload as Record<string, unknown>) };
  delete rest.messages;
  return rest;
}

/** Best-effort id extraction from an arbitrary inbound payload. */
function ids(p: unknown): { thread_id: string | null; message_id: string | null } {
  const o = (p ?? {}) as Record<string, unknown>;
  const oe = (o.original_email ?? {}) as Record<string, unknown>;
  const thread_id = String(o.thread_id ?? o.threadId ?? oe.thread_id ?? oe.threadId ?? "") || null;
  const message_id = String(o.message_id ?? o.messageId ?? o.id ?? oe.email_id ?? oe.message_id ?? "") || null;
  return { thread_id, message_id };
}

export interface CaptureResult {
  ok: boolean; captured: boolean; dedup_key: string;
  thread_id: string | null; message_id: string | null;
  /** How many messages in this payload had not been stored before. A run of zeroes on real
   *  traffic means n8n changed shape and messagesFromPayload is extracting nothing. */
  messages_stored: number;
}

/**
 * Record an inbound delivery and store its messages. Idempotent: keyed on message_id when
 * present, else a stable hash of the payload — a duplicate delivery inserts nothing.
 * Never throws (a ledger failure must not break intake); returns ok:false.
 */
export async function captureInboundRaw(payload: unknown, source = "n8n"): Promise<CaptureResult> {
  const { thread_id, message_id } = ids(payload);
  const dedup_key =
    message_id ||
    "sha:" + createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex").slice(0, 32);
  const sql = db();
  if (!sql) return { ok: false, captured: false, dedup_key, thread_id, message_id, messages_stored: 0 };
  try {
    await ensure(sql);
    // Messages FIRST. A crash between the two loses a dedup record — harmless, because
    // claimMessage and the UNIQUE key both still catch the re-delivery — and never loses mail.
    const msgs = await storeThreadMessages(payload);
    const rows = (await sql`
      INSERT INTO inbound_raw (dedup_key, source, thread_id, message_id, message_ids, envelope)
      VALUES (${dedup_key}, ${source}, ${thread_id}, ${message_id},
              ${messagesFromPayload(payload).map((m) => m.message_id)},
              ${JSON.stringify(envelopeOf(payload))})
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id`) as { id: number }[];
    return { ok: true, captured: rows.length > 0, dedup_key, thread_id, message_id,
             messages_stored: msgs.inserted };
  } catch (err) {
    console.error("[inbound_raw] capture failed", err);
    return { ok: false, captured: false, dedup_key, thread_id, message_id, messages_stored: 0 };
  }
}
