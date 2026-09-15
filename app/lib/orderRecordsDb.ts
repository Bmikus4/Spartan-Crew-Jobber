// ============================================================================
// orderRecords - one durable row per order this engine wrote.
// ----------------------------------------------------------------------------
// What we knew about a written order used to be spread across a column, a JSON
// blob and a composed array, with the counterparty recorded nowhere. Answering
// "what did we send, for whom, and what came back" meant joining three sources
// by hand.
//
// The row holds the SHAPE WE SENT rather than ids read back, because most of
// what we write cannot be read back: /slotTeams has no GET, and the audit log
// records nothing for an order created through the API. What we sent is the only
// thing we will always know, so it is the authority - and it is what the
// amendment path composes its next version from.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * How an order id came to be recorded. The distinction Phase 0 found missing, and the
 * reason "39 of 47 recorded ids do not resolve" reads as one finding when it is two.
 *
 *   api_response  OnSinch's own answer to a `POST /orders` this engine sent. Not in
 *                 doubt: the id was minted for us and read back on the same call.
 *   matched       read out of OnSinch history by company and date
 *                 (`matchExistingOrder`) because the thread had no id yet. True at the
 *                 moment it was read and never re-read since, because the link is
 *                 guarded on `!linkedOrderId`. 90 of the 148 recorded ids are these.
 *   manual        set by a person or a maintenance script.
 *
 * ONE ORDER HOLDS MANY THREADS. Measured 2026-09-13: of 19 orders claimed by more than
 * one thread, 12 are a single job whose client emailed about it in several Gmail threads —
 * the PO in one, a crew change in another, a quote reply in a third, no shared message ids
 * between them. Binding all of them to the one order is correct, so the key is
 * (thread_id, order_id) and NOT order_id alone. An `order_id` primary key encoded a
 * one-to-one that the business does not have, and made 19 real links look like conflicts.
 *
 * Only `api_response` is written today — the create path is the only writer wired up.
 * The other two are declared rather than invented later, so that the day the matched
 * ids get provenance the vocabulary does not have to change underneath them.
 */
export type IdSource = "api_response" | "matched" | "manual";

export interface OrderRecord {
  order_id: number;
  thread_id: string;
  job_id: number | null;
  order_number: string | null;
  sender_email: string | null;
  sender_domain: string | null;
  company_id: number | null;
  place_id: number | null;
  shape_sent: unknown;
  block_count: number;
  crew_total: number;
  /** Where the id came from. See IdSource — this is the column §3.2 needed and lacked. */
  id_source: IdSource;
  /**
   * When the id was last confirmed to name a real order, or null.
   *
   * NULL IS A THIRD STATE, NOT A FALSE. "Never verified" and "verified and absent" are
   * different facts about an order and the outstanding document counts them together;
   * a boolean here would rebuild that conflation in the schema.
   */
  verified_at: string | null;
  created_at?: string;
}

interface ShapeLike {
  company_id?: number;
  slot_teams?: Array<{ size?: number }>;
}

/**
 * Derive the record from the shape that was sent. The counts come from the shape
 * rather than from a caller's tally, so the row can never disagree with what went
 * on the wire - the disagreement is the whole thing worth catching.
 */
export function buildOrderRecord(input: {
  order_id: number;
  thread_id: string;
  job_id: number | null;
  order_number: string | null;
  sender_email: string | null;
  sender_domain: string | null;
  place_id: number | null;
  shape_sent: unknown;
  id_source: IdSource;
  verified_at: string | null;
}): OrderRecord {
  const shape = (input.shape_sent ?? {}) as ShapeLike;
  const teams = Array.isArray(shape.slot_teams) ? shape.slot_teams : [];
  return {
    ...input,
    company_id: Number.isInteger(shape.company_id) ? Number(shape.company_id) : null,
    block_count: teams.length,
    crew_total: teams.reduce((n, t) => n + (Number(t?.size) || 0), 0),
  };
}

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
    CREATE TABLE IF NOT EXISTS order_records (
      order_id      BIGINT NOT NULL,
      thread_id     TEXT NOT NULL,
      job_id        BIGINT,
      order_number  TEXT,
      sender_email  TEXT,
      sender_domain TEXT,
      company_id    INT,
      place_id      INT,
      shape_sent    JSONB NOT NULL,
      block_count   INT NOT NULL,
      crew_total    INT NOT NULL,
      id_source     TEXT NOT NULL DEFAULT 'api_response',
      verified_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (thread_id, order_id)
    )`;
  // The CREATE above only runs on an empty database, so a column added later has to be
  // added here too or it exists in dev and nowhere else. Same rule, and the same comment,
  // as ticketsDb.ts — that repo learned it by shipping a column into one environment.
  /**
   * Migrate a table created under the old one-row-per-order key. Postgres names that
   * constraint `order_records_pkey`, and dropping it is safe because the composite key
   * added straight after is strictly weaker — every row that satisfied the old key
   * satisfies the new one, so nothing can fail to migrate.
   */
  await sql`ALTER TABLE order_records DROP CONSTRAINT IF EXISTS order_records_pkey`;
  await sql`ALTER TABLE order_records ADD COLUMN IF NOT EXISTS id_source TEXT NOT NULL DEFAULT 'api_response'`;
  await sql`ALTER TABLE order_records ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`;
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_records_thread_order_pk') THEN
        ALTER TABLE order_records ADD CONSTRAINT order_records_thread_order_pk PRIMARY KEY (thread_id, order_id);
      END IF;
    END $$`;
  await sql`CREATE INDEX IF NOT EXISTS order_records_order ON order_records (order_id)`;
  await sql`CREATE INDEX IF NOT EXISTS order_records_thread ON order_records (thread_id)`;
  await sql`CREATE INDEX IF NOT EXISTS order_records_domain ON order_records (sender_domain)`;
  await sql`CREATE INDEX IF NOT EXISTS order_records_unverified ON order_records (id_source) WHERE verified_at IS NULL`;
  _ready = true;
}

