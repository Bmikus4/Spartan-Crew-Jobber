// ============================================================================
// WHERE DO THE ENGINE'S ORDERS GO?
// ----------------------------------------------------------------------------
// The open question from 2026-09-02: orders created through the API do not
// survive (8 of 398, 2%) while orders raised in the OnSinch UI do (51 of 52,
// 98%). Ben's unverified explanation: "the jobs are being approved by the team
// internally".
//
// If approval is the cause then an approved job still EXISTS - under a
// different id - and the engine's recorded id is merely dead. That is a
// different defect from a lost booking, and it decides between "teach the
// engine that approved-and-renumbered is a terminal state" and "5,693 bookings
// were destroyed".
//
// THE TEST. For each engine-recorded id that reads back ABSENT, ask whether a
// PRESENT order exists for the same company on the same day. A hit means the
// work was never lost, only renumbered. A miss means it was lost.
//
// WHAT MAKES THIS POSSIBLE. The filter oracle, 2026-09-03: `?ZZZ=1` names every
// allowed filter field in its 400.
//   Order          id, company_id, user_id, agency_invoice_address_id,
//                  order_manager_id, name, specification, number, status,
//                  quote, provisional, reverse_charge, happening, created,
//                  modified, creator, modifier, intern_name
//   TimelineAudit  id, action, data, creator, created
// So the audit log can be filtered by ACTION and by a CREATED WINDOW rather
// than by the `data[like]=%15761%` substring match, which returns ~100 rows for
// any five-digit number and means nothing.
//
// Read-only. Nothing here writes to OnSinch or to the database.
//
//   node scripts/approval-forensics.mjs --recon     # schema + filter oracles
//   node scripts/approval-forensics.mjs --actions   # what actions exist, counted
//   node scripts/approval-forensics.mjs --survive   # THE TEST
// ============================================================================
import { sql } from './_q.mjs';
import { loadEnv, requireEnv, onsinchBase } from './_env.mjs';

loadEnv();
const KEY = requireEnv('ONSINCH_API_KEY');
const arg = (f) => process.argv.includes(f);

