// Intake -> job conversion. How much of what arrives becomes an order in OnSinch,
// and where the rest stops.
//
// The funnel has three floors and they must not be confused:
//   1. MAIL SWEPT      every thread the sweep saw (sweep_threads)
//   2. INTAKE          threads the engine actually ran (tickets)
//   3. ORDER WRITTEN   tickets carrying an onsinch_order_id
// A rate quoted over the wrong floor flatters or damns the engine by a factor of
// several, so all three are printed.
//
// Read-only.  node scripts/funnel.mjs [--days N]
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.DATABASE_URL);
const dArg = process.argv.indexOf('--days');
const DAYS = dArg > -1 ? Number(process.argv[dArg + 1]) : null;
const since = DAYS ? new Date(Date.now() - DAYS * 86400000).toISOString() : '1970-01-01';
console.log(DAYS ? `\nWindow: last ${DAYS} days (since ${since.slice(0, 10)})\n` : '\nWindow: all time\n');

const one = async (q) => (await q)[0];

const swept = await one(sql`select count(*)::int c from sweep_threads where coalesce(last_date, swept_at) >= ${since}`);
const tick = await one(sql`select count(*)::int c from tickets where created_at >= ${since}`);
const ordered = await one(sql`select count(*)::int c from tickets where created_at >= ${since} and onsinch_order_id is not null`);
const clientEnq = await one(sql`select count(*)::int c from tickets where created_at >= ${since} and is_client_inquiry`);

console.log('FLOORS');
console.log(`  mail threads swept        ${swept.c}`);
console.log(`  ran through intake        ${tick.c}`);
console.log(`  judged a client enquiry   ${clientEnq.c}`);
console.log(`  order written to OnSinch  ${ordered.c}`);
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log('\nCONVERSION');
console.log(`  of everything swept       ${pct(ordered.c, swept.c)}`);
console.log(`  of what reached intake    ${pct(ordered.c, tick.c)}`);
console.log(`  of what it called an enquiry ${pct(ordered.c, clientEnq.c)}`);

const byClass = await sql`
  select classification, count(*)::int total,
         count(onsinch_order_id)::int ordered
  from tickets where created_at >= ${since}
  group by 1 order by total desc`;
console.log('\nBY CLASSIFICATION            total  ordered  rate');
for (const r of byClass) {
  console.log(`  ${String(r.classification ?? '(none)').padEnd(26)} ${String(r.total).padStart(5)} ${String(r.ordered).padStart(8)}  ${pct(r.ordered, r.total)}`);
}

const byStatus = await sql`
  select status, count(*)::int total, count(onsinch_order_id)::int ordered
  from tickets where created_at >= ${since} group by 1 order by total desc`;
console.log('\nBY STATUS                    total  ordered');
for (const r of byStatus) {
  console.log(`  ${String(r.status ?? '(none)').padEnd(26)} ${String(r.total).padStart(5)} ${String(r.ordered).padStart(8)}`);
}

// Where a CLIENT ENQUIRY stops. This is the only population the engine is meant
// to convert, so its stall reasons are the actionable list.
const stalls = await sql`
  select coalesce(gate_reason, '(no reason recorded)') reason, count(*)::int c
  from tickets
  where created_at >= ${since} and is_client_inquiry and onsinch_order_id is null
  group by 1 order by c desc limit 30`;
const stalled = stalls.reduce((a, r) => a + r.c, 0);
console.log(`\nCLIENT ENQUIRIES THAT DID NOT BECOME AN ORDER: ${stalled}`);
for (const r of stalls) console.log(`  ${String(r.c).padStart(4)}  ${r.reason}`);

const humanFlag = await one(sql`select count(*)::int c from tickets where created_at >= ${since} and needs_human`);
console.log(`\nneeds_human raised on ${humanFlag.c} of ${tick.c} tickets`);

// Per-week trend: is it improving?
const weekly = await sql`
  select to_char(date_trunc('week', created_at), 'IYYY-"W"IW') wk,
         count(*)::int total, count(onsinch_order_id)::int ordered,
         count(*) filter (where is_client_inquiry)::int enquiries
  from tickets where created_at >= ${since}
  group by 1 order by 1`;
console.log('\nWEEK      intake  enquiries  ordered  rate(of enquiries)');
for (const w of weekly) {
  console.log(`  ${w.wk}  ${String(w.total).padStart(5)} ${String(w.enquiries).padStart(9)} ${String(w.ordered).padStart(8)}  ${pct(w.ordered, w.enquiries)}`);
}
