// ============================================================================
// The analytics dashboard's figures under the rebuild.
// ----------------------------------------------------------------------------
// metric_events is written only by the paused engine, so from the cutover (10-09) the
// dashboard counted nothing: every tile and series flat while the system worked. From the
// cutover the same event vocabulary is DERIVED from the rebuild's own records, never
// written twice: thread_messages for mail in, v2_decisions for what was decided and what
// the bot wrote. Before the cutover the paused engine's events stand as they were.
//
// "Right now" is the office TV's own projection (feed/project.ts), read without the
// verifier, so the dashboard and the TV can never disagree about what is open.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { MetricEvent } from "../engine/metrics";
import type { TicketStateCounts } from "../ticketsDb";
import { V2_FROM, liveFeedDeps } from "../feed/live";
import { project, FEED_FROM } from "../feed/project";
import { v2Sources } from "../feed/v2";

export const V2_CUTOVER = V2_FROM;

const INTENTS_THAT_ARE_JOBS = new Set(["booking", "change", "cancellation", "quote_request"]);

type Row = { thread_id: string; created_at: string | Date; kind: string; intent: string | null; decision: any; executed: any };

/** One decision row as the engine's event vocabulary. */
export function eventsOf(r: Row): MetricEvent[] {
  const ts = new Date(r.created_at).getTime();
  const ev = (type: MetricEvent["type"], meta: Record<string, unknown> = {}): MetricEvent => ({ type, thread_id: r.thread_id, ts, meta: { engine: "v2", ...meta } });
  const out: MetricEvent[] = [ev("thread_processed")];
  if (r.kind === "none") return [...out, ev("filtered_out")];
  if (r.intent && INTENTS_THAT_ARE_JOBS.has(r.intent)) out.push(ev("job_detected", { intent: r.intent }));
  if (r.kind === "handoff") return [...out, ev("needs_human")];
  const ops: any[] = r.decision?.ops ?? [];
  const runs: any[] = Array.isArray(r.executed) ? r.executed : [];
  const verified = runs.length === ops.length && runs.length > 0 && runs.every((x) => x?.status === "verified");
  if (!runs.length) return [...out, ev("needs_human", { why: "planned, not written" })];
  if (!verified) return [...out, ev("order_error", { statuses: runs.map((x) => x?.status) }), ev("needs_human")];
  if (ops.some((o) => o?.op?.kind === "create_order")) out.push(ev("order_created"));
  if (ops.some((o) => o?.op?.kind !== "create_order")) out.push(ev("order_updated"));
  return out;
}

/** The rebuild's events in a window: mail in from thread_messages, the rest from v2_decisions. */
export async function v2MetricEvents(sql: NeonQueryFunction<false, false>, sinceMs: number): Promise<MetricEvent[]> {
  const since = new Date(Math.max(sinceMs, Date.parse(V2_CUTOVER))).toISOString();
  const [mail, rows] = await Promise.all([
    sql`SELECT thread_id, first_seen_at FROM thread_messages WHERE NOT is_from_spartan AND first_seen_at >= ${since}` as unknown as Promise<{ thread_id: string; first_seen_at: string }[]>,
    sql`SELECT thread_id, created_at, kind, interpretation->'grounded'->>'intent' AS intent, decision, executed
        FROM v2_decisions WHERE created_at >= ${since} AND coalesce(code_version, '') <> 'local'` as unknown as Promise<Row[]>,
  ]);
  return [
    ...mail.map((m): MetricEvent => ({ type: "email_received", thread_id: m.thread_id, ts: new Date(m.first_seen_at).getTime(), meta: { engine: "v2" } })),
    ...rows.flatMap(eventsOf),
  ];
}

/** What is open right now, as the TV shows it, in the dashboard's queue shape. */
export async function queueNow(sql: NeonQueryFunction<false, false>): Promise<TicketStateCounts> {
  const deps = liveFeedDeps();
  const now = Date.now();
  const [states, inbound, marks, replies, rows] = await Promise.all([deps.states(), deps.inbound(), deps.marks(), deps.replies ? deps.replies() : Promise.resolve(null), deps.v2 ? deps.v2() : Promise.resolve([])]);
  const p = project(states, inbound.byThread, marks, replies, now, inbound.outByThread, v2Sources(rows, now), FEED_FROM);
  const open = p.cards.filter((c) => !c.green && c.items.some((i) => i.kind !== "needs-reply"));
  const failed = (await sql`
    SELECT count(*)::int AS n FROM v2_decisions
    WHERE created_at >= now() - interval '7 days' AND jsonb_typeof(executed) = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(executed) e WHERE e->>'status' <> 'verified')`) as { n: number }[];
  return {
    live: open.length,
    awaiting_confirm: p.counts.to_check,
    needs_human: p.counts.needs_created + p.counts.needs_updated,
    with_order: open.filter((c) => c.order_id || c.r_number).length,
    failed: failed[0]?.n ?? 0,
    dismissed: new Set(marks.filter((m) => m.mark === "dismissed").map((m) => m.thread_id)).size,
  };
}
