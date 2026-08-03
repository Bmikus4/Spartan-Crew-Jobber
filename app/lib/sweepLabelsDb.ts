// ============================================================================
// Labels for the swept corpus — the sorting pass, kept beside the corpus.
// ----------------------------------------------------------------------------
// The sweep captures mail and nothing else. This table holds what the engine's own
// brain made of each thread: which threads are real job enquiries, which are updates
// to a job already booked, which are cancellations, and which are junk — plus the
// work blocks it read out of them, with a start and a finish.
//
// Its own table, not a column on sweep_threads: the corpus is raw evidence and must
// stay re-readable, while a labelling pass is a judgement that gets re-run whenever
// the brain or the prompt changes. Re-running must not overwrite the evidence.
//
// One row per thread per model, so two models can be compared over the same corpus
// rather than one silently replacing the other.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function db(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) throw new Error("no DATABASE_URL / POSTGRES_URL in the environment");
  _sql = neon(url);
  return _sql;
}

async function ensure(): Promise<NeonQueryFunction<false, false>> {
  const sql = db();
  if (_ready) return sql;
  await sql`
    CREATE TABLE IF NOT EXISTS sweep_labels (
      thread_id      TEXT NOT NULL,
      model          TEXT NOT NULL,
      classification TEXT,
      is_cancellation BOOLEAN NOT NULL DEFAULT false,
      priority       TEXT,
      job_summary    TEXT,
      company_name   TEXT,
      location_text  TEXT,
      blocks         JSONB NOT NULL DEFAULT '[]'::jsonb,
      first_start    TIMESTAMPTZ,
      last_end       TIMESTAMPTZ,
      -- PEAK crew, not the sum across blocks: four crew over three days is a job for
      -- four people, and summing read it as twelve (one thread scored 61).
      crew_peak      INT,
      crew_days      INT,
      error          TEXT,
      labelled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (thread_id, model)
    )`;
  // The first version of this table summed crew into crew_total. Rename rather than
  // drop, so the handful of rows labelled under the old meaning are still inspectable
  // — and re-labelling overwrites them with the peak.
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sweep_labels' AND column_name = 'crew_total') THEN
        ALTER TABLE sweep_labels RENAME COLUMN crew_total TO crew_peak;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'sweep_labels' AND column_name = 'crew_days') THEN
        ALTER TABLE sweep_labels ADD COLUMN crew_days INT;
      END IF;
    END $$`;
  await sql`CREATE INDEX IF NOT EXISTS sweep_labels_class ON sweep_labels (classification)`;
  await sql`CREATE INDEX IF NOT EXISTS sweep_labels_start ON sweep_labels (first_start)`;
  _ready = true;
  return sql;
}

export interface SweptThread {
  thread_id: string;
  subject: string | null;
  message_count: number;
  first_date: string | null;
  last_date: string | null;
  payload: { thread_id?: string; messages?: unknown[] };
}

/**
 * Threads from the corpus that this model has not laboured over yet. Unlabelled-only
 * by default so an interrupted pass resumes instead of paying for the same threads
 * twice — a full pass is thousands of model calls and real money.
 */
export async function unlabelledThreads(model: string, limit: number, random = false): Promise<SweptThread[]> {
  const sql = await ensure();
  // Random, when asked: newest-first is a recency sample, and a rate measured on it
  // describes last month rather than the year. md5 of the id is a stable shuffle, so
  // a resumed pass keeps drawing from the same order instead of re-sampling.
  const rows = random
    ? await sql`
        SELECT t.thread_id, t.subject, t.message_count, t.first_date, t.last_date, t.payload
        FROM sweep_threads t
        LEFT JOIN sweep_labels l ON l.thread_id = t.thread_id AND l.model = ${model}
        WHERE l.thread_id IS NULL
        ORDER BY md5(t.thread_id) LIMIT ${limit}`
    : await sql`
        SELECT t.thread_id, t.subject, t.message_count, t.first_date, t.last_date, t.payload
        FROM sweep_threads t
        LEFT JOIN sweep_labels l ON l.thread_id = t.thread_id AND l.model = ${model}
        WHERE l.thread_id IS NULL
        ORDER BY t.last_date DESC NULLS LAST LIMIT ${limit}`;
  return rows as unknown as SweptThread[];
}

export interface WorkBlock {
  name?: string;
  beginning: string;   // ISO-8601 with offset
  end: string;         // ISO-8601 with offset
  size?: number;
  task?: string;
  date_confirmed: boolean;
}

export interface LabelRow {
  thread_id: string;
  model: string;
  classification?: string;
  is_cancellation?: boolean;
  priority?: string;
  job_summary?: string;
  company_name?: string;
  location_text?: string;
  blocks?: WorkBlock[];
  /** Largest crew asked for in any single block — not the sum across blocks. */
  crew_peak?: number;
  /** Blocks x crew, i.e. crew-days: what the job costs, kept separately. */
  crew_days?: number;
  error?: string;
}

export async function storeLabel(row: LabelRow): Promise<void> {
  const sql = await ensure();
  const blocks = row.blocks ?? [];
  const starts = blocks.map((b) => Date.parse(b.beginning)).filter(Number.isFinite).sort((a, b) => a - b);
  const ends = blocks.map((b) => Date.parse(b.end)).filter(Number.isFinite).sort((a, b) => a - b);
  const firstStart = starts.length ? new Date(starts[0]).toISOString() : null;
  const lastEnd = ends.length ? new Date(ends[ends.length - 1]).toISOString() : null;
  await sql`
    INSERT INTO sweep_labels (
      thread_id, model, classification, is_cancellation, priority, job_summary,
      company_name, location_text, blocks, first_start, last_end, crew_peak, crew_days, error
    ) VALUES (
      ${row.thread_id}, ${row.model}, ${row.classification ?? null}, ${row.is_cancellation ?? false},
      ${row.priority ?? null}, ${row.job_summary ?? null}, ${row.company_name ?? null},
      ${row.location_text ?? null}, ${JSON.stringify(blocks)}, ${firstStart}, ${lastEnd},
      ${row.crew_peak ?? null}, ${row.crew_days ?? null}, ${row.error ?? null}
    )
    ON CONFLICT (thread_id, model) DO UPDATE SET
      classification = EXCLUDED.classification,
      is_cancellation = EXCLUDED.is_cancellation,
      priority = EXCLUDED.priority,
      job_summary = EXCLUDED.job_summary,
      company_name = EXCLUDED.company_name,
      location_text = EXCLUDED.location_text,
      blocks = EXCLUDED.blocks,
      first_start = EXCLUDED.first_start,
      last_end = EXCLUDED.last_end,
      crew_peak = EXCLUDED.crew_peak,
      crew_days = EXCLUDED.crew_days,
      error = EXCLUDED.error,
      labelled_at = now()`;
}

export async function labelTally(model?: string): Promise<{
  total: number;
  byClass: Array<{ classification: string | null; n: number }>;
  cancellations: number;
  withBlocks: number;
  errors: number;
}> {
  const sql = await ensure();
  // Two spelled-out queries rather than an interpolated WHERE: neon's tagged template
  // binds every ${} as a PARAMETER, so a query fragment arrives as a string literal
  // and Postgres rejects it at the scanner. A model filter of NULL matching everything
  // is the same condition expressed where the driver can bind it.
  const m = model ?? null;
  const [totals] = (await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE is_cancellation)::int AS cancellations,
           COUNT(*) FILTER (WHERE jsonb_array_length(blocks) > 0)::int AS with_blocks,
           COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS errors
    FROM sweep_labels
    WHERE ${m}::text IS NULL OR model = ${m}`) as unknown as Array<{ total: number; cancellations: number; with_blocks: number; errors: number }>;
  const byClass = (await sql`
    SELECT classification, COUNT(*)::int AS n FROM sweep_labels
    WHERE ${m}::text IS NULL OR model = ${m}
    GROUP BY classification ORDER BY n DESC`) as unknown as Array<{ classification: string | null; n: number }>;
  return {
    total: totals?.total ?? 0,
    byClass,
    cancellations: totals?.cancellations ?? 0,
    withBlocks: totals?.with_blocks ?? 0,
    errors: totals?.errors ?? 0,
  };
}
