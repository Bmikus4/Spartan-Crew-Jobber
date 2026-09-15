// ============================================================================
// THE DELETE ROW THE PATH FILTER COULD NEVER SEE
// ----------------------------------------------------------------------------
// Handoff §2: "its audit rows are gone too — #15806 returns 0 audit rows". Every scan
// behind that claim filtered `data[like]=%Order:<id>%`, which matches the `path` field
// that `order_create` and `common_create` happen to carry:
//
//     order_create  ... "data":{"quote":0,"number":10813,"path":"Order:15769"}
//
// A `common_delete` row is not shaped like that. Its data is `{"id":"15575",
// "model":"Order", ...}` with no path — so the literal substring "Order:15575" never
// appears in it and the filter reports a confident zero. A loose `%15575%` search just
// found common_delete rows against four of six vanished orders.
//
// This is the same instrument error as §8 twice over: the pattern only ever matched the
// creation rows, and the absence of everything else was read as evidence.
//
// So do it precisely: pull EVERY common_delete row on the tenant, parse it, keep the
// ones whose model is Order, and intersect with the engine's ids. No pattern matching.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/who-deleted-it.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};

const pullAll = async (action, cap = 20000) => {
  const first = await get(`/timelineAudits?action[eq]=${action}&limit=200`);
  const count = first.pagination?.count ?? 0;
  const out = [...(first.data ?? [])];
  const pages = Math.min(Math.ceil(count / 200), Math.ceil(cap / 200));
  for (let p = 2; p <= pages; p++) out.push(...((await get(`/timelineAudits?action[eq]=${action}&limit=200&page=${p}`)).data ?? []));
  console.log(`${action}: pulled ${out.length} of ${count}`);
  return out;
};

// ── the engine's orders ─────────────────────────────────────────────────────
const rows = await sql`select thread_id, state from conversation_state`;
const ours = new Map();
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if ((a.kind === 'create' || a.kind === 'replace') && a.ok && a.order_id) {
      ours.set(Number(a.order_id), { thread: r.thread_id, at: a.at ?? a.ts ?? null });
    }
  }
}
console.log(`engine orders: ${ours.size}\n`);

const dels = await pullAll('common_delete');
const parse = (r) => { try { return JSON.parse(r.data); } catch { return null; } };

// ── what does common_delete ever delete? ────────────────────────────────────
const models = new Map();
const orderDeletes = new Map();
for (const r of dels) {
  const d = parse(r); if (!d) continue;
  models.set(d.model ?? '(none)', (models.get(d.model ?? '(none)') ?? 0) + 1);
  if (d.model === 'Order') orderDeletes.set(Number(d.id), { creator: r.creator, created: r.created, name: d.name, auditId: r.id });
}
console.log(`\nmodels that common_delete is filed against:`);
for (const [m, n] of [...models].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${m}`);
console.log(`\ndistinct ORDERS with a delete row: ${orderDeletes.size}`);

// ── how many of ours? ──────────────────────────────────────────────────────
let hit = 0;
const byCreator = new Map();
const examples = [];
for (const [id, meta] of ours) {
  const d = orderDeletes.get(id);
  if (!d) continue;
  hit++;
  byCreator.set(d.creator, (byCreator.get(d.creator) ?? 0) + 1);
  if (examples.length < 15) examples.push({ id, ...d, ourAt: meta.at });
}
console.log(`\nENGINE ORDERS WITH A DELETE ROW: ${hit} of ${ours.size}`);
console.log(`\ndeleted by:`);
for (const [c, n] of [...byCreator].sort((a, b) => b[1] - a[1])) console.log(`   user ${c}: ${n}`);
console.log(`\nexamples (ours created -> deleted):`);
for (const e of examples) {
  const lag = e.ourAt ? Math.round((new Date(e.created) - new Date(e.ourAt)) / 60000) : null;
  console.log(`   #${e.id} deleted by user ${String(e.creator).padEnd(5)} at ${String(e.created).slice(0, 16)}` +
    (lag !== null ? `  (${lag}m after we created it)` : '') + `  ${String(e.name).slice(0, 34)}`);
}

// ── and the other 3 actions that could consume an order ────────────────────
for (const action of ['order_cancel', 'order_confirm_provisional', 'order_finish_without_invoice']) {
  const rs = await pullAll(action);
  let n = 0;
  for (const r of rs) {
    const d = parse(r); if (!d) continue;
    if (d.model === 'Order' && ours.has(Number(d.id))) n++;
  }
  console.log(`   -> ${action} against an engine order: ${n}`);
}
