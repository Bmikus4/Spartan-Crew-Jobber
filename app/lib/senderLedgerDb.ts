// ============================================================================
// Which senders have ever produced a booking, and which never do.
// ----------------------------------------------------------------------------
// This is the highest-leverage filter that improves by itself, and the measurement says
// why: 88.2% of thread-appearances in the corpus come from a sender seen before, and
// just 359 addresses carry 80% of all mail. Identity therefore decides more traffic than
// content ever will, and unlike content it costs nothing to look up.
//
// The ledger records, per address: how many threads they have appeared on, and how many
// of those became a real job. From that:
//
//   trusted  they have produced at least one booking  -> always read, forever
//   parked   PARK_AFTER threads, never a single job   -> skip, but reviewable
//   unknown  not enough evidence either way           -> read
//
// TWO RULES KEEP THIS FROM EATING A CLIENT:
//
// 1. A sender who has EVER produced a job can never be parked. Not decayed, not aged
//    out — never. A venue that books once a year is exactly the client you cannot afford
//    to filter, and their quiet eleven months look identical to a stranger's silence.
//
// 2. Parking is overridable by the message itself. triage.ts checks for a dated crew
//    request first, so even a parked sender gets read the moment they write like a
//    client. The ledger biases who gets read cheaply; it does not get a veto.
//
// The asymmetry is the whole design: a wrongly parked sender costs a booking, a wrongly
// read one costs $0.019.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** Threads with zero jobs before an address is parked. Deliberately not 2 or 3. */
export const PARK_AFTER = 6;

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
    CREATE TABLE IF NOT EXISTS sender_ledger (
      addr         TEXT PRIMARY KEY,
      threads_seen INT NOT NULL DEFAULT 0,
      jobs_seen    INT NOT NULL DEFAULT 0,
      -- A human decision, and the only thing that outranks the counters in either
      -- direction: 'trusted' pins a sender open, 'parked' pins one shut.
      override     TEXT,
      last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
      first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_subject TEXT
    )`;
  await sql`CREATE INDEX IF NOT EXISTS sender_ledger_jobs ON sender_ledger (jobs_seen DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sender_ledger_seen ON sender_ledger (threads_seen DESC)`;
  _ready = true;
}

const norm = (a: string) => (a || "").toLowerCase().trim();

export type SenderVerdict = "trusted" | "parked" | "unknown";

/**
 * What we make of this address. Never throws: an unreachable ledger returns "unknown",
 * which means "read it", because the failure of an optimisation must not drop mail.
 */
export async function senderVerdict(addr: string): Promise<SenderVerdict> {
  const a = norm(addr);
  const sql = db();
  if (!sql || !a) return "unknown";
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT threads_seen, jobs_seen, override FROM sender_ledger WHERE addr = ${a}`) as
      { threads_seen: number; jobs_seen: number; override: string | null }[];
    const r = rows[0];
    if (!r) return "unknown";
    if (r.override === "trusted") return "trusted";
    if (r.override === "parked") return "parked";
    // Rule 1: one booking buys permanent admission.
    if (r.jobs_seen > 0) return "trusted";
    if (r.threads_seen >= PARK_AFTER) return "parked";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Record that this sender appeared on a thread, and whether it turned out to be a job.
 *
 * `threads_seen` counts THREADS, not messages: a chatty ten-message thread is one piece
 * of evidence about a sender, and counting messages would park anyone who writes a lot
 * within a single enquiry.
 */
export async function recordSender(a: {
  addr: string; thread_id: string; wasJob: boolean; subject?: string;
}): Promise<void> {
  const addr = norm(a.addr);
  const sql = db();
  if (!sql || !addr) return;
  try {
    await ensure(sql);
    // One row per (addr, thread) is what makes "threads_seen" honest under re-processing:
    // the same thread is compiled again on every new message and a naive counter would
    // climb on each pass.
    await sql`
      CREATE TABLE IF NOT EXISTS sender_ledger_threads (
        addr TEXT NOT NULL, thread_id TEXT NOT NULL, was_job BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (addr, thread_id)
      )`;
    const claimed = (await sql`
      INSERT INTO sender_ledger_threads (addr, thread_id, was_job)
      VALUES (${addr}, ${a.thread_id}, ${a.wasJob})
      ON CONFLICT (addr, thread_id) DO UPDATE
        -- A thread can only ever gain job status, never lose it: a later "confirmation
        -- only" message must not retract the booking an earlier one established.
        SET was_job = sender_ledger_threads.was_job OR EXCLUDED.was_job
      RETURNING (xmax = 0) AS inserted, was_job`) as { inserted: boolean; was_job: boolean }[];

    const isNewThread = claimed[0]?.inserted === true;
    // Recount rather than increment, so the aggregate can never drift from the rows.
    const [agg] = (await sql`
      SELECT COUNT(*)::int threads, COUNT(*) FILTER (WHERE was_job)::int jobs
      FROM sender_ledger_threads WHERE addr = ${addr}`) as { threads: number; jobs: number }[];

    await sql`
      INSERT INTO sender_ledger (addr, threads_seen, jobs_seen, last_subject)
      VALUES (${addr}, ${agg.threads}, ${agg.jobs}, ${a.subject ?? null})
      ON CONFLICT (addr) DO UPDATE
        SET threads_seen = ${agg.threads},
            jobs_seen    = ${agg.jobs},
            last_seen    = now(),
            last_subject = COALESCE(${a.subject ?? null}, sender_ledger.last_subject)`;
    void isNewThread;
  } catch (err) {
    console.error("[sender-ledger] record failed", addr, err);
  }
}

/** A human pins a sender open or shut. The only path to an override. */
export async function setSenderOverride(addr: string, override: "trusted" | "parked" | null): Promise<void> {
  const a = norm(addr);
  const sql = db();
  if (!sql || !a) return;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO sender_ledger (addr, override) VALUES (${a}, ${override})
      ON CONFLICT (addr) DO UPDATE SET override = ${override}, last_seen = now()`;
  } catch (err) {
    console.error("[sender-ledger] override failed", a, err);
  }
}

/** The parked list, for the review screen — every one of these is a skip a human may reverse. */
export async function parkedSenders(limit = 200): Promise<Array<{ addr: string; threads_seen: number; last_subject: string | null }>> {
  const sql = db();
  if (!sql) return [];
  try {
    await ensure(sql);
    return (await sql`
      SELECT addr, threads_seen, last_subject FROM sender_ledger
      WHERE override IS DISTINCT FROM 'trusted' AND jobs_seen = 0 AND threads_seen >= ${PARK_AFTER}
      ORDER BY threads_seen DESC LIMIT ${limit}`) as unknown as Array<{ addr: string; threads_seen: number; last_subject: string | null }>;
  } catch {
    return [];
  }
}

export async function ledgerStats(): Promise<{ senders: number; trusted: number; parked: number }> {
  const sql = db();
  if (!sql) return { senders: 0, trusted: 0, parked: 0 };
  try {
    await ensure(sql);
    const [r] = (await sql`
      SELECT COUNT(*)::int senders,
             COUNT(*) FILTER (WHERE jobs_seen > 0 OR override = 'trusted')::int trusted,
             COUNT(*) FILTER (WHERE jobs_seen = 0 AND threads_seen >= ${PARK_AFTER} AND override IS DISTINCT FROM 'trusted')::int parked
      FROM sender_ledger`) as { senders: number; trusted: number; parked: number }[];
    return r ?? { senders: 0, trusted: 0, parked: 0 };
  } catch {
    return { senders: 0, trusted: 0, parked: 0 };
  }
}
