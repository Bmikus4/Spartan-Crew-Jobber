// ============================================================================
// WAS OPS ALREADY WORKING THE JOB BEFORE THE ENGINE POSTED IT?
// ----------------------------------------------------------------------------
// Three results now point away from the "our order is retyped" story:
//   - 0 of 85 engine orders carry a copy link, though the tenant has 776.
//   - 0 of 85 were ever confirmed, though `order_confirm_provisional` fires 3921 times.
//   - the person who DELETES ours creates no order within the hour in 41 of 52 cases
//     (19% single-candidate against a 15% ambiguity floor — no signal).
//
// If ops neither copies, confirms, nor replaces our order, the remaining explanation is
// that they never needed it: they were already handling the enquiry by their own route,
// and ours is a duplicate that sits there until somebody bins it.
//
// Handoff §8.3 recorded "matching backwards" as a method error and forced `id > ours`.
// That is only an error if the successor must come after us. If ops' order routinely
// comes BEFORE ours, that constraint deleted the finding.
//
// So ask the question without the direction constraint: for each engine order, what else
// exists on the tenant for the same company and the same happening day, and WHEN was it
// made relative to ours?
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/were-we-second.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};
const parse = (r) => { try { return JSON.parse(r.data); } catch { return null; } };
const day = (s) => String(s ?? '').slice(0, 10);

// ── ours: id, company, happening day, and when we posted it ─────────────────
// The order itself is gone for most, so the happening day has to come from the audit
// creation row (which survives for some) or from our own record of what we sent.
const rows = await sql`select thread_id, state from conversation_state`;
const ours = new Map();
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if ((a.kind === 'create' || a.kind === 'replace') && a.ok && a.order_id) {
      const d = s.desired_order ?? {};
      // the requested day lives in desired_order.slot_teams[0].beginning; the earlier
      // guess at d.date/d.day/d.shifts matched nothing and reported a confident 81/81 null
      const when = d.slot_teams?.[0]?.beginning ?? null;
      ours.set(Number(a.order_id), { thread: r.thread_id, ts: a.ts ?? null, company_id: s.company_id ?? null, want: day(when) });
    }
  }
}
const withCo = [...ours].filter(([, v]) => v.company_id && v.ts);
console.log(`engine orders with a company and a post time: ${withCo.length} of ${ours.size}`);

// ── the delete ledger, for lag ──────────────────────────────────────────────
const first = await get('/timelineAudits?action[eq]=common_delete&limit=200');
const dels = [...(first.data ?? [])];
for (let p = 2; p <= Math.ceil((first.pagination?.count ?? 0) / 200); p++) dels.push(...((await get(`/timelineAudits?action[eq]=common_delete&limit=200&page=${p}`)).data ?? []));
const orderDel = new Map();
for (const r of dels) { const d = parse(r); if (d?.model === 'Order') orderDel.set(Number(d.id), { creator: r.creator, created: r.created }); }

// ── for each, the company's other orders, in both directions ────────────────
const peers = new Map();
let before = 0, after = 0, both = 0, neither = 0, noDay = 0;
const lagsToDelete = [];
const shown = [];
for (const [id, v] of withCo) {
  if (!peers.has(v.company_id)) {
    peers.set(v.company_id, (await get(`/orders?company_id[eq]=${v.company_id}&limit=100`)).data ?? []);
  }
  const list = peers.get(v.company_id).filter((o) => o.id !== id && Number(o.user_id) !== 2257);
  const ourTs = new Date(v.ts).getTime();

  // same happening day as what we asked for; fall back to "any order by that company
  // within +-3 days of our post" when we cannot read our own requested day
  let sameDay = v.want ? list.filter((o) => day(o.happening) === v.want) : [];
  const usedDay = Boolean(v.want && sameDay.length);
  if (!v.want) noDay++;

  const earlier = sameDay.filter((o) => new Date(o.created).getTime() < ourTs);
  const later = sameDay.filter((o) => new Date(o.created).getTime() >= ourTs);
  if (earlier.length && later.length) both++;
  else if (earlier.length) before++;
  else if (later.length) after++;
  else neither++;

  const d = orderDel.get(id);
  if (d && v.ts) lagsToDelete.push(Math.round((new Date(d.created).getTime() - ourTs) / 60000));

  if (shown.length < 14 && usedDay) {
    const fmt = (o) => `#${o.id}@${String(o.created).slice(5, 16)}`;
    shown.push(`   #${id} co=${v.company_id} wants ${v.want} | BEFORE us: ${earlier.map(fmt).join(' ') || '-'} | AFTER: ${later.map(fmt).join(' ') || '-'}`);
  }
}

console.log(`\nfor the same company and the same requested day, a human order exists:`);
console.log(`   ONLY BEFORE the engine posted:  ${before}`);
console.log(`   ONLY AFTER:                     ${after}`);
console.log(`   both sides:                     ${both}`);
console.log(`   none at all:                    ${neither}`);
console.log(`   (${noDay} engine orders do not record the day we asked for)`);

console.log(`\nexamples:`);
for (const s of shown) console.log(s);

if (lagsToDelete.length) {
  lagsToDelete.sort((a, b) => a - b);
  const q = (p) => lagsToDelete[Math.floor((lagsToDelete.length - 1) * p)];
  console.log(`\nminutes from the engine posting to a person deleting it (n=${lagsToDelete.length}):`);
  console.log(`   min ${q(0)}   p25 ${q(0.25)}   median ${q(0.5)}   p75 ${q(0.75)}   max ${q(1)}`);
  console.log(`   deleted within an hour: ${lagsToDelete.filter((x) => x <= 60).length}` +
    `   within a day: ${lagsToDelete.filter((x) => x <= 1440).length}   after a week: ${lagsToDelete.filter((x) => x > 10080).length}`);
}
