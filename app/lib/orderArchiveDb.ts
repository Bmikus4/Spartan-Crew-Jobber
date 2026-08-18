// ============================================================================
// Every order this engine deleted, and what replaced it.
// ----------------------------------------------------------------------------
// An amendment cannot be applied to an OnSinch order in place. PATCH /orders takes
// top-level fields only, nested Job/SlotTeam are rejected, and PATCH /slotTeams needs
// a slot team id that this API hands over exactly once and never lets you read again
// (GET /slotTeams 405, GET /jobs 405, with=Job.SlotTeam 400, with=Job carries no
// teams, orderItems references attendances). So a crew change means DELETE the order
// and post a corrected one — and the corrected one gets a new id, a new R number and
// a new J number.
//
// That is what this table is for. A client quotes "J13918" months later and it exists
// nowhere in OnSinch, because the booking they are talking about is J14022 now. One
// row per deleted order keeps the whole chain answerable: what the job was, what it
// became, and when.
//
// WHAT IS AND IS NOT A READBACK. The order and its Job are read live from OnSinch
// immediately before the delete, so `live_order` is what was actually there. The slot
// teams CANNOT be read — there is no endpoint — so `slot_teams` is the engine's own
// copy of what it believes was on the order. For an order the engine created those are
// the same thing. For one raised by hand in OnSinch they may not be, and
// `slot_teams_are_reconstruction` says so on the row rather than leaving someone to
// find out by trusting it. An archive that cannot be trusted is worse than none: it is
// exactly what somebody reaches for when reconstructing what went wrong.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { DesiredOrder, DesiredSlotTeam } from "./engine/types";

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
    CREATE TABLE IF NOT EXISTS order_archive (
      id             BIGSERIAL PRIMARY KEY,
      thread_id      TEXT NOT NULL,
      -- What was deleted.
      order_id       BIGINT NOT NULL,
      order_number   TEXT,
      job_id         BIGINT,
      -- What replaced it. Null while the rebuild is in flight, and null forever if the
      -- rebuild failed — which is precisely the row somebody needs to find.
      replaced_by_order_id     BIGINT,
      replaced_by_order_number TEXT,
      replaced_by_job_id       BIGINT,
      -- The whole thing, as it stood.
      live_order     JSONB,
      slot_teams     JSONB NOT NULL DEFAULT '[]'::jsonb,
      slot_teams_are_reconstruction BOOLEAN NOT NULL DEFAULT true,
      -- Why, in the words a human would use: "crew 6 -> 4".
      reason         TEXT,
      created        TIMESTAMPTZ,
      deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS order_archive_thread ON order_archive (thread_id)`;
  // The lookups that matter are by the number a human types, not by the api id.
  await sql`CREATE INDEX IF NOT EXISTS order_archive_number ON order_archive (order_number)`;
  await sql`CREATE INDEX IF NOT EXISTS order_archive_job ON order_archive (job_id)`;
  _ready = true;
}

export interface ArchivedOrder {
  thread_id: string;
  order_id: number;
  order_number?: string | null;
  job_id?: number | null;
  live_order?: Record<string, unknown> | null;
  slot_teams: DesiredSlotTeam[];
  slot_teams_are_reconstruction: boolean;
  reason?: string;
  created?: string | null;
}

/**
 * Record a deletion. Called BEFORE the delete, so a crash between the two leaves a
 * row describing an order that still exists — which is recoverable — rather than a
 * deleted order nothing remembers, which is not.
 */
export async function archiveOrder(a: ArchivedOrder): Promise<number | null> {
  const sql = db();
  if (!sql) return null;
  await ensure(sql);
  const rows = (await sql`
    INSERT INTO order_archive
      (thread_id, order_id, order_number, job_id, live_order, slot_teams,
       slot_teams_are_reconstruction, reason, created)
    VALUES (${a.thread_id}, ${a.order_id}, ${a.order_number ?? null}, ${a.job_id ?? null},
            ${JSON.stringify(a.live_order ?? null)}, ${JSON.stringify(a.slot_teams ?? [])},
            ${a.slot_teams_are_reconstruction}, ${a.reason ?? null}, ${a.created ?? null})
    RETURNING id`) as unknown as Array<{ id: number }>;
  return rows[0]?.id ?? null;
}

/** Close the chain once the replacement exists. */
export async function recordReplacement(
  archive_id: number,
  by: { order_id: number; order_number?: string; job_id?: number }
): Promise<void> {
  const sql = db();
  if (!sql) return;
  await ensure(sql);
  await sql`
    UPDATE order_archive
       SET replaced_by_order_id = ${by.order_id},
           replaced_by_order_number = ${by.order_number ?? null},
           replaced_by_job_id = ${by.job_id ?? null}
     WHERE id = ${archive_id}`;
}

/** Every superseded order for a thread, newest first — what the ticket shows. */
export async function archiveForThread(thread_id: string): Promise<Array<Record<string, unknown>>> {
  const sql = db();
  if (!sql) return [];
  await ensure(sql);
  return (await sql`
    SELECT order_id, order_number, job_id, replaced_by_order_id, replaced_by_order_number,
           replaced_by_job_id, reason, slot_teams_are_reconstruction, deleted_at
      FROM order_archive WHERE thread_id = ${thread_id}
     ORDER BY deleted_at DESC`) as unknown as Array<Record<string, unknown>>;
}

/**
 * Find the job a superseded number now points at — the "I was given J13918 and it
 * does not exist" lookup. Follows the chain, so a job amended three times still
 * resolves from its first number.
 */
export async function currentJobFor(oldNumber: string | number): Promise<Record<string, unknown> | null> {
  const sql = db();
  if (!sql) return null;
  await ensure(sql);
  const key = String(oldNumber).replace(/^[RJ]/i, "");
  const rows = (await sql`
    SELECT thread_id, order_id, order_number, job_id,
           replaced_by_order_id, replaced_by_order_number, replaced_by_job_id
      FROM order_archive
     WHERE order_number = ${key} OR job_id = ${Number(key) || -1} OR order_id = ${Number(key) || -1}
     ORDER BY deleted_at DESC LIMIT 1`) as unknown as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

/** The order body we keep when the live read is unavailable. */
export function reconstructionFrom(desired: DesiredOrder | null | undefined): DesiredSlotTeam[] {
  return desired?.slot_teams ?? [];
}
