// ============================================================================
// WHERE THE CURSOR LIVES.
// ----------------------------------------------------------------------------
// One row, one number. It is the entire state of the pull: everything else about which
// mail has been seen is derivable from it, and if this row is lost the poller re-anchors
// by date and carries on — which is why the cursor being small and boring is the point.
//
// Keyed by mailbox so a second tenant is a second row rather than a second deployment.
//
// ADVANCED ONLY AFTER THE WORK IS DONE. The poller reads, processes, and then writes the
// cursor. A crash between read and write re-delivers a handful of messages that dedupe on
// their Message-ID; a cursor written first would turn the same crash into mail nobody
// ever looks at again. At-least-once, in the one place it is decided.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _ready = false;

function db(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL;
  return url ? neon(url) : null;
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS mail_cursor (
      mailbox     TEXT PRIMARY KEY,
      history_id  TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_run_at TIMESTAMPTZ,
      last_count  INTEGER NOT NULL DEFAULT 0
    )`;
  _ready = true;
}

/** Null means "never run", which the poller treats as a date-bounded re-anchor. */
export async function readCursor(mailbox: string): Promise<string | null> {
  const sql = db();
  if (!sql) return null;
  await ensure(sql);
  const rows = (await sql`SELECT history_id FROM mail_cursor WHERE mailbox = ${mailbox}`) as { history_id: string }[];
  return rows[0]?.history_id ?? null;
}

export async function writeCursor(mailbox: string, historyId: string, count: number): Promise<void> {
  const sql = db();
  if (!sql) return;
  await ensure(sql);
  await sql`
    INSERT INTO mail_cursor (mailbox, history_id, updated_at, last_run_at, last_count)
    VALUES (${mailbox}, ${historyId}, now(), now(), ${count})
    ON CONFLICT (mailbox) DO UPDATE
      SET history_id = EXCLUDED.history_id, updated_at = now(), last_run_at = now(), last_count = EXCLUDED.last_count`;
}

/**
 * Recorded even when nothing arrived, so "the poller ran and the mailbox was quiet" and
 * "the poller has not run" stop looking identical. That distinction is the whole of the
 * 2026-08-26 outage: a silent stop read exactly like a quiet afternoon.
 */
export async function touchRun(mailbox: string): Promise<void> {
  const sql = db();
  if (!sql) return;
  await ensure(sql);
  await sql`UPDATE mail_cursor SET last_run_at = now(), last_count = 0 WHERE mailbox = ${mailbox}`;
}

export async function cursorStatus(mailbox: string): Promise<{ history_id: string | null; last_run_at: string | null; last_count: number } | null> {
  const sql = db();
  if (!sql) return null;
  await ensure(sql);
  const rows = (await sql`
    SELECT history_id, last_run_at, last_count FROM mail_cursor WHERE mailbox = ${mailbox}`) as any[];
  return rows[0] ?? null;
}

/**
 * WHICH GMAIL IDS HAVE ALREADY BEEN HANDLED.
 *
 * The cursor alone cannot express partial progress: it is one number, so a run that
 * processes half a backlog has nowhere to record the half it did. Without this the
 * choice is to advance the cursor over unprocessed mail (a silent skip) or not advance
 * it at all (the same first batch, forever, while the backlog grows behind it).
 *
 * With it the poller takes the first N ids it has NOT seen, so a backlog drains a batch
 * per tick and the cursor moves only once the whole set is done.
 */
async function ensureSeen(sql: NeonQueryFunction<false, false>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS mail_seen (
      mailbox  TEXT NOT NULL,
      gmail_id TEXT NOT NULL,
      seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (mailbox, gmail_id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS mail_seen_at ON mail_seen (seen_at DESC)`;
}

export async function unseenIds(mailbox: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const sql = db();
  if (!sql) return ids;
  await ensureSeen(sql);
  const rows = (await sql`SELECT gmail_id FROM mail_seen WHERE mailbox = ${mailbox} AND gmail_id = ANY(${ids})`) as { gmail_id: string }[];
  const seen = new Set(rows.map((r) => r.gmail_id));
  return ids.filter((id) => !seen.has(id));
}

export async function markSeen(mailbox: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const sql = db();
  if (!sql) return;
  await ensureSeen(sql);
  await sql`
    INSERT INTO mail_seen (mailbox, gmail_id)
    SELECT ${mailbox}, UNNEST(${ids}::text[])
    ON CONFLICT DO NOTHING`;
}

/** Kept small: the cursor is the real state, this is only the in-flight window. */
export async function pruneSeen(days = 30): Promise<void> {
  const sql = db();
  if (!sql) return;
  await ensureSeen(sql);
  await sql`DELETE FROM mail_seen WHERE seen_at < now() - (${days} || ' days')::interval`;
}
