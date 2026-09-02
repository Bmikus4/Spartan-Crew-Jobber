// The tickets that errored. What OnSinch actually said, in full.
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select thread_id, subject, status, classification, notes, created_at
  from tickets
  where notes::text ilike '%createCompany%' or notes::text ilike '%createOrder%'
     or notes::text ilike '%createPlace%' or status = 'error'
  order by created_at desc`;
console.log(`${rows.length} tickets carry a write failure or sit in error\n`);
const seen = {};
for (const r of rows) {
  const notes = (Array.isArray(r.notes) ? r.notes : []).filter((n) => /create(Company|Order|Place)|SlotTeam|4\d\d|5\d\d/.test(String(n)));
  for (const n of notes) {
    const key = String(n).slice(0, 200);
    (seen[key] ||= []).push(r.subject);
  }
}
for (const [k, v] of Object.entries(seen).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n[${v.length}] ${k}`);
  for (const s of v.slice(0, 3)) console.log(`      e.g. ${s}`);
}
