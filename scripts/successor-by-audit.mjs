// ============================================================================
// IS THE SUCCESSOR LINK IN THE AUDIT LOG, RATHER THAN GUESSED?
// ----------------------------------------------------------------------------
// Phase C of the plan resolves a successor by company + happening day + id > ours,
// accepts only single candidates, and buys 57% recall at a 3.0% false-positive rate.
// That was the best available when the audit vocabulary was unknown.
//
// It is now known, and it contains:
//   order_copied           {"id":<source>, "data":{"newId":<successor>}}
//   order_create_by_copy   {"id":<successor>, "data":{"originalId":<source>}}
//
// If Ben's team makes the successor with the copy button, one of those rows names BOTH
// orders and the link is exact. Note WHICH survives: our order's own rows are gone with
// it (handoff §2), but `order_create_by_copy` is filed against the SUCCESSOR, which is
// alive — so the link is readable from the surviving side even when ours is destroyed.
//
// Also asks what actually happened to our orders: order_confirm_provisional, common_delete.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/successor-by-audit.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};

// ── every order the engine believes it created ──────────────────────────────
const rows = await sql`select thread_id, state from conversation_state`;
const ours = new Map(); // order_id -> {thread, at}
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if ((a.kind === 'create' || a.kind === 'replace') && a.ok && a.order_id) {
      ours.set(Number(a.order_id), { thread: r.thread_id, at: a.at ?? a.ts ?? null });
    }
  }
}
console.log(`orders the engine believes it created: ${ours.size}`);

// which are still present — instrument controls per handoff §8.1
const ctlAlive = (await get('/orders?limit=5')).data ?? [];
const ctlDead = (await get('/orders?id[eq]=99999999&limit=1')).data ?? [];
console.log(`control: 5 ids off /orders read back ${ctlAlive.length}/5 present; id 99999999 reads ${ctlDead.length} (want 0)`);
if (ctlAlive.length !== 5 || ctlDead.length !== 0) { console.log('INSTRUMENT SUSPECT — stop.'); process.exit(1); }

const alive = new Set();
for (const id of ours.keys()) {
  const o = (await get(`/orders?id[eq]=${id}&limit=1`)).data?.[0];
  if (o) alive.add(id);
}
console.log(`still present: ${alive.size} of ${ours.size}   vanished: ${ours.size - alive.size}`);

// ── pull EVERY copy-shaped audit row on the tenant ──────────────────────────
const pullAll = async (action) => {
  const first = await get(`/timelineAudits?action[eq]=${action}&limit=200`);
  const count = first.pagination?.count ?? 0;
  const out = [...(first.data ?? [])];
  const pages = Math.ceil(count / 200);
  for (let p = 2; p <= pages; p++) out.push(...((await get(`/timelineAudits?action[eq]=${action}&limit=200&page=${p}`)).data ?? []));
  console.log(`  ${action}: ${out.length} rows pulled (count ${count})`);
  return out;
};
console.log(`\npulling copy-shaped audit rows:`);
const copied = await pullAll('order_copied');
const byCopy = await pullAll('order_create_by_copy');

const parse = (r) => { try { return JSON.parse(r.data); } catch { return null; } };
const link = new Map(); // source order id -> {successor, action, created, creator}
for (const r of copied) {
  const d = parse(r); if (!d) continue;
  const src = Number(d.id), dst = Number(d.data?.newId);
  if (src && dst) link.set(src, { successor: dst, action: 'order_copied', created: r.created, creator: r.creator });
}
for (const r of byCopy) {
  const d = parse(r); if (!d) continue;
  const dst = Number(d.id), src = Number(d.data?.originalId);
  if (src && dst && !link.has(src)) link.set(src, { successor: dst, action: 'order_create_by_copy', created: r.created, creator: r.creator });
}
console.log(`\ndistinct source->successor links in the whole audit log: ${link.size}`);

// ── the question: do those links cover OUR vanished orders? ─────────────────
let hit = 0;
const hits = [];
for (const id of ours.keys()) {
  const l = link.get(id);
  if (l) { hit++; if (hits.length < 12) hits.push({ id, ...l, aliveNow: alive.has(id) }); }
}
console.log(`of the engine's ${ours.size} orders, carrying an exact copy link: ${hit}`);
for (const h of hits) console.log(`   #${h.id} -> #${h.successor}  (${h.action}, user ${h.creator}, ${h.created}, ours alive=${h.aliveNow})`);

// ── so what DID happen to ours? ─────────────────────────────────────────────
console.log(`\nwhat the audit log says happened to the engine's orders:`);
const vanished = [...ours.keys()].filter((id) => !alive.has(id));
const seenActions = new Map();
let auditless = 0;
for (const id of vanished) {
  const a = await get(`/timelineAudits?data[like]=${encodeURIComponent('%Order:' + id + '%')}&limit=100`);
  const rs = a.data ?? [];
  if (!rs.length) { auditless++; continue; }
  for (const r of rs) seenActions.set(r.action, (seenActions.get(r.action) ?? 0) + 1);
}
console.log(`  vanished orders with NO audit rows at all: ${auditless} of ${vanished.length}`);
console.log(`  actions seen on the rest:`);
for (const [a, n] of [...seenActions].sort((x, y) => y[1] - x[1])) console.log(`     ${String(n).padStart(4)}  ${a}`);
