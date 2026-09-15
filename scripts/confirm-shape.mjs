// ============================================================================
// §7.1 — IS "CONFIRM" ONE BUTTON?
// ----------------------------------------------------------------------------
// Ben's account is that a team member opens the order the engine created and presses
// Confirm. The handoff's counter-evidence was a single order, #15769, assembled over
// seven minutes by two different people — which is not what a one-click copy looks
// like. One order is an anecdote.
//
// This asks the audit log the same question of EVERY successor the scan matched, plus
// a control: the same question asked of orders that were never ours. If Confirm is a
// button, a successor's audit rows land in one instant under one creator, and orders
// nobody confirmed look different. If it is a person retyping the booking, they do not.
//
// It decides whether the successor is predictable enough to bind automatically at all,
// which is the gate on the whole plan.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/confirm-shape.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status };
};
const day = (s) => String(s ?? '').slice(0, 10);
const mins = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);

/** How an order came into existence, read off its own audit trail. */
async function birth(order_id) {
  const a = await get(`/timelineAudits?data[like]=${encodeURIComponent('%Order:' + order_id + '%')}&limit=200`);
  const rows = (a.data ?? []).slice().sort((x, y) => new Date(x.created) - new Date(y.created));
  if (!rows.length) return null;
  const creators = [...new Set(rows.map((r) => r.creator))];
  const first = rows[0].created, last = rows[rows.length - 1].created;
  // The creation row carries what that ONE operation made. An order posted whole names
  // every block in it; one assembled in the UI names the first and grows the rest later.
  let made = null;
  for (const r of rows) {
    if (r.action !== 'order_create') continue;
    try { made = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)?.created ?? null; } catch { /* keep null */ }
    break;
  }
  return {
    rows: rows.length, creators, first, last, spanMin: mins(first, last),
    actions: [...new Set(rows.map((r) => r.action))],
    made,
    // Everything within a minute of the first row is what the first operation did.
    inFirstMinute: rows.filter((r) => mins(first, r.created) <= 1).length,
  };
}

// ── the population, matched the same way the scan matches it ────────────────
const recs = await sql`select order_id, company_id, shape_sent, created_at from order_records`;
const exact = new Map(recs.map((r) => [Number(r.order_id), r]));
const tix = await sql`
  select t.thread_id, t.onsinch_order_id::int order_id, t.dates, t.company_id, t.subject, t.created_at, cs.state
  from tickets t left join conversation_state cs on cs.thread_id = t.thread_id
  where t.onsinch_order_id is not null`;

const byId = new Map();
for (const t of tix) {
  const s = typeof t.state === 'string' ? JSON.parse(t.state) : (t.state ?? {});
  const weCreated = (s.order_action_log ?? []).some(
    (a) => a.ok && (a.kind === 'create' || a.kind === 'replace') && Number(a.order_id) === Number(t.order_id));
  if (!weCreated) continue;
  if (/new booking request in london/.test(String(t.subject ?? ''))) continue;
  const ex = exact.get(Number(t.order_id));
  const teams = s.last_ordered_teams ?? s.desired_order?.slot_teams ?? [];
  const d = day(ex?.shape_sent?.slot_teams?.[0]?.beginning ?? teams[0]?.beginning ?? (Array.isArray(t.dates) ? t.dates[0] : null));
  const company = ex?.company_id ?? s.desired_order?.company_id ?? t.company_id ?? null;
  const id = Number(t.order_id);
  if (!byId.has(id)) byId.set(id, { order_id: id, company_id: company ? Number(company) : null, day: d, when: ex?.created_at ?? t.created_at });
}

const pairs = [];
for (const p of byId.values()) {
  if (!p.company_id || !p.day) continue;
  if ((await get(`/orders?id[eq]=${p.order_id}&limit=1`)).data?.length) continue; // still ours, not replaced
  const q = await get(`/orders?company_id[eq]=${p.company_id}&limit=100`);
  const cands = (q.data ?? []).filter((o) => day(o.happening) === p.day && Number(o.id) > p.order_id);
  if (cands.length === 1) pairs.push({ p, c: cands[0] });
}
console.log(`matched successors: ${pairs.length}\n`);

// ── 1. how each successor was born ──────────────────────────────────────────
const tally = { onePerson: 0, several: 0, instant: 0, assembled: 0, noAudit: 0 };
const spans = [], lags = [];
console.log('ours    ->  theirs   rows  creators        span  first-min  order_create made');
for (const { p, c } of pairs) {
  const b = await birth(c.id);
  if (!b) { tally.noAudit++; console.log(`#${p.order_id} -> #${c.id}   (no audit rows)`); continue; }
  b.creators.length === 1 ? tally.onePerson++ : tally.several++;
  b.spanMin <= 1 ? tally.instant++ : tally.assembled++;
  spans.push(b.spanMin);
  if (p.when) lags.push(mins(p.when, b.first));
  console.log(
    `#${p.order_id} -> #${String(c.id).padEnd(6)} ${String(b.rows).padStart(4)}  ${JSON.stringify(b.creators).padEnd(14)} ${String(b.spanMin + 'm').padStart(6)} ${String(b.inFirstMinute).padStart(9)}  ${JSON.stringify(b.made ?? {})}`,
  );
}

const pct = (n) => `${n} (${Math.round(100 * n / Math.max(1, pairs.length - tally.noAudit))}%)`;
console.log(`\nraised by ONE person: ${pct(tally.onePerson)}   by SEVERAL: ${pct(tally.several)}`);
console.log(`all rows within a minute: ${pct(tally.instant)}   assembled over time: ${pct(tally.assembled)}`);
const sorted = spans.slice().sort((a, b) => a - b);
console.log(`span minutes: min ${sorted[0]} median ${sorted[Math.floor(sorted.length / 2)]} max ${sorted[sorted.length - 1]}`);
const ls = lags.slice().sort((a, b) => a - b);
if (ls.length) console.log(`lag from OUR order to theirs, minutes: min ${ls[0]} median ${ls[Math.floor(ls.length / 2)]} max ${ls[ls.length - 1]}  (n=${ls.length})`);

// ── 2. the control: orders that were never ours ─────────────────────────────
//
// A span of zero proves nothing on its own if EVERY order on this tenant is posted whole.
// The claim is only about how a CONFIRM-shaped order differs from an ordinary one.
console.log('\n== control: 40 orders the engine never touched ==');
const sample = ((await get('/orders?limit=40&page=3')).data ?? []);
const ctl = { onePerson: 0, several: 0, instant: 0, assembled: 0, n: 0 };
for (const o of sample) {
  const b = await birth(o.id);
  if (!b) continue;
  ctl.n++;
  b.creators.length === 1 ? ctl.onePerson++ : ctl.several++;
  b.spanMin <= 1 ? ctl.instant++ : ctl.assembled++;
}
const cpct = (n) => `${n} (${Math.round(100 * n / Math.max(1, ctl.n))}%)`;
console.log(`n=${ctl.n}  ONE person: ${cpct(ctl.onePerson)}  SEVERAL: ${cpct(ctl.several)}`);
console.log(`         within a minute: ${cpct(ctl.instant)}  assembled: ${cpct(ctl.assembled)}`);
