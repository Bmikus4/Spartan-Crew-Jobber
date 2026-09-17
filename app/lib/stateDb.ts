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
  // When this thread was last RECONCILED, which is not when it was last written.
  // updated_at moves every time the engine touches a thread, so ordering a sweep by it
  // means the busiest conversations are swept repeatedly and the quiet ones never --
  // and a quiet thread bound to a deleted order is exactly the drift the sweep exists
  // to find. NULL means never swept, and NULLS FIRST is what makes a new thread jump
  // the queue rather than sit behind 250 rows that were done yesterday.
  await sql`ALTER TABLE conversation_state ADD COLUMN IF NOT EXISTS swept_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS conversation_state_swept ON conversation_state (swept_at NULLS FIRST)`;
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
  /**
   * The next `limit` threads due a reconciliation sweep, oldest sweep first.
   *
   * WHY THIS EXISTS RATHER THAN all().slice(). The sweep has a hard 60-second ceiling —
   * it is a Vercel function — and 251 bound threads at roughly 0.6s each do not fit. So
   * it must be bounded. But all() orders by updated_at DESC, and bounding THAT sweeps the
   * newest threads every run while the oldest are never reached at all: a sweep that
   * reports success having covered the same 40 rows for a week. Ordering by swept_at
   * turns the bound into a rotation — every run takes the threads that have waited
   * longest, so the whole table is covered in ceil(bound / limit) runs and nothing
   * starves.
   *
   * Bound threads only. A thread holding no order has nothing to reconcile against, and
   * including them would spend the batch on rows that can only ever be skipped.
   */
  async forSweep(limit: number): Promise<ConversationState[]> {
    const sql = db();
    if (!sql) return [];
    await ensure(sql);
    const rows = (await sql`
      SELECT state FROM conversation_state
      WHERE onsinch_order_id > 0
      ORDER BY swept_at ASC NULLS FIRST, updated_at DESC
      LIMIT ${limit}`) as { state: ConversationState }[];
    return rows.map((r) => r.state);
  }

  /**
   * Record that these threads have been swept.
   *
   * Stamped AFTER the batch and for every thread the sweep looked at, including the ones
   * it skipped and the ones that errored. The stamp means "this row has had its turn",
   * not "this row was healthy" — if a thread that throws kept its old timestamp it would
   * be first in the queue again next run, and one permanently broken row would hold the
   * rotation still and starve everything behind it.
   */
  async markSwept(threadIds: string[]): Promise<void> {
    if (!threadIds.length) return;
    const sql = db();
    if (!sql) return;
    await ensure(sql);
    await sql`UPDATE conversation_state SET swept_at = now() WHERE thread_id = ANY(${threadIds})`;
  }

  /** How the rotation is doing: total bound threads, and how many have never been swept. */
  async sweepStats(): Promise<{ bound: number; never_swept: number }> {
    const sql = db();
    if (!sql) return { bound: 0, never_swept: 0 };
    await ensure(sql);
    const rows = (await sql`
      SELECT COUNT(*)::int AS bound,
             COUNT(*) FILTER (WHERE swept_at IS NULL)::int AS never_swept
      FROM conversation_state WHERE onsinch_order_id > 0`) as { bound: number; never_swept: number }[];
    return { bound: rows[0]?.bound ?? 0, never_swept: rows[0]?.never_swept ?? 0 };
  }

  async all(): Promise<ConversationState[]> {
    const sql = db();
    if (!sql) return [];
    await ensure(sql);
    const rows = (await sql`SELECT state FROM conversation_state ORDER BY updated_at DESC LIMIT 500`) as { state: ConversationState }[];
    return rows.map((r) => r.state);
  }
  /** The confirm queue: conversations with a staged order awaiting approval. */
  /**
   * The confirm queue: conversations with a staged order awaiting approval.
   *
   * Derived from the state JSONB, not the `status` column, and it requires an
   * actual pending_order.
   *
   * The column is a denormalised copy for indexing, and it CAN drift: any
   * maintenance script that repairs `state` with a direct UPDATE leaves it
   * behind. clear-machine-threads.ts did exactly that, so the OnSinch-notifier
   * threads it had correctly retired still read status='proposed' in their column
   * and were still being offered for confirmation — the precise thing that script
   * existed to prevent.
   *
   * Requiring pending_order is the second guard: "proposed" with nothing staged
   * cannot be confirmed (confirmOrder no-ops), so offering it is only ever a
   * button that lies.
   */
  async listProposed(): Promise<ConversationState[]> {
    const sql = db();
    if (!sql) return [];
    await ensure(sql);
    const rows = (await sql`
      SELECT state FROM conversation_state
      WHERE state->>'status' = 'proposed'
        AND state->'pending_order' IS NOT NULL
        AND state->'pending_order' <> 'null'::jsonb
      ORDER BY updated_at DESC LIMIT 100`) as { state: ConversationState }[];
    return rows.map((r) => r.state);
  }
}
