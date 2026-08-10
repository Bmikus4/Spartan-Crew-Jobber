// ============================================================================
// Fill in the identifiers a human searches OnSinch with — J<Job.id> and
// R<order.number> — for every ticket that already carries an order.
// ----------------------------------------------------------------------------
// Ben, 2026-08-10: "I was wondering if we could get a job identifier in the
// detail section such as R (Order) number, S (Shift) number or J (Job) Number.
// J number may be best it will be easy to search for the J number and pull up
// the correct job."
//
// Three number spaces exist and only one of them was ever stored:
//
//   api order id   13645   what POST /orders returns; OnSinch's UI never shows it
//   order number   R10560  order.number
//   job number     J13925  Job[0].id, read via ?with=Job — there is no GET /jobs
//
// Verified on the live tenant: a price quote OnSinch generated itself is named
// "R10560 … J13925", and GET /orders?number=10560&with=Job is api id 13645 with
// Job[0].id 13925. So the id the board used to show finds nothing when pasted
// into the search box.
//
// This also REPAIRS a wrong number: backfill-jobs.ts used to write the api id
// into the order-number column, and those rows would now render as an R number
// that belongs to no order. A row whose stored number equals its api id is
// re-read from OnSinch rather than trusted.
//
// Writes BOTH the tickets row and the conversation_state JSONB — the compiler
// carries these forward from prior state, so a ticket-only fix is undone by the
// next email on the thread.
//
// DRY RUN BY DEFAULT.
//   npx tsx scripts/backfill-job-numbers.ts
//   npx tsx scripts/backfill-job-numbers.ts --apply
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv, onsinchGet } from "./_env.mjs";
import type { ConversationState } from "../app/lib/engine/types";

loadEnv();
const APPLY = process.argv.slice(2).includes("--apply");
const KEY = requireEnv("ONSINCH_API_KEY");
const sql = neon(requireEnv("DATABASE_URL"));

const firstJob = (o: Record<string, any>) => (Array.isArray(o.Job) ? o.Job[0] : o.Job) ?? {};

/** One order, with its job. Returns null for an order that no longer exists. */
async function readOrder(id: number): Promise<{ number?: string; job_id?: number } | null> {
  const r = await onsinchGet(`/orders?id=${id}&with=Job`, KEY);
  const rows: Record<string, any>[] = Array.isArray(r?.data) ? r.data : [];
  // Filtering by id is not trusted blindly: unfiltered list queries here have
  // returned the whole ascending page before, so confirm the row is the one asked for.
  const o = rows.find((x) => Number(x?.id) === Number(id));
  if (!o) return null;
  return { number: o.number != null ? String(o.number) : undefined, job_id: firstJob(o).id != null ? Number(firstJob(o).id) : undefined };
}

async function main() {
  await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS onsinch_job_id BIGINT`;

  const rows = (await sql`
    SELECT thread_id, onsinch_order_id, onsinch_order_number, onsinch_job_id
    FROM tickets
    WHERE onsinch_order_id IS NOT NULL
      AND (onsinch_job_id IS NULL
           OR onsinch_order_number IS NULL
           OR onsinch_order_number = onsinch_order_id::text)
    ORDER BY updated_at DESC`) as {
    thread_id: string; onsinch_order_id: number;
    onsinch_order_number: string | null; onsinch_job_id: number | null;
  }[];

  console.log(`\n${rows.length} ticket(s) missing a job or order number.\n`);
  if (!rows.length) return;

  // One API read per DISTINCT order: several threads legitimately share one order.
  const seen = new Map<number, { number?: string; job_id?: number } | null>();
  let fixed = 0, gone = 0, repaired = 0;

  for (const t of rows) {
    const id = Number(t.onsinch_order_id);
    if (!seen.has(id)) seen.set(id, await readOrder(id));
    const live = seen.get(id)!;
    if (!live) {
      gone++;
      console.log(`  GONE   ${t.thread_id}  order api id ${id} no longer in OnSinch`);
      continue;
    }
    const wasPoisoned = t.onsinch_order_number === String(id);
    if (wasPoisoned) repaired++;
    console.log(
      `  ${wasPoisoned ? "REPAIR" : "FILL  "} ${t.thread_id}  api ${id}` +
        `  ->  ${live.job_id ? `J${live.job_id}` : "no job"} ${live.number ? `R${live.number}` : ""}` +
        (wasPoisoned ? `  (was R${t.onsinch_order_number}, which is the api id)` : "")
    );
    if (!APPLY) { fixed++; continue; }

    // The number is overwritten, not COALESCEd: the whole point of a repair row is
    // that the value already there is wrong.
    await sql`
      UPDATE tickets
      SET onsinch_job_id       = COALESCE(${live.job_id ?? null}, onsinch_job_id),
          onsinch_order_number = COALESCE(${live.number ?? null}, onsinch_order_number),
          updated_at = now()
      WHERE thread_id = ${t.thread_id}`;

    const st = (await sql`SELECT state FROM conversation_state WHERE thread_id = ${t.thread_id}`) as { state: ConversationState }[];
    const s = st[0]?.state;
    if (s) {
      s.onsinch_job_id = live.job_id ?? s.onsinch_job_id;
      s.onsinch_order_number = live.number ?? s.onsinch_order_number;
      // state only — status and needs_human are untouched, so the denormalised
      // columns cannot drift out of step with the JSONB they mirror.
      await sql`UPDATE conversation_state SET state = ${JSON.stringify(s)} WHERE thread_id = ${t.thread_id}`;
    }
    fixed++;
  }

  console.log(
    `\n${APPLY ? "applied" : "would fix"}: ${fixed} ticket(s)` +
      (repaired ? `, ${repaired} of them holding the api id as their order number` : "") +
      (gone ? `; ${gone} order(s) no longer exist` : "") +
      `  (${seen.size} order(s) read)`
  );
  if (!APPLY) console.log("(dry run — nothing written. Re-run with --apply.)");
}

main().catch((err) => { console.error(err); process.exit(1); });
