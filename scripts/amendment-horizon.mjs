// ============================================================================
// HOW LONG-HORIZON IS THE AMENDMENT PROBLEM, AND WHAT CAN WE STILL AMEND?
// ----------------------------------------------------------------------------
// Two questions, both answerable from what we already store:
//
//   1. HORIZON. How far ahead of the job do we write the order, and how late does an
//      amendment arrive after it? If amendments cluster in the first day the problem is
//      a cadence problem; if they arrive weeks later it is a durability problem.
//
//   2. CAPABILITY. An in-place amendment needs the block ids. A nested `POST /orders`
//      never returns them and `GET /slotTeams` is 405, so the only ones we can amend in
//      place are the ones whose ids we KEPT at write time
//      (`conversation_state.last_ordered_team_ids`). Everything else can only be
//      delete-and-repost, which is what turns an amendment into a new R number.
//
// The association itself is the third thing: 207 threads carry an order id in a mutable
// JSON blob, and `order_records` — the durable table built for exactly this — holds 21.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/amendment-horizon.mjs
// ============================================================================
import { sql } from './_q.mjs';

const day = (s) => String(s ?? '').slice(0, 10);
const q = (arr, p) => arr.length ? arr[Math.floor((arr.length - 1) * p)] : null;
const days = (ms) => Math.round(ms / 86400000);

const rows = await sql`select thread_id, state from conversation_state`;

const recs = [];
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  const log = s.order_action_log ?? [];
  const created = log.find((a) => (a.kind === 'create' || a.kind === 'replace') && a.ok);
  if (!created) continue;
  const d = s.desired_order ?? {};
  recs.push({
    thread: r.thread_id,
    order_id: s.onsinch_order_id ?? created.order_id ?? null,
    job_id: s.onsinch_job_id ?? null,
    postedTs: created.ts ?? null,
    jobDay: day(d.slot_teams?.[0]?.beginning),
    teamIds: Array.isArray(s.last_ordered_team_ids) ? s.last_ordered_team_ids.length : 0,
    log,
  });
}
console.log(`threads with an order the engine wrote: ${recs.length}`);

// ── 1. lead time: how far ahead of the job do we write? ─────────────────────
const lead = recs.filter((r) => r.postedTs && r.jobDay)
  .map((r) => days(new Date(r.jobDay + 'T12:00:00').getTime() - r.postedTs))
  .filter((n) => n > -400 && n < 1000).sort((a, b) => a - b);
console.log(`\nlead time, order written -> job happens (days, n=${lead.length}):`);
console.log(`   min ${q(lead, 0)}   p25 ${q(lead, 0.25)}   median ${q(lead, 0.5)}   p75 ${q(lead, 0.75)}   p90 ${q(lead, 0.9)}   max ${q(lead, 1)}`);
for (const [label, test] of [['same week (<=7d)', (n) => n <= 7], ['8-30d', (n) => n > 7 && n <= 30], ['31-90d', (n) => n > 30 && n <= 90], ['over 90d', (n) => n > 90]]) {
  console.log(`   ${label.padEnd(18)} ${lead.filter(test).length}`);
}

// ── 2. how late does the NEXT action arrive after the create? ───────────────
const followLags = [];
const amendLags = [];
for (const r of recs) {
  if (!r.postedTs) continue;
  const later = r.log.filter((a) => a.ts && a.ts > r.postedTs);
  for (const a of later) {
    const d = days(a.ts - r.postedTs);
    followLags.push(d);
    if (a.kind === 'amend' || a.kind === 'patch' || a.kind === 'replace') amendLags.push(d);
  }
}
followLags.sort((a, b) => a - b); amendLags.sort((a, b) => a - b);
console.log(`\nany later action on the same order (days after we wrote it, n=${followLags.length}):`);
console.log(`   median ${q(followLags, 0.5)}   p75 ${q(followLags, 0.75)}   p90 ${q(followLags, 0.9)}   max ${q(followLags, 1)}`);
console.log(`   same day ${followLags.filter((n) => n === 0).length}   1-7d ${followLags.filter((n) => n >= 1 && n <= 7).length}   8-30d ${followLags.filter((n) => n > 7 && n <= 30).length}   over 30d ${followLags.filter((n) => n > 30).length}`);
console.log(`amendment-shaped actions only (n=${amendLags.length}): median ${q(amendLags, 0.5)}  max ${q(amendLags, 1)}` +
  `   over 7d: ${amendLags.filter((n) => n > 7).length}`);

// ── 3. can we amend it in place at all? ─────────────────────────────────────
const linked = recs.filter((r) => r.order_id);
const amendable = linked.filter((r) => r.teamIds > 0);
console.log(`\nCAPABILITY`);
console.log(`   threads with an order id:                 ${linked.length}`);
console.log(`   ...that also kept their block ids:        ${amendable.length}  (${Math.round(amendable.length / Math.max(linked.length, 1) * 100)}%)`);
console.log(`   ...so can ONLY be delete-and-reposted:    ${linked.length - amendable.length}`);

// how far back does the block-id habit go — is it a recent fix?
const withIds = recs.filter((r) => r.teamIds > 0 && r.postedTs).map((r) => new Date(r.postedTs).toISOString().slice(0, 10)).sort();
const noIds = recs.filter((r) => !r.teamIds && r.postedTs).map((r) => new Date(r.postedTs).toISOString().slice(0, 10)).sort();
console.log(`   block ids kept:    first ${withIds[0] ?? '-'}  last ${withIds[withIds.length - 1] ?? '-'}`);
console.log(`   block ids missing: first ${noIds[0] ?? '-'}  last ${noIds[noIds.length - 1] ?? '-'}`);

// ── 4. the durable association ──────────────────────────────────────────────
const orec = await sql`select id_source, count(*) n from order_records group by id_source`;
const inState = await sql`select count(*) n from conversation_state where state->>'onsinch_order_id' is not null`;
console.log(`\nASSOCIATION`);
console.log(`   thread->order links living in conversation_state JSON: ${inState[0].n}`);
console.log(`   durable rows in order_records:                         ${orec.map((o) => `${o.n} ${o.id_source}`).join(', ') || '0'}`);
const orphan = await sql`
  select count(*) n from conversation_state c
  where c.state->>'onsinch_order_id' is not null
    and not exists (select 1 from order_records r where r.thread_id = c.thread_id)`;
console.log(`   linked threads with NO durable row:                    ${orphan[0].n}`);
