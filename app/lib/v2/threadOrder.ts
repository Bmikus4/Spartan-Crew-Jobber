// ============================================================================
// The order a thread is already linked to: its job_links row (a bot write, or an order the
// planner found, links.ts), else an order the rebuild created in it or planned a change on.
// ----------------------------------------------------------------------------
// Two sources were dropped on 2026-10-21 and must not come back:
//   - the paused engine's conversation_state binding: frozen since 10-08, and 114 of the orders
//     it names are deleted from OnSinch;
//   - the TV verifier's screen-only matched / order-found marks: one, found by "date and venue",
//     put Creative Technology's Cytiva shift into R11500 on 14 Oct while staff's R11555 held it.
// The planner finds a thread's order itself, by evidence (plan.ts findOrder); a find it is sure
// of becomes a job_links row, so there is one source of a thread's order.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { ensureLinks } from "./links";

/**
 * `readable` says whether OnSinch still holds an order. An id taken from an old decision is passed
 * over once OnSinch has deleted it (addendum F14): it otherwise refused every later email on the
 * thread as "linked order unreadable". A read that fails is not a deletion, so the id stands. Link
 * rows are left to the links sweep, which marks a deleted order's row itself.
 */
export async function linkedOrderId(sql: NeonQueryFunction<false, false>, threadId: string, readable?: (orderId: number) => Promise<boolean>): Promise<number | null> {
  await ensureLinks(sql);
  const rows = (await sql`
    SELECT o, pri FROM (
      SELECT (e->'detail'->>'order_id')::bigint AS o, 2 AS pri, d.created_at AS at
        FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.executed) = 'array' THEN d.executed ELSE '[]'::jsonb END) e
       WHERE d.thread_id = ${threadId} AND (e->'detail'->>'order_id') ~ '^[0-9]+$'
      UNION ALL
      SELECT (x->'op'->>'order_id')::bigint, 2, d.created_at
        FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.decision->'ops') = 'array' THEN d.decision->'ops' ELSE '[]'::jsonb END) x
       WHERE d.thread_id = ${threadId} AND d.kind = 'write' AND (x->'op'->>'order_id') ~ '^[0-9]+$'
      UNION ALL
      SELECT order_id::bigint, 0, coalesce(last_checked, first_seen)
        FROM job_links WHERE thread_id = ${threadId} AND state IN ('linked', 'relinked') AND order_id > 0
    ) links WHERE o > 0 ORDER BY pri, at DESC LIMIT 20`) as Array<{ o: string | number; pri: number }>;
  for (const r of rows) {
    if (Number(r.pri) === 2 && readable && !(await readable(Number(r.o)).catch(() => true))) continue;
    return Number(r.o);
  }
  return null;
}
