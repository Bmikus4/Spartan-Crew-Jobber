// ============================================================================
// The event log: every event the system knows, one row each, append-only (research build 3).
// ----------------------------------------------------------------------------
// One grain — (source, ref) names the event; at, kind, thread_id, order_id, ask_key, actor key it —
// so a day replays from one query over one relation instead of six. No writer is touched: event_view
// (migrations 112) derives every event from the six tables it already lives in, and the minute sync
// lands whatever the view holds that the log does not. Nothing can be lost to a missed write because
// the view regenerates it on the next minute; a row the view can no longer produce (pruned trace,
// thinned source) stays in the log, which is why the log is a table and not just the view.
// The gap list that sized this (65% of OnSinch events have no conversation key) is
// spartan-research/01-data/event-keys-gaps-2026-11-08.tsv.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { ensureSchema } from "../../migrations";

type Sql = NeonQueryFunction<false, false>;

/** New view rows into the log; (source, ref) already landed stays as first stored. */
export async function syncEventLog(sql: Sql): Promise<{ added: number; total: number }> {
  await ensureSchema(sql);
  const added = (await sql`INSERT INTO event_log (source, ref, at, kind, thread_id, order_id, ask_key, actor)
    SELECT source, ref, at, kind, thread_id, order_id, ask_key, actor FROM event_view v
    WHERE v.at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM event_log e WHERE e.source = v.source AND e.ref = v.ref)
    ON CONFLICT (source, ref) DO NOTHING
    RETURNING 1`) as unknown[];
  const n = (await sql`SELECT count(*) n FROM event_log`) as Array<{ n: string | number }>;
  return { added: added.length, total: Number(n[0].n) };
}
