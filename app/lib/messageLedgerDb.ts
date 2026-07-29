// ============================================================================
// The message ledger — the n8n dedupe store, in OUR Postgres.
// ----------------------------------------------------------------------------
// The live bookings workflow was copied from House of Hud and deduped against
// HoH's Airtable base (table `in_follow_up_sequence`, keyed on an Outlook
// `conversation_id`). That is wrong here on three counts: it is another tenant's
// data, it needs an Airtable credential we do not control, and search-then-create
// is a race — two polls of the same message can both find nothing and both
// create.
//
// This replaces it with one atomic claim against Postgres, which the project
// already owns:
//
//   INSERT ... ON CONFLICT (message_id) DO UPDATE  -- single statement, atomic
//
// The RETURNING tells us whether we were the first to claim it, so "have I seen
// this message?" is answered by the write itself. That collapses eight n8n nodes
// (Search records1 -> does exist? -> get found? -> Switch -> Create a record ->
// Get a record -> combine strings -> Update record) into one HTTP call, and it
// cannot double-process under concurrency.
//
// It also answers the question the workflow actually needs answered — new job or
// update? — because we track the thread as well as the message: the first
// message we ever see on a thread is a new job, every later one is an update.
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
    CREATE TABLE IF NOT EXISTS message_ledger (
      message_id    TEXT PRIMARY KEY,
      thread_id     TEXT,
      subject       TEXT,
      from_address  TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      seen_count    INT NOT NULL DEFAULT 1,
      note          TEXT
    )`;
  await sql`CREATE INDEX IF NOT EXISTS message_ledger_thread ON message_ledger (thread_id)`;
  await sql`CREATE INDEX IF NOT EXISTS message_ledger_first_seen ON message_ledger (first_seen_at DESC)`;
  _ready = true;
}

export interface ClaimInput {
  message_id: string;
  thread_id?: string | null;
  subject?: string | null;
  from_address?: string | null;
  note?: string | null;
}

export interface ClaimResult {
  ok: boolean;
  /** Airtable-compatible: true == we have seen this message before. */
  found: boolean;
  /** We won the race and are the one execution that should process it. */
  first_seen: boolean;
  /** How many times this exact message has been offered to us. */
  seen_count: number;
  /** First message ever seen on this thread => new job, not an update. */
  thread_first_seen: boolean;
  /** Distinct messages recorded against this thread, including this one. */
  thread_message_count: number;
  message_id: string;
  thread_id: string | null;
  /** Set when the ledger is unreachable — the caller must fail OPEN, not drop. */
  degraded?: string;
}

/**
 * Atomically claim a message. Idempotent and safe under concurrency: exactly one
 * caller gets first_seen=true for a given message_id, however many poll at once.
 *
 * Scope note: that guarantee covers first_seen/found, which come out of the
 * single INSERT ... ON CONFLICT. `thread_first_seen` does NOT share it - it is a
 * separate SELECT before the write, so two DIFFERENT new messages on the same
 * brand-new thread arriving at the same instant could both report true. It is
 * therefore advisory only. Nothing depends on it for correctness: the engine
 * keeps one state row per thread and decides new-vs-update from that row, so a
 * wrong hint costs nothing.
 *
 * On a database failure this returns first_seen=true with `degraded` set. That is
 * deliberate: losing an enquiry is unacceptable, processing one twice is merely
 * untidy, and the downstream /api/n8n-inbound ledger dedupes again anyway.
 */
export async function claimMessage(input: ClaimInput): Promise<ClaimResult> {
  const message_id = String(input.message_id ?? "").trim();
  const thread_id = input.thread_id ? String(input.thread_id).trim() : null;
  const fail_open: ClaimResult = {
    ok: false, found: false, first_seen: true, seen_count: 1,
    thread_first_seen: true, thread_message_count: 1, message_id, thread_id,
  };
  if (!message_id) return { ...fail_open, degraded: "missing message_id" };

  const sql = db();
  if (!sql) return { ...fail_open, degraded: "no DATABASE_URL" };

  try {
    await ensure(sql);

    // How many messages did this thread already have BEFORE this claim? Read it
    // first so an existing-thread message is never mistaken for a new job.
    let prior_thread_count = 0;
    if (thread_id) {
      const [row] = (await sql`
        SELECT count(*)::int AS n FROM message_ledger
        WHERE thread_id = ${thread_id} AND message_id <> ${message_id}`) as { n: number }[];
      prior_thread_count = row?.n ?? 0;
    }

    const rows = (await sql`
      INSERT INTO message_ledger (message_id, thread_id, subject, from_address, note)
      VALUES (${message_id}, ${thread_id}, ${input.subject ?? null}, ${input.from_address ?? null}, ${input.note ?? null})
      ON CONFLICT (message_id) DO UPDATE
        SET last_seen_at = now(),
            seen_count   = message_ledger.seen_count + 1,
            thread_id    = COALESCE(message_ledger.thread_id, EXCLUDED.thread_id)
      RETURNING seen_count, thread_id`) as { seen_count: number; thread_id: string | null }[];

    const seen_count = rows[0]?.seen_count ?? 1;
    const first_seen = seen_count === 1;
    return {
      ok: true,
      found: !first_seen,
      first_seen,
      seen_count,
      thread_first_seen: prior_thread_count === 0,
      thread_message_count: prior_thread_count + 1,
      message_id,
      thread_id: rows[0]?.thread_id ?? thread_id,
    };
  } catch (err) {
    console.error("[message_ledger] claim failed", err);
    return { ...fail_open, degraded: String((err as Error)?.message ?? err) };
  }
}

/** Read-only: has this message been seen? Does not claim it. */
export async function peekMessage(message_id: string): Promise<{ found: boolean; seen_count: number } | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`SELECT seen_count FROM message_ledger WHERE message_id = ${message_id}`) as { seen_count: number }[];
    return { found: rows.length > 0, seen_count: rows[0]?.seen_count ?? 0 };
  } catch {
    return null;
  }
}
