// Read-only: how many orders does the ENGINE believe it created, and when?
// The counterpart to approval-forensics --api-survival, which counts what
// OnSinch's audit log says. If OnSinch logged 752 api-creates in a window where
// the engine's own log holds 90 creates ALL TIME, the audit row is not evidence
// of an engine booking and the 2% survival figure has the wrong numerator.
import { sql } from './_q.mjs';
import { loadEnv, requireEnv, onsinchBase } from './_env.mjs';

loadEnv();
const KEY = requireEnv('ONSINCH_API_KEY');

const log = await sql`
  select e->>'kind' kind, count(*) n, min(e->>'ts') first, max(e->>'ts') last
    from conversation_state c,
         lateral jsonb_array_elements(c.state->'order_action_log') e
   group by 1 order by n desc`;
console.log('--- order_action_log, all time, by kind (with the ts format) ---');
for (const r of log) console.log(`  ${String(r.n).padStart(5)}  ${String(r.kind).padEnd(16)} ${r.first} .. ${r.last}`);

const cols = await sql`
  select table_name, string_agg(column_name, ', ' order by ordinal_position) cols
    from information_schema.columns
   where table_schema='public' and table_name in ('metric_events','order_records','order_archive','ticket_events')
   group by table_name`;
console.log('\n--- columns ---');
for (const r of cols) console.log(`  ${r.table_name}: ${r.cols}`);

console.log('\n--- what names do the api-create audit rows carry? ---');
async function get(path) {
  const res = await fetch(onsinchBase() + path, {
    headers: { Authorization: `apikey ${KEY}`, 'Content-Type': 'application/json' },
  });
  return res.ok ? res.json() : null;
}
// One page from the START of the window and one from the END, so a bulk run
// that happened once is not hidden by averaging.
const first = await get('/timelineAudits?action[eq]=order_created_via_api&created[gte]=2026-08-26&limit=100');
const pages = first?.pagination?.pageCount ?? 1;
const samples = [];
for (const page of [1, Math.ceil(pages / 2), pages]) {
  const b = await get(`/timelineAudits?action[eq]=order_created_via_api&created[gte]=2026-08-26&limit=100&page=${page}`);
  for (const a of (b?.data ?? [])) {
    let d = {}; try { d = JSON.parse(a.data); } catch { /* */ }
    samples.push({ page, order_id: d.id, name: String(d.name ?? ''), created: a.created });
  }
}
// Bucket by the hour the row was written: a replay run lands hundreds in minutes.
const byHour = new Map();
for (const s of samples) {
  const h = s.created.slice(0, 13);
  byHour.set(h, (byHour.get(h) ?? 0) + 1);
}
console.log(`  sampled ${samples.length} rows across ${pages} pages`);
console.log('  rows per hour (sampled):');
for (const [h, n] of [...byHour.entries()].sort()) console.log(`    ${h}  ${'#'.repeat(Math.min(n, 60))} ${n}`);

// The names themselves - is this real client work or a test corpus?
const testish = samples.filter((s) => /test|eventz|expo 2023|demo|example/i.test(s.name));
console.log(`\n  ${testish.length}/${samples.length} sampled names look like test data`);
console.log('  --- 20 sampled names ---');
for (const s of samples.slice(0, 10).concat(samples.slice(-10))) {
  console.log(`    #${String(s.order_id).padEnd(6)} ${s.created.slice(0, 16)}  ${s.name.slice(0, 78)}`);
}
