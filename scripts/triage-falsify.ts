// ============================================================================
// Does the filter throw away real jobs? The only question that matters.
// ----------------------------------------------------------------------------
// triage-study.ts measured what triage DOES: 55.9% skipped. That is not the same claim
// as "it is right", and the difference is the whole risk. This script tries to break it,
// using the only ground truth that exists:
//
//   sweep_labels  — threads the engine's own brain read and classified (206 threads)
//   OnSinch       — 6,686 real orders, i.e. jobs that definitely happened
//
// A skip on a thread that was labelled new-job or update, or that became a real order,
// is a MISS: a booking the filter would have binned. One is worth knowing about; a
// handful means the design is wrong.
//
// It also sizes the risk surface honestly. Not all skips are equal — "this is our own
// outbound" cannot be wrong, while "this sender never books" is a judgement. Counting
// how many decisions are judgements is the fair way to describe exposure.
//
//   npx tsx scripts/triage-falsify.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { corpusByThreadId, readCorpus } from "./_corpus.mjs";
import { readFileSync } from "node:fs";
import { normalizeThread } from "../app/lib/engine/normalize";
import { triage } from "../app/lib/engine/triage";
import type { HydratedThread, ThreadMessage } from "../app/lib/engine/types";

const env = readFileSync(process.cwd() + "/.env.local", "utf8");
const g = (k: string) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^"|"$/g, "");
const sql = neon(g("DATABASE_URL")!);
const pct = (n: number, d: number) => (d ? (100 * n / d).toFixed(1) + "%" : "n/a");

/** Tiers where being wrong is structurally impossible, vs tiers that are a judgement. */
const STRUCTURAL = new Set(["own-mail", "machine-sender", "no-content", "auto-reply"]);

async function main() {
  // ------------------------------------------------ 1. skips vs the model's own labels
  // The label join stays in SQL; only the mail comes from disk.
  const corpus = await corpusByThreadId();
  const labelRows = (await sql`
    SELECT l.thread_id, l.classification, l.crew_peak
    FROM sweep_labels l JOIN sweep_threads t ON t.thread_id = l.thread_id
    WHERE l.error IS NULL`) as Array<{
      thread_id: string; classification: string | null; crew_peak: number | null;
    }>;
  const labelled = labelRows.map((r) => ({
    ...r, payload: (corpus.get(r.thread_id)?.payload ?? { messages: [] }) as { messages?: unknown[] },
  }));

  const res = { checked: 0, jobs: 0, jobsSkipped: 0, nonJobs: 0, nonJobsSkipped: 0 };
  const misses: string[] = [];

  for (const row of labelled) {
    const msgs = (row.payload?.messages ?? []) as ThreadMessage[];
    if (!msgs.length) continue;
    let latest: ThreadMessage;
    try { ({ latest } = normalizeThread({ thread_id: row.thread_id, messages: msgs } as HydratedThread)); }
    catch { continue; }
    res.checked++;

    const t = await triage({
      from: latest.from, subject: latest.subject, body: latest.body, is_from_spartan: latest.is_from_spartan,
    });
    const wasJob = row.classification === "new-job" || row.classification === "update";
    if (wasJob) {
      res.jobs++;
      if (t.verdict === "skip") {
        res.jobsSkipped++;
        misses.push(`${row.thread_id}  [${t.tier}]  crew=${row.crew_peak ?? "-"}  ${String(latest.subject).slice(0, 52)}`);
      }
    } else {
      res.nonJobs++;
      if (t.verdict === "skip") res.nonJobsSkipped++;
    }
  }

  console.log(`\n=== SKIPS vs THE MODEL'S OWN LABELS (${res.checked} labelled threads) ===`);
  console.log(`threads the model called a JOB      ${res.jobs}`);
  console.log(`  ...that triage would SKIP         ${res.jobsSkipped}  <- every one is a booking binned`);
  console.log(`threads the model called NOT a job  ${res.nonJobs}`);
  console.log(`  ...that triage also skips         ${res.nonJobsSkipped} = ${pct(res.nonJobsSkipped, res.nonJobs)} (agreement, for free)`);
  if (misses.length) {
    console.log(`\n--- MISSES, read these by hand ---`);
    for (const m of misses.slice(0, 20)) console.log(`  ${m}`);
  }

  // ------------------------------------- 2. skips on threads that became REAL orders
  // Independent of the model: these jobs demonstrably happened, whatever anything thought.
  // The one query that spanned the corpus and production. tickets is still in Postgres and
  // the corpus is not, so it is two reads and a Set rather than a join.
  const orderedIds = (await sql`
    SELECT k.thread_id FROM tickets k WHERE k.onsinch_order_id IS NOT NULL`) as Array<{ thread_id: string }>;
  const ordered = orderedIds
    .map((r) => corpus.get(r.thread_id))
    .filter(Boolean)
    .map((r: any) => ({ thread_id: r.thread_id as string, payload: r.payload as { messages?: unknown[] } }));

  let orderSkips = 0;
  for (const row of ordered) {
    const msgs = (row.payload?.messages ?? []) as ThreadMessage[];
    if (!msgs.length) continue;
    let latest: ThreadMessage;
    try { ({ latest } = normalizeThread({ thread_id: row.thread_id, messages: msgs } as HydratedThread)); }
    catch { continue; }
    const t = await triage({ from: latest.from, subject: latest.subject, body: latest.body, is_from_spartan: latest.is_from_spartan });
    if (t.verdict === "skip") {
      orderSkips++;
      console.log(`  ORDER-BEARING THREAD SKIPPED: ${row.thread_id} [${t.tier}] ${String(latest.subject).slice(0, 50)}`);
    }
  }
  console.log(`\n=== SKIPS ON THREADS THAT BECAME REAL ONSINCH ORDERS ===`);
  console.log(`threads with a linked order: ${ordered.length}   of which skipped: ${orderSkips}`);

  // ----------------------------------------------------- 3. how much is a JUDGEMENT
  const tiers = new Map<string, number>();
  // One pass over the on-disk corpus, in the same thread_id order the paged query used.
  let total = 0;
  {
    for await (const row of readCorpus()) {
      for (const m of ((row.payload?.messages ?? []) as ThreadMessage[])) {
      total++;
      const t = await triage({
        from: String(m.from ?? ""), subject: String(m.subject ?? ""),
        body: String(m.body ?? ""), is_from_spartan: m.is_from_spartan,
      });
      if (t.verdict === "skip") tiers.set(t.tier, (tiers.get(t.tier) ?? 0) + 1);
      }
    }
  }
  let structural = 0, judgement = 0;
  for (const [tier, n] of tiers) { if (STRUCTURAL.has(tier)) structural += n; else judgement += n; }
  console.log(`\n=== THE RISK SURFACE: how many skips are actually a JUDGEMENT? ===`);
  console.log(`structurally safe skips  ${structural} = ${pct(structural, total)}   (our own mail, unrepliable addresses, OOO, empty)`);
  console.log(`judgement skips          ${judgement} = ${pct(judgement, total)}   (bulk guess, vendor domain, parked sender)`);
  console.log(`  -> only ${pct(judgement, structural + judgement)} of all filtering decisions involve any judgement at all`);
}

main().catch((e) => { console.error(e); process.exit(1); });
