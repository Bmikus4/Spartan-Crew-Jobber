// ============================================================================
// The order a thread is already linked to, wherever the link was recorded.
// ----------------------------------------------------------------------------
// Three places hold one, and the planner read only the first:
//   1. conversation_state.onsinch_order_id, the paused engine's binding (frozen: v2 never
//      writes it, so nothing v2 does ever appears here);
//   2. v2_decisions: an order the rebuild created in the thread (executed detail) or planned
//      a change on (an op's order_id);
//   3. feed_marks matched / order-found: the order the TV's verifier found for the thread.
// Reading only (1) meant a second booking email in a thread whose order the bot had made,
// or whose hand-built order the verifier had found, was planned as a NEW order, with only
// the exact-window "already booked" check standing between it and a duplicate.
// The paused engine's binding outranks the others; within a source the newest wins.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";

export async function linkedOrderId(sql: NeonQueryFunction<false, false>, threadId: string): Promise<number | null> {
  const rows = (await sql`
    SELECT o FROM (
      SELECT onsinch_order_id::bigint AS o, 1 AS pri, now() AS at
        FROM conversation_state WHERE thread_id = ${threadId} AND onsinch_order_id > 0
      UNION ALL
      SELECT (e->'detail'->>'order_id')::bigint, 2, d.created_at
        FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.executed) = 'array' THEN d.executed ELSE '[]'::jsonb END) e
       WHERE d.thread_id = ${threadId} AND (e->'detail'->>'order_id') ~ '^[0-9]+$'
      UNION ALL
      SELECT (x->'op'->>'order_id')::bigint, 2, d.created_at
        FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.decision->'ops') = 'array' THEN d.decision->'ops' ELSE '[]'::jsonb END) x
       WHERE d.thread_id = ${threadId} AND d.kind = 'write' AND (x->'op'->>'order_id') ~ '^[0-9]+$'
      UNION ALL
      SELECT (f.evidence->>'order_id')::bigint, 3, f.at
        FROM feed_marks f
       WHERE f.thread_id = ${threadId} AND f.mark IN ('matched', 'order-found') AND (f.evidence->>'order_id') ~ '^[0-9]+$'
    ) links WHERE o > 0 ORDER BY pri, at DESC LIMIT 1`) as Array<{ o: string | number }>;
  return rows.length ? Number(rows[0].o) : null;
}
