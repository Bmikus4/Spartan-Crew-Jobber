// Which live orders still hold the wrong hour?
//
// Until 2026-09-02 compose stamped every window `+00:00`, so a client's wall clock
// went to OnSinch as UTC and every job dated inside British Summer Time was booked
// an hour late. Staff repaired most of them by hand; this says which are left.
//
// An order is SUSPECT when the job's window still equals, to the hour, the wall
// clock we sent — which under BST means nobody has corrected it. It is REPAIRED
// when the window sits an hour earlier than we sent, i.e. where it should be.
//
// Read-only. Nothing here writes.
//
//   node scripts/audit-live-windows.mjs [--all]
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import { loadEnv, requireEnv, onsinchGet } from './_env.mjs';

loadEnv();
const KEY = requireEnv('ONSINCH_API_KEY');
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.DATABASE_URL);
const FUTURE_ONLY = !process.argv.includes('--all');

// BST windows, from the IANA zone rather than a table, so this keeps working.
const inBst = (day) => {
  const noon = Date.parse(`${day}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(noon)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return /GMT\+1/.test(name);
};

const rows = await sql`
  select thread_id, subject, onsinch_order_id, onsinch_order_number, created_at,
         extracted->'desired_order'->'slot_teams' teams
  from tickets where onsinch_order_id is not null`;
const sent = new Map();
for (const t of rows) {
  if (!Array.isArray(t.teams) || !t.teams.length) continue;
  const mins = t.teams.map((x) => x.beginning).filter(Boolean).sort();
  if (!mins.length) continue;
  sent.set(Number(t.onsinch_order_id), { min: mins[0], num: t.onsinch_order_number, subject: t.subject, thread: t.thread_id });
}

const live = [];
for (let page = 1; page <= 20; page++) {
  const r = await onsinchGet(`/orders?limit=100&page=${page}&with=Job`, KEY);
  const d = r?.data || [];
  if (!d.length) break;
  live.push(...d);
}

const today = new Date().toISOString().slice(0, 10);
const suspect = [], repaired = [], moved = [];
for (const o of live) {
  const s = sent.get(Number(o.id));
  if (!s) continue;
  const job = Array.isArray(o.Job) ? o.Job[0] : o.Job;
  if (!job?.min_beginning) continue;
  const day = String(s.min).slice(0, 10);
  if (!inBst(day)) continue;
  if (FUTURE_ONLY && day < today) continue;
  const delta = (Date.parse(job.min_beginning) - Date.parse(s.min)) / 3600000;
  const row = `R${s.num} ${day} sent ${String(s.min).slice(11, 16)} live ${String(job.min_beginning).slice(11, 16)}  ${s.subject}`;
  if (delta === 0) suspect.push(row);
  else if (delta === -1) repaired.push(row);
  else moved.push(`${row} (delta ${delta}h — moved for other reasons)`);
}

console.log(`\nBST-dated engine orders${FUTURE_ONLY ? ', today onward' : ''}:`);
console.log(`  still an hour late   ${suspect.length}`);
console.log(`  already corrected    ${repaired.length}`);
console.log(`  moved some other way ${moved.length}\n`);
if (suspect.length) {
  console.log('STILL AN HOUR LATE — each needs its blocks moved back one hour:');
  for (const r of suspect) console.log('  ' + r);
}
if (moved.length) {
  console.log('\nNOT A CLEAN COMPARISON — look at these by hand:');
  for (const r of moved) console.log('  ' + r);
}