/** GET returning status and body rather than throwing, so a 400 can be read. */
async function probe(path) {
  const res = await fetch(onsinchBase() + path, {
    headers: { Authorization: `apikey ${KEY}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 400); }
  return { status: res.status, body };
}

/** GET that throws on a non-200, for calls whose failure must not read as "absent". */
async function get(path) {
  const r = await probe(path);
  if (r.status !== 200) throw new Error(`GET ${path} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

const rows = (b) => (Array.isArray(b?.data) ? b.data : []);
const day = (s) => String(s ?? '').slice(0, 10);

// ============================================================== --recon
if (arg('--recon')) {
  for (const [label, path] of [
    ['/orders filter fields', '/orders?ZZZ=1'],
    ['/orders relations', '/orders?with=ZZZ'],
    ['/timelineAudits filter fields', '/timelineAudits?ZZZ=1'],
    ['operator oracle: action[zzz]', '/timelineAudits?action[zzz]=x'],
    ['creator[eq]= empty on /orders', '/orders?creator[eq]=&limit=2'],
    ['status values present', '/orders?limit=1'],
  ]) {
    const r = await probe(path);
    console.log(`\n--- ${label} (HTTP ${r.status}) ---`);
    console.log(JSON.stringify(r.body).slice(0, 1200));
  }
  process.exit(0);
}

// ============================================================== --actions
// WHICH ACTIONS EXIST, AND IS THERE ONE THAT REMOVES AN ORDER? Counted over a
// window rather than sampled, because the question is whether a delete or an
// approval leaves any trace at all - and a trace that appears twice in 900,000
// rows is exactly what a sample misses.
if (arg('--actions')) {
  const since = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-26';
  const counts = new Map();
  const orderish = [];
  let page = 1;
  for (; page <= 60; page++) {
    const b = await get(`/timelineAudits?created[gte]=${since}&limit=100&page=${page}`);
    const r = rows(b);
    if (!r.length) break;
    for (const a of r) {
      counts.set(a.action, (counts.get(a.action) ?? 0) + 1);
      if (/order/i.test(String(a.action))) orderish.push(a);
    }
    if (!b?.pagination?.nextPage) break;
  }
  const total = [...counts.values()].reduce((x, y) => x + y, 0);
  console.log(`\n${total} audit rows since ${since}, over ${page} pages, ${counts.size} distinct actions\n`);
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${k}`);
  }
  console.log('\n--- every order-shaped action, with its payload keys ---');
  const byAction = new Map();
  for (const a of orderish) {
    if (!byAction.has(a.action)) byAction.set(a.action, []);
    byAction.get(a.action).push(a);
  }
  for (const [k, list] of byAction) {
    let d = {};
    try { d = JSON.parse(list[0].data); } catch { /* string payload */ }
    console.log(`\n  ${k}  x${list.length}  creator=${[...new Set(list.map((x) => x.creator))].slice(0, 8).join(',')}`);
    console.log(`    keys: ${Object.keys(d).join(', ')}`);
    console.log(`    first: ${String(list[0].data).slice(0, 220)}`);
  }
  process.exit(0);
}

// ============================================================== --counts
// THE DENOMINATORS, TAKEN FROM THE SERVER RATHER THAN COUNTED BY PAGING.
// `pagination.count` on a limit=1 read is the total matching rows, so one call
// per action gives the true figure. The 2% survival finding rested on "5,698
// API creates" and "398 in the window"; both were counted by walking pages of a
// substring query, which is the one thing this API's paginator cannot be
// trusted for.
if (arg('--counts')) {
  const actions = [
    'order_create', 'order_created_via_api', 'order_change', 'order_delete', 'order_remove',
    'order_cancel', 'order_convert_to_quote', 'order_approve', 'order_approved',
    'order_request_approval', 'order_approval', 'job_publish', 'job_create', 'job_delete',
    'slot_team_close', 'slot_team_create', 'slot_team_delete', 'slot_team_change',
  ];
  console.log('action                        total ever   (404-shaped 0 = the action does not exist)');
  for (const a of actions) {
    const p = await probe(`/timelineAudits?action[eq]=${a}&limit=1`);
    const n = p.body?.pagination?.count;
    const first = rows(p.body)[0];
    console.log(`  ${a.padEnd(26)} ${String(n ?? '?').padStart(8)}   ${first ? String(first.data).slice(0, 90) : ''}`);
  }
  const all = await probe('/timelineAudits?limit=1');
  console.log(`\n  ${'ALL audit rows'.padEnd(26)} ${String(all.body?.pagination?.count).padStart(8)}`);
  const o = await probe('/orders?limit=1');
  console.log(`  ${'ALL orders present'.padEnd(26)} ${String(o.body?.pagination?.count).padStart(8)}`);
  process.exit(0);
}

// ============================================================== --api-survival
// DO THE IDS IN `order_created_via_api` NAME ORDERS THAT EXIST?
//
// The 2% figure compared 5,708 `order_created_via_api` audit rows against a
// tenant holding 6,880 orders and concluded 5,693 bookings were destroyed. Two
// things make that comparison unsafe and both are measured here instead:
//
//   1. `/orders/{id}` RETURNS 404 FOR EVERY ID, including ids that exist -
//      15761 is 404 by path and present by `?id[eq]=`. A read done the first
//      way reports every order absent.
//   2. The audit payload's `data.id` is a STRING on api-create rows ("7500")
//      and a NUMBER on UI rows (119). Whether it is even an Order id in the
//      same space is exactly what is in question.
//
// So: take the audit rows themselves, newest first, and resolve each id the way
// that works. Grouped by creator, because 5,708 rows going back to 2023 are not
// all this engine's.
if (arg('--api-survival')) {
  const since = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-26';
  // The paginator orders TimelineAudit.id ASC and `sort` is not honoured, so
  // walk to the last page of the filtered set rather than trusting page 1.
  const first = await get(`/timelineAudits?action[eq]=order_created_via_api&created[gte]=${since}&limit=100`);
  const pages = first?.pagination?.pageCount ?? 1;
  const audits = [];
  for (let page = 1; page <= pages && page <= 40; page++) {
    const b = await get(`/timelineAudits?action[eq]=order_created_via_api&created[gte]=${since}&limit=100&page=${page}`);
    audits.push(...rows(b));
  }
  console.log(`${audits.length} order_created_via_api rows since ${since} (server says ${first?.pagination?.count})`);

  const byCreator = new Map();
  for (const a of audits) {
    let d = {}; try { d = JSON.parse(a.data); } catch { /* */ }
    const k = String(a.creator ?? 'null');
    if (!byCreator.has(k)) byCreator.set(k, []);
    byCreator.get(k).push({ audit_id: a.id, order_id: Number(d.id), name: d.name, created: a.created, model: d.model });
  }
  console.log('\n--- who is creating orders through the API ---');
  for (const [k, list] of [...byCreator.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const models = [...new Set(list.map((x) => x.model))].join(',');
    console.log(`  creator=${k.padEnd(6)} ${String(list.length).padStart(4)} rows  model=${models}  ids ${Math.min(...list.map((x) => x.order_id))}-${Math.max(...list.map((x) => x.order_id))}`);
  }

  // Resolve every distinct id, once, the way that works.
  const ids = [...new Set(audits.map((a) => { try { return Number(JSON.parse(a.data).id); } catch { return NaN; } }))].filter(Number.isInteger);
  console.log(`\nresolving ${ids.length} distinct ids via ?id[eq]= ...`);
  const state = new Map();
  for (const id of ids) {
    const p = await probe(`/orders?id[eq]=${id}`);
    if (p.status !== 200) { state.set(id, 'unreadable'); continue; }
    const o = rows(p.body)[0];
    state.set(id, o ? `present creator=${o.creator ?? 'null'} approval=${o.request_approval ?? '-'} status=${o.status}` : 'ABSENT');
  }
  const presentIds = ids.filter((i) => String(state.get(i)).startsWith('present'));
  const absentIds = ids.filter((i) => state.get(i) === 'ABSENT');
  console.log(`\n=== ${presentIds.length}/${ids.length} present (${Math.round((presentIds.length / ids.length) * 100)}%), ${absentIds.length} absent ===`);
  const shape = new Map();
  for (const i of presentIds) shape.set(state.get(i), (shape.get(state.get(i)) ?? 0) + 1);
  for (const [k, n] of [...shape.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\n--- absent ids (first 40) ---\n  ${absentIds.slice(0, 40).join(' ')}`);
  process.exit(0);
}

// ============================================================== --approval
// IS THERE AN APPROVAL SURFACE, AND DOES IT HIDE AN ORDER FROM /orders?
//
// Order 15788, read 2026-09-03, carries a field the API reference never
// mentions: `request_approval: "1"`. It also carries `creator: 2257`, and
// `?creator[eq]=` (empty) matches zero of 6,880 orders - so NO order in this
// tenant has a null creator, which falsifies the `slotTeamsForOrder` docstring
// that A11 was built on. If 2257 is the API key's user then `creator[eq]=2257`
// counts exactly the API-created orders that are STILL PRESENT, and that is the
// denominator the 2% figure was missing.
if (arg('--approval')) {
  console.log('--- how many orders does each creator still have? ---');
  const creators = new Map();
  for (let page = 1; page <= 70; page++) {
    const b = await get(`/orders?limit=100&page=${page}`);
    const r = rows(b);
    if (!r.length) break;
    for (const o of r) {
      const k = `creator=${o.creator ?? 'null'}`;
      const c = creators.get(k) ?? { n: 0, statuses: new Map(), approval: new Map(), minId: Infinity, maxId: 0, first: '', last: '' };
      c.n++;
      c.statuses.set(o.status, (c.statuses.get(o.status) ?? 0) + 1);
      c.approval.set(String(o.request_approval ?? 'absent'), (c.approval.get(String(o.request_approval ?? 'absent')) ?? 0) + 1);
      c.minId = Math.min(c.minId, Number(o.id)); c.maxId = Math.max(c.maxId, Number(o.id));
      const d = day(o.created);
      if (!c.first || d < c.first) c.first = d;
      if (!c.last || d > c.last) c.last = d;
      creators.set(k, c);
    }
    if (!b?.pagination?.nextPage) break;
  }
  const tot = [...creators.values()].reduce((x, c) => x + c.n, 0);
  console.log(`${tot} orders swept, ${creators.size} distinct creators\n`);
  for (const [k, c] of [...creators.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
    const st = [...c.statuses.entries()].map(([s, n]) => `${s}:${n}`).join(' ');
    const ap = [...c.approval.entries()].map(([s, n]) => `${s}:${n}`).join(' ');
    console.log(`  ${String(c.n).padStart(5)}  ${k.padEnd(16)} ids ${c.minId}-${c.maxId}  ${c.first}..${c.last}  status[${st}]  request_approval[${ap}]`);
  }

  console.log('\n--- does a status filter reveal anything /orders hides? ---');
  for (const q of ['status[eq]=1', 'status[eq]=2', 'status[gte]=1', 'status[eq]=-1', 'status[eq]=-2',
                   'request_approval[eq]=1', 'quote[eq]=1', 'provisional[eq]=1']) {
    const p = await probe(`/orders?${q}&limit=1`);
    console.log(`  ${q.padEnd(26)} HTTP ${p.status}  count=${p.body?.pagination?.count ?? JSON.stringify(p.body).slice(0, 110)}`);
  }

  console.log('\n--- three ids we recorded and cannot find, asked every way ---');
  for (const id of [15761, 15762, 15763, 15722]) {
    for (const q of [`/orders?id[eq]=${id}`, `/orders/${id}`, `/orders?id[eq]=${id}&status[gte]=-9`,
                     `/orders?number[eq]=${id}`]) {
      const p = await probe(q);
      const n = p.body?.pagination?.count;
      console.log(`  ${q.padEnd(40)} HTTP ${p.status} count=${n ?? '-'} ${rows(p.body).length ? 'ROW' : ''}`);
    }
  }

  console.log('\n--- is there an approval endpoint at all? 404 = no such resource, 405 = exists, GET barred ---');
  for (const p of ['/orderApprovals', '/approvals', '/orderRequests', '/requestApprovals', '/orderApproval']) {
    const r = await probe(p + '?limit=1');
    console.log(`  ${p.padEnd(20)} HTTP ${r.status} ${String(JSON.stringify(r.body)).slice(0, 90)}`);
  }
  process.exit(0);
}

// ============================================================== --survive
if (arg('--survive')) {
  // ------------------------------------------------------ what the engine recorded
  // `last_ordered_teams` is the shape actually sent (59 threads); `desired_order`
  // is the latest compile and is overwritten every message, so it is the fallback
  // and is labelled as such. The DATE is what the comparison turns on, so where
  // the two disagree the sent shape wins.
  const recorded = await sql`
    select c.thread_id,
           (c.state->>'onsinch_order_id')::int      order_id,
           c.state->>'onsinch_order_number'         order_number,
           (c.state->>'company_id')::int            company_id,
           c.state->>'subject'                      subject,
           coalesce(
             c.state->'last_ordered_teams'->0->>'beginning',
             c.state->'desired_order'->'slot_teams'->0->>'beginning'
           )                                        first_block,
           (c.state->'last_ordered_teams') is not null  from_sent_shape
      from conversation_state c
     where c.state->>'onsinch_order_id' is not null
     order by (c.state->>'onsinch_order_id')::int desc`;

  console.log(`${recorded.length} threads carry an onsinch_order_id`);
  const withCompany = recorded.filter((r) => Number.isInteger(r.company_id)).length;
  const withDate = recorded.filter((r) => day(r.first_block).length === 10).length;
  console.log(`  ${withCompany} carry a company_id, ${withDate} carry a first-block date`);

  // ------------------------------------------------------ present or absent, by id
  // BY ID, ONE AT A TIME. The bulk list is not a reliable denominator: pagination
  // on /orders is non-contiguous (page 1 of a 100-row read spanned 15764 down to
  // 13782), so absence from a sweep is not absence.
  const live = new Map();
  for (const r of recorded) {
    const p = await probe(`/orders?id[eq]=${r.order_id}&with=Job`);
    if (p.status !== 200) { live.set(r.order_id, { error: p.status }); continue; }
    const hit = rows(p.body)[0];
    live.set(r.order_id, hit ? { present: true, o: hit } : { present: false });
  }
  const present = recorded.filter((r) => live.get(r.order_id)?.present);
  const absent = recorded.filter((r) => live.get(r.order_id)?.present === false);
  const errored = recorded.filter((r) => live.get(r.order_id)?.error);
  console.log(`\nread back one id at a time: ${present.length} present, ${absent.length} absent, ${errored.length} unreadable`);

  // ------------------------------------------------------ did the job survive?
  // For every absent id, every present order the same company has. Filtered on
  // company_id (an allowed filter field) and matched on the day CLIENT-SIDE,
  // because `happening` is a timestamp and an [eq] against a date would compare
  // against midnight.
  const byCompany = new Map();
  async function ordersFor(company_id) {
    if (byCompany.has(company_id)) return byCompany.get(company_id);
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const b = await get(`/orders?company_id[eq]=${company_id}&limit=100&page=${page}&with=Job`);
      const r = rows(b);
      out.push(...r);
      if (!r.length || !b?.pagination?.nextPage) break;
    }
    byCompany.set(company_id, out);
    return out;
  }

  const survived = [];
  const lost = [];
  const unprovable = [];
  for (const r of absent) {
    const d = day(r.first_block);
    if (!Number.isInteger(r.company_id) || d.length !== 10) { unprovable.push(r); continue; }
    const all = await ordersFor(r.company_id);
    const sameDay = all.filter((o) => {
      const j = (Array.isArray(o.Job) ? o.Job[0] : o.Job) ?? {};
      return day(o.happening) === d || day(j.min_beginning) === d;
    });
    if (sameDay.length) survived.push({ ...r, sameDay });
    else lost.push({ ...r, company_orders: all.length });
  }

  console.log(`\n=== THE ANSWER, for the ${absent.length} absent ids ===`);
  console.log(`  ${survived.length} have a PRESENT order for the same company on the same day`);
  console.log(`  ${lost.length} have no present order that day - the booking is gone`);
  console.log(`  ${unprovable.length} cannot be tested (no company_id or no date recorded)`);

  console.log('\n--- survived under another id (first 25) ---');
  for (const r of survived.slice(0, 25)) {
    const ids = r.sameDay.map((o) => `#${o.id}${o.number ? '/' + o.number : ''} creator=${o.creator ?? 'null'} created=${day(o.created)}`).join('  ');
    console.log(`  ours #${r.order_id}${r.order_number ? '/' + r.order_number : ''} co=${r.company_id} ${day(r.first_block)} -> ${ids}`);
  }
  console.log('\n--- genuinely absent, nothing that day (first 25) ---');
  for (const r of lost.slice(0, 25)) {
    console.log(`  ours #${r.order_id}${r.order_number ? '/' + r.order_number : ''} co=${r.company_id} ${day(r.first_block)} (company has ${r.company_orders} orders) ${String(r.subject ?? '').slice(0, 50)}`);
  }

  // ------------------------------------------------------ who creates what survives
  // If every surviving order carries a non-null `creator` and every one of ours
  // carried null, then "API orders do not survive" is a statement about the
  // creator field and not about the booking.
  const creators = new Map();
  for (const r of present) {
    const o = live.get(r.order_id).o;
    const k = o.creator == null ? 'null (API)' : `user ${o.creator}`;
    creators.set(k, (creators.get(k) ?? 0) + 1);
  }
  console.log('\n--- creator on the engine ids that ARE present ---');
  for (const [k, n] of [...creators.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

  process.exit(0);
}

console.log('pick a mode: --recon | --actions | --survive');
