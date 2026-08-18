// Jobs read-model — a projection over conversation_state (which already IS the
// thread -> OnSinch order link table: PK thread_id + onsinch_order_id column).
// The Jobs menu is the tickets-style view of it. No separate table: one row per
// thread already exists; we just shape the job-relevant fields for the UI,
// including the green-check flag for AI-generated replies.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { ConversationState } from "./engine/types";

let _sql: NeonQueryFunction<false, false> | null = null;

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

export function jobsDbEnabled(): boolean {
  return !!connString();
}

export interface Job {
  thread_id: string;
  subject: string;
  contact: string;
  company_id: number | null;
  order_id: number | null;
  /** The R number a human searches on — `order.number`, not the api order id. */
  order_number: string | null;
  /** The J number — `Job[0].id` of the order. See ConversationState. */
  job_id?: number | null;
  /** Numbers this job used to carry, newest first: [{ job_id, order_number }]. */
  superseded?: Array<{ job_id: number | null; order_number: string | null }>;
  classification: string;
  status: string;
  priority: string;
  needs_human: boolean;
  ai_replied: boolean;      // engine drafted a reply -> green check
  crew_size: number | null;
  dates: string[];
  location: string | null;
  updated_at: string;
  /**
   * False when the engine judged this not a client enquiry. These used to be
   * filtered out of the board entirely, so there was no way to see what had been
   * dismissed — which reads as data loss when 45 threads show up as 25 rows.
   * They now come through and the board lanes them into "Dismissed".
   */
  is_client_inquiry?: boolean;
  /** Why it was dismissed, when it was. The useful half of a dismissal. */
  gate_reason?: string | null;
}

function toJob(s: ConversationState, updated_at: string): Job {
  const desired = s.pending_order?.desired ?? s.desired_order ?? null;
  const crew = desired?.slot_teams?.length
    ? desired.slot_teams.reduce((n, t) => n + (t.size || 0), 0)
    : null;
  const dates = [...new Set((s.facts?.requests ?? []).map((q) => q.date).filter(Boolean))] as string[];
  return {
    thread_id: s.thread_id,
    subject: s.subject || "(no subject)",
    contact: s.facts?.contact_name || s.facts?.contact_email || s.participants?.[0] || "—",
    company_id: s.company_id ?? null,
    order_id: s.onsinch_order_id ?? null,
    order_number: s.onsinch_order_number ?? null,
    job_id: s.onsinch_job_id ?? null,
    /**
     * The J number this job used to have, before an amendment rebuilt it.
     *
     * A crew change cannot be applied to an OnSinch order in place, so the order is
     * deleted and reposted and the job comes back under a NEW number. Clients quote
     * the old one back at us unprompted, and without this the person reading that
     * email has to search for a number that exists nowhere. Ben, 2026-08-18.
     */
    superseded: [],
    classification: s.classification,
    status: s.status,
    priority: s.priority,
    needs_human: !!s.needs_human,
    ai_replied: !!(s.reply_draft_id || s.last_reply_hash),
    crew_size: crew,
    dates,
    location: s.facts?.location_text ?? null,
    updated_at,
  };
}

/** Is this conversation a "job" worth listing (linked to / heading toward an order)? */
function isJob(s: ConversationState): boolean {
  return (
    s.onsinch_order_id != null ||
    !!s.pending_order ||
    s.classification === "new-job" ||
    s.classification === "update"
  );
}

export async function listJobs(limit = 300): Promise<Job[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT extract(epoch from updated_at) * 1000 AS ts, state
      FROM conversation_state
      ORDER BY updated_at DESC
      LIMIT ${limit}`) as { ts: number; state: ConversationState }[];
    const jobs = rows
      .filter((r) => r.state && isJob(r.state))
      .map((r) => toJob(r.state, new Date(Number(r.ts)).toISOString()));

    /**
     * One query for the whole page rather than one per row: an amendment is rare, so
     * almost every job has nothing here, and a per-row lookup would be 300 round trips
     * to attach nothing.
     */
    try {
      const ids = jobs.map((j) => j.thread_id);
      if (ids.length) {
        const sup = (await sql`
          SELECT thread_id, job_id, order_number
            FROM order_archive
           WHERE thread_id = ANY(${ids})
           ORDER BY deleted_at DESC`) as unknown as Array<{ thread_id: string; job_id: number | null; order_number: string | null }>;
        const byThread = new Map<string, Array<{ job_id: number | null; order_number: string | null }>>();
        for (const r of sup) {
          byThread.set(r.thread_id, [...(byThread.get(r.thread_id) ?? []), { job_id: r.job_id, order_number: r.order_number }]);
        }
        for (const j of jobs) j.superseded = byThread.get(j.thread_id) ?? [];
      }
    } catch (err) {
      // The board is more useful without the old numbers than not at all.
      console.error("[jobs] superseded numbers unavailable", err);
    }
    return jobs;
  } catch (err) {
    console.error("[jobs] list failed", err);
    return [];
  }
}
