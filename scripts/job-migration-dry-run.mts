// ============================================================================
// Dry run of the job migration against the live database. WRITES NOTHING.
// ----------------------------------------------------------------------------
// Design §30 step 4's gate. Reads order_records and conversation_state, plans the jobs
// with planJobMigration, then proves the plan fits the target schema by creating the
// tables and inserting every planned row INSIDE A TRANSACTION THAT IS FORCED TO ABORT.
// If the schema or its constraints refuse the plan, the error says which; either way no
// table and no row survives.
//
// The partial unique index on live links is invariant I3 at job level: an OnSinch order
// is claimed by one job at a time. The plan satisfies it by construction (a job is a
// connected set of threads and orders); the insert proves it.
//
// Run: npx tsx scripts/job-migration-dry-run.mts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { planJobMigration, type OrderRecordRow, type StateRow } from "../app/lib/engine/jobMigration";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

const records = (await sql`SELECT order_id, thread_id, job_id, company_id, id_source FROM order_records`) as OrderRecordRow[];
const states = ((await sql`SELECT thread_id, state FROM conversation_state`) as Array<{ thread_id: string; state: any }>).map(
  (r): StateRow => ({
    thread_id: r.thread_id,
    classification: r.state?.classification,
    company_id: r.state?.company_id ?? null,
    onsinch_order_id: r.state?.onsinch_order_id ?? null,
    order_action_log: r.state?.order_action_log ?? [],
  })
);
const { jobs, report } = planJobMigration(records, states);
console.log("PLAN", JSON.stringify(report, null, 1));

const SENTINEL = "dry-run: every planned row inserted";
let verdict = "";
try {
  await sql.transaction((tx) => [
    tx`CREATE TABLE IF NOT EXISTS jobs (
         job_id TEXT PRIMARY KEY, company_id BIGINT, created_from_message TEXT, merged_into TEXT,
         state JSONB, state_version INT NOT NULL DEFAULT 0, lease_holder TEXT, lease_until TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    tx`CREATE TABLE IF NOT EXISTS job_links (
         id BIGSERIAL PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(job_id), kind TEXT NOT NULL,
         onsinch_id BIGINT NOT NULL, block_ref TEXT, source TEXT NOT NULL, evidence JSONB,
         valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ)`,
    tx`CREATE UNIQUE INDEX IF NOT EXISTS job_links_live ON job_links (kind, onsinch_id) WHERE valid_to IS NULL`,
    ...jobs.map((j) => tx`INSERT INTO jobs (job_id, company_id) VALUES (${j.job_key}, ${j.company_ids[0] ?? null})`),
    // One live link per order: a job holding an order through two threads links it once.
    ...jobs.flatMap((j) =>
      [...new Map(j.links.map((l) => [l.onsinch_order_id, l])).values()].map(
        (l) => tx`INSERT INTO job_links (job_id, kind, onsinch_id, source, evidence)
                  VALUES (${j.job_key}, 'order', ${l.onsinch_order_id}, ${l.source}, ${JSON.stringify({ threads: j.threads, seen_in: l.seen_in })})`
      )
    ),
    tx`SELECT CASE WHEN (SELECT count(*) FROM job_links) >= 0 THEN (SELECT 1 / 0) END`,
  ]);
  verdict = "UNEXPECTED: the transaction committed";
} catch (e: any) {
  verdict = /division by zero/.test(String(e?.message)) ? SENTINEL : `REFUSED: ${e?.message}`;
}
const left = await sql`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('jobs', 'job_links')`;
console.log("SCHEMA", verdict, "| tables left behind:", left[0].n);
process.exitCode = verdict === SENTINEL && left[0].n === 0 ? 0 : 1;
