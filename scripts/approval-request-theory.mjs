// ============================================================================
// WHY DOES A DESTROYED ORDER LEAVE NO DELETE ROW?
// ----------------------------------------------------------------------------
// `common_delete` is in the tenant's audit vocabulary (102 in a 2785-row sample), so a
// person deleting a thing normally logs it. Not one of the engine's 77 destroyed orders
// has a delete row. 54 have no rows at all; 23 keep only their own creation row.
//
// Something that is CONSUMED rather than deleted looks exactly like this. And every
// engine order carries a field nobody has looked at:
//
//     request_approval: "1"
//
// Hypothesis: the engine posts an order as a REQUEST AWAITING APPROVAL. Approving it
// does not edit it in place — it produces the real order under a new id and consumes the
// request, which is why there is no delete row, why the successor is typed in house
// vocabulary, why it appears minutes later, and why it is usually the very next id.
//
// If true, Phase B of the plan (nicer block names so ops keep our order) is aimed at the
// wrong thing entirely: the re-key is structural, not cosmetic.
//
// Falsifiable: if request_approval=1 is common across the tenant's own orders, or if the
// 8 surviving engine orders carry it too, the theory is dead.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/approval-request-theory.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};

// ── 1. how common is request_approval on this tenant at all? ────────────────
const total = (await get('/orders?limit=1')).pagination?.count ?? 0;
console.log(`orders on the tenant: ${total}`);
for (const v of [0, 1]) {
  const c = (await get(`/orders?request_approval[eq]=${v}&limit=1`)).pagination?.count ?? 0;
  console.log(`  request_approval=${v}: ${c}`);
}
const ra1 = (await get('/orders?request_approval[eq]=1&limit=100')).data ?? [];
console.log(`\nsample of request_approval=1 orders (${ra1.length}):`);
const byUser = new Map();
for (const o of ra1) byUser.set(o.user_id, (byUser.get(o.user_id) ?? 0) + 1);
for (const [u, n] of [...byUser].sort((a, b) => b[1] - a[1])) console.log(`   user_id ${u}: ${n}${u === 2257 ? '   <- the engine' : ''}`);

// ── 2. the engine's 8 survivors — do they still carry the flag? ─────────────
const rows = await sql`select thread_id, state from conversation_state`;
const ours = new Set();
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if ((a.kind === 'create' || a.kind === 'replace') && a.ok && a.order_id) ours.add(Number(a.order_id));
  }
}
console.log(`\nthe engine's surviving orders:`);
const survivors = [];
for (const id of ours) {
  const o = (await get(`/orders?id[eq]=${id}&limit=1`)).data?.[0];
  if (o) { survivors.push(o); console.log(`   #${o.id} n=${o.number} status=${o.status} req_approval=${o.request_approval} provisional=${o.provisional} quote=${o.quote} created=${String(o.created).slice(0, 16)} ${String(o.name).slice(0, 40)}`); }
}

// ── 3. what does a NON-engine order look like, same fields ──────────────────
const theirs = ((await get('/orders?limit=200')).data ?? []).filter((o) => o.user_id !== 2257).slice(0, 8);
console.log(`\nfor contrast, orders raised by people:`);
for (const o of theirs) console.log(`   #${o.id} n=${o.number} status=${o.status} req_approval=${o.request_approval} provisional=${o.provisional} quote=${o.quote} user=${o.user_id} ${String(o.name).slice(0, 40)}`);

// ── 4. is a vanished id mentioned ANYWHERE in the audit log ────────────────
// The earlier scan only asked for `%Order:<id>%`, which is the `path` field. A row that
// records the request being consumed might name the id some other way.
console.log(`\nbroad audit search for vanished ids (any mention, not just path):`);
const gone = [...ours].filter((id) => !survivors.some((s) => s.id === id)).slice(0, 6);
for (const id of gone) {
  const a = await get(`/timelineAudits?data[like]=${encodeURIComponent('%' + id + '%')}&limit=50`);
  const rs = a.data ?? [];
  const acts = new Map();
  for (const r of rs) acts.set(r.action, (acts.get(r.action) ?? 0) + 1);
  console.log(`   #${id}: ${rs.length} rows  ${[...acts].map(([k, v]) => `${k}×${v}`).join(' ') || '(none)'}`);
}

// ── 5. request_approval=1 orders that are NOT the engine's: do they survive? ─
// If people's own approval-requests also get re-keyed, the mechanism is the tenant's,
// not ours. If only ours vanish, the flag is not sufficient and something else differs.
const notOurs = ra1.filter((o) => o.user_id !== 2257);
console.log(`\nrequest_approval=1 orders NOT created by the engine: ${notOurs.length}`);
for (const o of notOurs.slice(0, 8)) console.log(`   #${o.id} user=${o.user_id} status=${o.status} created=${String(o.created).slice(0, 16)} ${String(o.name).slice(0, 40)}`);
