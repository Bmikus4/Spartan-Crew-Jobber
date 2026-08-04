// ============================================================================
// The historical sweep corpus — TEST DATA, deliberately separate.
// ----------------------------------------------------------------------------
// Ben wants a final validation pass before this tool replaces a human: pull the
// last 12 months out of bookings@spartancrew.co.uk, cross-reference the enquiries
// to the OnSinch jobs they became, and check the tool reproduces those jobs.
//
// That data must not touch production. `inbound_raw` is the live no-data-loss
// ledger and `tickets` is the board Spartan actually works from; a 12-month sweep
// landing in either would bury today's work under last autumn's and make the board
// meaningless. So the sweep gets its own table, and nothing here is ever projected
// onto a ticket.
//
// Capture only: no classification, no model call, no OnSinch call. Thousands of
// threads through the LLM on ingest would cost real money before anyone has decided
// what to measure. The corpus is analysed offline, from here.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

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
    CREATE TABLE IF NOT EXISTS sweep_threads (
      thread_id     TEXT PRIMARY KEY,
      mailbox       TEXT,
      message_count INT NOT NULL DEFAULT 0,
      first_date    TIMESTAMPTZ,
      last_date     TIMESTAMPTZ,
      subject       TEXT,
      participants  JSONB,
      payload       JSONB NOT NULL,
      swept_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS sweep_threads_last ON sweep_threads (last_date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sweep_threads_count ON sweep_threads (message_count DESC)`;
  _ready = true;
}

export interface SweepResult {
  ok: boolean;
  stored: boolean;
  /** true when this call replaced a thinner copy of the same thread */
  enriched: boolean;
  thread_id: string;
  message_count: number;
  error?: string;
}

/**
 * Store one swept thread. Idempotent on thread_id, and a re-sweep only overwrites
 * when it carries MORE messages — a sweep that pages by date will meet the same
 * thread from several angles, and the fullest copy is the one worth keeping.
 */
export async function storeSweptThread(payload: unknown, mailbox = "bookings@spartancrew.co.uk"): Promise<SweepResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const thread_id = String(p.thread_id ?? p.threadId ?? p.id ?? "").trim();
  const messages = Array.isArray(p.messages) ? (p.messages as Record<string, unknown>[]) : [];
  const base: SweepResult = { ok: false, stored: false, enriched: false, thread_id, message_count: messages.length };
  if (!thread_id) return { ...base, error: "missing thread_id" };

  const dates = messages
    .map((m) => Date.parse(String(m.date_iso ?? m.date ?? "")))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const participants = [...new Set(messages.map((m) => String(m.from ?? "").toLowerCase()).filter(Boolean))];
  const subject = String(messages[0]?.subject ?? p.subject ?? "");

  const sql = db();
  if (!sql) return { ...base, error: "no DATABASE_URL" };
  try {
    await ensure(sql);
    const rows = (await sql`
      INSERT INTO sweep_threads (thread_id, mailbox, message_count, first_date, last_date, subject, participants, payload)
      VALUES (${thread_id}, ${mailbox}, ${messages.length},
              ${dates.length ? new Date(dates[0]).toISOString() : null},
              ${dates.length ? new Date(dates[dates.length - 1]).toISOString() : null},
              ${subject}, ${JSON.stringify(participants)}, ${JSON.stringify(payload ?? null)})
      ON CONFLICT (thread_id) DO UPDATE
        SET mailbox       = EXCLUDED.mailbox,
            message_count = EXCLUDED.message_count,
            first_date    = EXCLUDED.first_date,
            last_date     = EXCLUDED.last_date,
            subject       = COALESCE(NULLIF(EXCLUDED.subject, ''), sweep_threads.subject),
            participants  = EXCLUDED.participants,
            payload       = EXCLUDED.payload,
            swept_at      = now()
        -- Take the new copy when it holds more messages, OR when it carries sender
        -- information the stored copy lacks. The first sweep read Gmail's headers from
        -- payload.headers, which n8n leaves empty, so 27,704 messages were stored with
        -- no From and no Subject; without this clause a corrected re-sweep would be
        -- declined as "we already hold a copy" and the corpus would stay broken.
        WHERE EXCLUDED.message_count > sweep_threads.message_count
           OR (jsonb_array_length(COALESCE(EXCLUDED.participants, '[]'::jsonb)) > 0
               AND jsonb_array_length(COALESCE(sweep_threads.participants, '[]'::jsonb)) = 0)
      RETURNING (xmax = 0) AS inserted`) as { inserted: boolean }[];
    // No row back means the conflict clause declined it: we already hold a fuller copy.
    if (!rows.length) return { ...base, ok: true, stored: false };
    return { ...base, ok: true, stored: true, enriched: !rows[0].inserted };
  } catch (err) {
    console.error("[sweep] store failed", thread_id, err);
    return { ...base, error: String((err as Error)?.message ?? err) };
  }
}

/** How much has been swept, for the sweep's own progress reporting. */
export async function sweepStats(): Promise<{ threads: number; messages: number; from: string | null; to: string | null }> {
  const sql = db();
  if (!sql) return { threads: 0, messages: 0, from: null, to: null };
  try {
    await ensure(sql);
    const [r] = (await sql`
      SELECT count(*)::int AS threads,
             COALESCE(sum(message_count), 0)::int AS messages,
             min(first_date) AS from_date,
             max(last_date)  AS to_date
      FROM sweep_threads`) as { threads: number; messages: number; from_date: string | null; to_date: string | null }[];
    return { threads: r.threads, messages: r.messages, from: r.from_date, to: r.to_date };
  } catch {
    return { threads: 0, messages: 0, from: null, to: null };
  }
}
