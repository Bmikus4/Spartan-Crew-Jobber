// The 76 client enquiries that never became an order, characterised.
// gate_reason is null on every one of them, so the reason has to be read off
// status + needs_human + the notes the engine wrote as it went.
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  select thread_id, subject, classification, status, needs_human, priority,
         crew_size, location, dates, notes, extracted, created_at
  from tickets
  where is_client_inquiry and onsinch_order_id is null
  order by created_at desc`;
console.log(`${rows.length} client enquiries with no order\n`);

const byStatus = {};
for (const r of rows) {
  const k = `${r.status}${r.needs_human ? ' + needs_human' : ''}`;
  (byStatus[k] ||= []).push(r);
}
for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(v.length).padStart(4)}  ${k}`);
}

// The notes are the engine's own account of why it stopped. Cluster the last one.
const tally = {};
for (const r of rows) {
  const notes = Array.isArray(r.notes) ? r.notes : [];
  const last = notes[notes.length - 1] ?? '(no notes)';
  // Strip the case-specific tail so like reasons group.
  const key = String(last).replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N').slice(0, 110);
  (tally[key] ||= []).push(r.subject);
}
console.log('\nLAST NOTE, CLUSTERED');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
  console.log(`${String(v.length).padStart(4)}  ${k}`);
}

// What was missing from the facts? The order cannot be composed without these.
const missing = { company: 0, contact: 0, date: 0, size: 0, times: 0, place: 0 };
for (const r of rows) {
  const f = r.extracted?.facts ?? {};
  const reqs = Array.isArray(f.requests) ? f.requests : [];
  if (!f.company_name) missing.company++;
  if (!f.contact_email) missing.contact++;
  if (!f.location_text) missing.place++;
  if (!reqs.length || reqs.every((q) => !q.date)) missing.date++;
  if (!reqs.length || reqs.every((q) => !q.size)) missing.size++;
  if (!reqs.length || reqs.every((q) => !q.start_time)) missing.times++;
}
console.log('\nFACTS ABSENT (of ' + rows.length + ')');
for (const [k, v] of Object.entries(missing)) console.log(`  ${k.padEnd(9)} ${v}`);
