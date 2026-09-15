// ============================================================================
// Adopt every thread->order link that only exists in the conversation-state blob.
// ----------------------------------------------------------------------------
// Measured 2026-09-13: 207 threads carry an `onsinch_order_id`, `order_records` held 21
// rows, and 194 links existed nowhere durable. The create path is the only writer that
// was ever wired up, and it has only been running since 2026-09-03 — so every link older
// than that, and every link acquired by matching rather than creating, is in a JSON
// column that the next pass over the thread rewrites wholesale.
//
// The pipeline now adopts a link as it goes (pipeline.ts, `ensureOrderRecord`), but that
// only fires when a thread is next processed. A thread whose job is 199 days out may not
// be touched for months, and it is exactly the long-horizon case the amendment work
// exists for. So the backlog is adopted here, once.
//
// WHAT THIS WILL NOT DO:
//   - overwrite anything. INSERT ... ON CONFLICT DO NOTHING, so a row the create path
//     already wrote keeps its `api_response` provenance and its `verified_at`.
//   - claim a verification. Every row it writes is `id_source='matched'` with
//     `verified_at=null`, because a link read out of a blob is a reading, not a fact.
//     Null is a third state and conflating it with false is what made "39 of 47 recorded
//     ids do not resolve" read as one finding when it is two.
//   - touch OnSinch. No network calls at all; this is Neon to Neon.
//
//   npx tsx scripts/backfill-order-records.ts            # report only, writes nothing
//   npx tsx scripts/backfill-order-records.ts --write
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";
import { buildOrderRecord, ensureOrderRecord } from "../app/lib/orderRecordsDb";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

const WRITE = process.argv.includes('--write');

// tsx compiles these scripts as CJS, which has no top-level await.
(async () => {

type Cand = {
  order_id: number; thread_id: string; job_id: number | null; order_number: string | null;
  sender_email: string | null; sender_domain: string | null; place_id: number | null;
  shape_sent: unknown; id_source: "matched"; verified_at: null;
};
const rec = (c: Cand) => c;

const rows = (await sql`select thread_id, state from conversation_state`) as Array<{ thread_id: string; state: unknown }>;
const existing = new Set(
  ((await sql`select thread_id, order_id from order_records`) as Array<{ thread_id: string; order_id: number }>)
    .map((r) => r.thread_id + '|' + Number(r.order_id))
);
console.log(`threads: ${rows.length}   order_records already holding: ${existing.size}`);

const candidates: Array<ReturnType<typeof rec>> = [];
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  const order_id = Number(s.onsinch_order_id);
  if (!Number.isInteger(order_id) || order_id <= 0) continue;
  candidates.push(rec({
    order_id,
    thread_id: r.thread_id,
    job_id: Number.isInteger(Number(s.onsinch_job_id)) ? Number(s.onsinch_job_id) : null,
    order_number: s.onsinch_order_number != null ? String(s.onsinch_order_number) : null,
    sender_email: s.sender_email ?? null,
    sender_domain: s.sender_domain ?? null,
    place_id: s.desired_order?.slot_teams?.[0]?.place_id ?? s.place_id ?? null,
    shape_sent: s.desired_order ?? {},
    id_source: 'matched',
    verified_at: null,
  }));
}

// ONE ORDER, MANY THREADS. This used to refuse any order claimed by more than one thread,
// on the assumption that multiplicity meant conflict. Measured 2026-09-13: of the 19 such
// orders, 12 are a single job the client emailed about across several Gmail threads - the
// PO in one, a crew change in another, a quote reply in a third - and no two of those
// threads share a message id. So every (thread, order) pair is adopted, and the count of
// multi-thread orders is reported because it is worth seeing, not because it is an error.
const byOrder = new Map<number, Array<ReturnType<typeof rec>>>();
for (const c of candidates) {
  const list = byOrder.get(c.order_id) ?? [];
  list.push(c);
  byOrder.set(c.order_id, list);
}
const contested = [...byOrder.entries()].filter(([, v]) => v.length > 1);
const missing = candidates.filter((c) => !existing.has(c.thread_id + '|' + c.order_id));

console.log(`links in conversation_state: ${candidates.length}`);
console.log(`   already durable:          ${candidates.length - missing.length}`);
console.log(`   to adopt:                 ${missing.length}`);
console.log(`   orders held by more than one thread (expected, not an error): ${contested.length}`);
for (const [id, v] of contested) console.log(`      #${id}: ${v.length} threads`);

const noShape = missing.filter((c) => !c.shape_sent || !Object.keys(c.shape_sent).length).length;
const noNumber = missing.filter((c) => !c.order_number).length;
console.log(`\nof those to adopt: ${noShape} carry no shape (unmatchable later), ${noNumber} carry no R number`);

if (!WRITE) {
  console.log(`\nreport only. re-run with --write to adopt ${missing.length}.`);
  console.log(`first 10:`);
  for (const c of missing.slice(0, 10)) console.log(`   #${c.order_id} ${c.thread_id} R${c.order_number ?? '?'} job ${c.job_id ?? '?'}`);
  process.exit(0);
}

let wrote = 0, skipped = 0;
for (const c of missing) {
  const inserted = await ensureOrderRecord(buildOrderRecord(c as Parameters<typeof buildOrderRecord>[0]));
  if (inserted) wrote++; else skipped++;
}
console.log(`\nadopted ${wrote}, already present ${skipped}`);

const after = (await sql`select id_source, count(*) n from order_records group by id_source`) as Array<{ id_source: string; n: number }>;
console.log(`order_records now: ${after.map((a) => `${a.n} ${a.id_source}`).join(', ')}`);
})();