/** Never throws: a booking is not lost because its side-record could not be written. */
export async function recordOrder(rec: OrderRecord): Promise<void> {
  const sql = db();
  if (!sql) return;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO order_records (order_id, thread_id, job_id, order_number, sender_email,
                                 sender_domain, company_id, place_id, shape_sent, block_count, crew_total,
                                 id_source, verified_at)
      VALUES (${rec.order_id}, ${rec.thread_id}, ${rec.job_id}, ${rec.order_number}, ${rec.sender_email},
              ${rec.sender_domain}, ${rec.company_id}, ${rec.place_id}, ${JSON.stringify(rec.shape_sent)},
              ${rec.block_count}, ${rec.crew_total}, ${rec.id_source}, ${rec.verified_at})
      ON CONFLICT (thread_id, order_id) DO UPDATE
        SET thread_id = EXCLUDED.thread_id, job_id = EXCLUDED.job_id,
            order_number = EXCLUDED.order_number, sender_email = EXCLUDED.sender_email,
            sender_domain = EXCLUDED.sender_domain, company_id = EXCLUDED.company_id,
            place_id = EXCLUDED.place_id, shape_sent = EXCLUDED.shape_sent,
            block_count = EXCLUDED.block_count, crew_total = EXCLUDED.crew_total,
            id_source = EXCLUDED.id_source,
            -- A confirmation is never un-done by a later write that could not confirm.
            -- COALESCE in this direction because "verified once" is a fact about the
            -- past, and an upsert from a run whose read-back failed must not erase it.
            verified_at = COALESCE(EXCLUDED.verified_at, order_records.verified_at)`;
  } catch (err) {
    console.error("[order-records] write failed", err);
  }
}

/**
 * Record a link this engine did not mint, without ever overwriting one it did.
 *
 * `recordOrder` upserts, which is right for the create path: it owns the row and every
 * later write knows more. This one must NOT, because it is called on every pass over a
 * thread that already has an order id, and most of those ids came from
 * `matchExistingOrder` reading OnSinch history. Upserting there would rewrite
 * `thread_id` on a re-match and quietly move a real job to a different client
 * conversation - the failure `orderLink.ts` was built to avoid.
 *
 * So: a (thread, order) pair is written once and never rewritten. With the composite key
 * `thread_id` can no longer be moved by an upsert at all — a different thread claiming the
 * same order is a NEW ROW, which is the real shape: one order, many conversations.
 * ON CONFLICT DO NOTHING is the whole guarantee,
 * and it is why this is a separate function rather than a flag on `recordOrder`.
 *
 * Returns true when a row was actually inserted, so a caller can count what it adopted.
 */
export async function ensureOrderRecord(rec: OrderRecord): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await ensure(sql);
    const rows = (await sql`
      INSERT INTO order_records (order_id, thread_id, job_id, order_number, sender_email,
                                 sender_domain, company_id, place_id, shape_sent, block_count, crew_total,
                                 id_source, verified_at)
      VALUES (${rec.order_id}, ${rec.thread_id}, ${rec.job_id}, ${rec.order_number}, ${rec.sender_email},
              ${rec.sender_domain}, ${rec.company_id}, ${rec.place_id}, ${JSON.stringify(rec.shape_sent ?? {})},
              ${rec.block_count}, ${rec.crew_total}, ${rec.id_source}, ${rec.verified_at})
      ON CONFLICT (thread_id, order_id) DO NOTHING
      RETURNING order_id`) as unknown as Array<{ order_id: number }>;
    return rows.length > 0;
  } catch (err) {
    console.error("[order-records] ensure failed", err);
    return false;
  }
}

export async function orderRecordFor(order_id: number): Promise<OrderRecord | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`SELECT * FROM order_records WHERE order_id = ${order_id}`) as unknown as OrderRecord[];
    return rows[0] ?? null;
  } catch { return null; }
}

/** Every order this thread has produced, newest first - the amendment path's input. */
export async function orderRecordsForThread(thread_id: string): Promise<OrderRecord[]> {
  const sql = db();
  if (!sql) return [];
  try {
    await ensure(sql);
    return (await sql`
      SELECT * FROM order_records WHERE thread_id = ${thread_id}
      ORDER BY created_at DESC`) as unknown as OrderRecord[];
  } catch { return []; }
}
