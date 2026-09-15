import { sql } from './_q.mjs';
const rows = await sql`select thread_id, state from conversation_state`;
let shown = 0;
const keys = new Map();
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    for (const k of Object.keys(a)) keys.set(k, (keys.get(k) ?? 0) + 1);
    if (a.kind === 'patch' && a.ok && shown < 3) { console.log(JSON.stringify(a)); shown++; }
  }
}
console.log('\nfields seen on action-log entries:', [...keys].map(([k,v])=>`${k}(${v})`).join(' '));
