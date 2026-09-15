// ============================================================================
// WHAT `common_change` CARRIES, AND WHETHER CONFIRM IS A COPY
// ----------------------------------------------------------------------------
// audit-vocabulary.mjs found two things the plan assumed away:
//
//   1. `common_change` is the MOST FREQUENT action on the tenant (597 of 2785 sampled).
//      Handoff §7.3 asked by name whether such a row appears. It does, constantly.
//      If it carries diffChanges against SlotTeam/Slot, a crew change is verifiable and
//      the plan's §1.3 — "no write can be confirmed by any read" — is false.
//
//   2. `order_copied`, `order_create_by_copy` and `order_confirm_provisional` exist as
//      distinct actions. If a successor is created by copy, the audit row may name BOTH
//      orders — which would replace Phase C's 57%-recall heuristic with a lookup.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/change-and-copy.mjs
// ============================================================================
import './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};

// Can we filter by action at all? Prove it before trusting any count below.
const probe = await get('/timelineAudits?action[eq]=common_change&limit=2');
const filterWorks = (probe.data ?? []).length > 0 && probe.data.every((r) => r.action === 'common_change');
console.log(`action[eq] filter works: ${filterWorks}` + (probe.http ? ` (HTTP ${probe.http})` : ''));
if (filterWorks) console.log(`  common_change rows on the tenant: ${probe.pagination?.count ?? '?'}`);

const sample = async (action, n = 400) => {
  if (!filterWorks) return [];
  const out = [];
  const first = await get(`/timelineAudits?action[eq]=${action}&limit=200`);
  const last = Math.max(1, Math.ceil((first.pagination?.count ?? 0) / 200));
  out.push(...(first.data ?? []));
  if (last > 1) out.push(...((await get(`/timelineAudits?action[eq]=${action}&limit=200&page=${last}`)).data ?? []));
  return out.slice(0, n);
};

// ── 1. what does common_change actually change? ─────────────────────────────
const ch = await sample('common_change');
console.log(`\n=== common_change: ${ch.length} rows sampled (of ${probe.pagination?.count ?? '?'}) ===`);
const byModel = new Map(), byField = new Map();
let withDiff = 0;
for (const r of ch) {
  let d; try { d = JSON.parse(r.data); } catch { continue; }
  byModel.set(d.model ?? '(none)', (byModel.get(d.model ?? '(none)') ?? 0) + 1);
  const dc = d.diffChanges;
  if (dc && typeof dc === 'object') {
    withDiff++;
    for (const [m, fields] of Object.entries(dc)) {
      for (const f of Object.keys(fields ?? {})) {
        const k = `${m}.${f}`;
        byField.set(k, (byField.get(k) ?? 0) + 1);
      }
    }
  }
}
console.log(`rows carrying diffChanges (old -> new): ${withDiff} of ${ch.length}`);
console.log(`\nmodels changed:`);
for (const [m, n] of [...byModel].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(n).padStart(4)}  ${m}`);
console.log(`\nfields changed (model.field), top 25:`);
for (const [f, n] of [...byField].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`   ${String(n).padStart(4)}  ${f}`);

// The question that decides Phase D: is a CREW SIZE change ever logged?
const crewish = [...byField.keys()].filter((f) => /size|worker|crew|capacity|count/i.test(f));
console.log(`\ncrew-shaped fields in the change log: ${crewish.length ? crewish.join(', ') : 'NONE'}`);
for (const r of ch) {
  let d; try { d = JSON.parse(r.data); } catch { continue; }
  const s = JSON.stringify(d.diffChanges ?? {});
  if (/"size"|workers/i.test(s)) { console.log(`  example: ${d.model}:${d.id} ${s.slice(0, 300)} @${r.created}`); break; }
}

// And are TIMES logged?
const timeish = [...byField.keys()].filter((f) => /begin|end|start|finish|time|date/i.test(f));
console.log(`time-shaped fields in the change log: ${timeish.length ? timeish.join(', ') : 'NONE'}`);

// ── 2. is Confirm a copy, and does the row name both orders? ────────────────
for (const action of ['order_copied', 'order_create_by_copy', 'order_confirm_provisional', 'order_convert_to_quote']) {
  const rs = await sample(action, 40);
  console.log(`\n=== ${action}: ${rs.length} rows (count ${'?'}) ===`);
  for (const r of rs.slice(0, 6)) {
    console.log(`  creator=${r.creator} ${r.created}  ${String(r.data).slice(0, 400)}`);
  }
}
