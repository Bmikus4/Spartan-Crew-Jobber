import { sql } from './_q.mjs';
const rows = await sql`select deploy_sha, count(*)::int n, min(first_seen_at) first, max(last_seen_at) last
  from error_reports group by 1 order by 4 desc`;
for (const r of rows) console.log(`${String(r.deploy_sha).padEnd(12)} n=${String(r.n).padStart(4)}  ${String(r.first).slice(0,19)} .. ${String(r.last).slice(0,19)}`);
const recent = await sql`select where_at, what, deploy_sha, occurrences, last_seen_at from error_reports order by last_seen_at desc limit 6`;
console.log('\nmost recent reports:');
for (const r of recent) console.log(`  ${String(r.last_seen_at).slice(0,19)}  ${String(r.deploy_sha).padEnd(10)} x${String(r.occurrences).padEnd(4)} ${r.where_at}  ${String(r.what).slice(0,70)}`);
