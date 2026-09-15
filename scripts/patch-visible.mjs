// ============================================================================
// §7.3 — DOES A PATCH LEAVE A TRACE ANYONE CAN READ?
// ----------------------------------------------------------------------------
// The handoff proposes answering this by writing to a test company. It does not need a
// write: the engine has already issued PATCHes against real orders, dozens of which
// succeeded, and every one of them either left an audit row or did not. Asking the
// orders we already patched is the same question with a larger n and no new order on
// the tenant.
//
// It matters because §4 established that crew cannot be read back at all. If a PATCH
// leaves no audit row either, then a write to a successor is unverifiable by ANY route,
// and a plan that writes blind is a plan that cannot tell success from silence.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/patch-visible.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status };
};

// ── every PATCH the engine believes it landed ───────────────────────────────
// NO SQL PREFILTER. `state::text` renders jsonb with a space after every colon, so
// `like '%"kind":"patch"%'` matches nothing and reports a confident zero — which is
// exactly the instrument error §8 is a list of. 496 states is a cheap full scan.
const rows = await sql`select thread_id, state from conversation_state`;
const patched = [];
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if (a.kind === 'patch' && a.ok && a.order_id) patched.push({ order_id: Number(a.order_id), at: a.at ?? a.ts ?? null });
  }
}
const uniq = [...new Map(patched.map((p) => [p.order_id, p])).values()];
console.log(`orders the engine recorded a SUCCESSFUL patch against: ${uniq.length}`);

// ── of those, which still exist, and what does their audit log show ─────────
const ACTIONS = new Map();
let alive = 0, withChange = 0, auditless = 0;
const examples = [];
for (const p of uniq) {
  const o = (await get(`/orders?id[eq]=${p.order_id}&limit=1`)).data?.[0];
  if (!o) continue;
  alive++;
  const a = await get(`/timelineAudits?data[like]=${encodeURIComponent('%Order:' + p.order_id + '%')}&limit=200`);
  const rs = a.data ?? [];
  if (!rs.length) { auditless++; continue; }
  for (const r of rs) ACTIONS.set(r.action, (ACTIONS.get(r.action) ?? 0) + 1);
  // A creation row is not evidence of a patch. What would prove a patch is readable is a
  // row whose action is a CHANGE, dated after the order was made.
  const created = rs.map((r) => r.created).sort()[0];
  const changes = rs.filter((r) => /change|update|edit/i.test(r.action) && r.created > created);
  if (changes.length) {
    withChange++;
    if (examples.length < 6) examples.push({ order: p.order_id, actions: changes.map((c) => `${c.action}@${String(c.created).slice(5, 16)}`) });
  }
}

console.log(`still present on the tenant: ${alive}`);
console.log(`  of those, carrying a CHANGE-shaped audit row after creation: ${withChange}`);
console.log(`  of those, carrying no audit rows at all:                    ${auditless}`);
console.log(`\nevery audit action seen on a patched order:`);
for (const [a, n] of [...ACTIONS].sort((x, y) => y[1] - x[1])) console.log(`   ${String(n).padStart(4)}  ${a}`);
if (examples.length) {
  console.log('\nexamples:');
  for (const e of examples) console.log(`   #${e.order}  ${e.actions.join('  ')}`);
}
