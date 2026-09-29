// ============================================================================
// "This one doesn't need chasing" — a human overruling the clock.
// ----------------------------------------------------------------------------
// SUPPRESSION IS PER WAIT, NOT PER THREAD, and that is the whole design of this
// table. A person dismissing an alert is saying something about the silence in front
// of them — the client rang, the job was cancelled, a colleague has it. They are not
// saying "never chase this client again", and reading it that way would quietly mute
// a live thread months later, on the strength of a click nobody remembers making.
//
// So the row records WHICH wait was dismissed (`waiting_since_iso`, the flip point
// clock.ts computed) and suppression only applies while that is still the open wait.
// The moment somebody speaks, the flip point moves, the stored value stops matching,
// and the thread is live again with a fresh clock. Nothing has to expire it.
//
// The alternative — a boolean on the thread — needs an unsuppress step that somebody
// has to remember to take, and a thread nobody remembers to unmute is indistinguishable
// from one nobody is waiting on. That is the failure this shape cannot have.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS followup_suppressions (
      thread_id         TEXT PRIMARY KEY,
      waiting_since_iso TEXT NOT NULL,
      suppressed_by     TEXT,
      reason            TEXT,
      suppressed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  _ready = true;
}

export interface Suppression {
  thread_id: string;
  waiting_since_iso: string;
  suppressed_by: string | null;
  reason: string | null;
}

/**
 * Every suppression on record, keyed by thread.
 *
 * Returned whole rather than filtered by thread because the board asks about hundreds
 * of threads at once and this table is small by construction — one row per dismissal,
 * and a dismissal is a person clicking a button.
 */
export async function allSuppressions(): Promise<Map<string, Suppression>> {
  const sql = db();
  if (!sql) return new Map();
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT thread_id, waiting_since_iso, suppressed_by, reason
      FROM followup_suppressions`) as Suppression[];
    return new Map(rows.map((r) => [r.thread_id, r]));
  } catch (err) {
    /**
     * A READ FAILURE MUST NOT SUPPRESS ANYTHING. Returning an empty map means every
     * alert shows, including ones somebody dismissed — noisy, and the right way round.
     * The opposite default would hide outstanding work because a query failed.
     */
    console.error("[followup] could not read suppressions", err);
    return new Map();
  }
}

/** Dismiss the wait that started at `waiting_since_iso`. Re-dismissing is harmless. */
export async function suppress(
  thread_id: string,
  waiting_since_iso: string,
  by: string | null,
  reason: string | null
): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await ensure(sql);
    // ON CONFLICT updates rather than doing nothing: dismissing a LATER wait on a
    // thread that was dismissed before must move the stored flip point, or the new
    // dismissal silently fails and the alert comes straight back.
    await sql`
      INSERT INTO followup_suppressions (thread_id, waiting_since_iso, suppressed_by, reason)
      VALUES (${thread_id}, ${waiting_since_iso}, ${by}, ${reason})
      ON CONFLICT (thread_id) DO UPDATE SET
        waiting_since_iso = EXCLUDED.waiting_since_iso,
        suppressed_by     = EXCLUDED.suppressed_by,
        reason            = EXCLUDED.reason,
        suppressed_at     = now()`;
    return true;
  } catch (err) {
    console.error("[followup] could not suppress", err);
    return false;
  }
}

export async function unsuppress(thread_id: string): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await ensure(sql);
    await sql`DELETE FROM followup_suppressions WHERE thread_id = ${thread_id}`;
    return true;
  } catch (err) {
    console.error("[followup] could not unsuppress", err);
    return false;
  }
}

/**
 * Is THIS wait suppressed?
 *
 * The comparison is the point: a stored dismissal against a different flip point is a
 * dismissal of a wait that has since ended, and says nothing about the one open now.
 */
export function isSuppressed(s: Suppression | undefined, waiting_since_iso: string): boolean {
  return !!s && s.waiting_since_iso === waiting_since_iso;
}
