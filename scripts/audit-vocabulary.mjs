// ============================================================================
// THE CONTROL patch-visible.mjs NEVER RAN
// ----------------------------------------------------------------------------
// `patch-visible.mjs` tallied audit actions on 41 orders THE ENGINE PATCHED and found
// only create-shaped rows, and the plan generalised that to "no write to an OnSinch
// order can be verified by any read this API offers".
//
// That generalisation has a hole the size of the finding. Handoff §1 established that
// the engine's PATCH carries top-level fields only and HAS NEVER MOVED CREW OR TIMES.
// So the 41 orders are not evidence that changes are invisible; they are evidence that
// nothing worth logging was changed. Absence of a change row where no change was made
// is not a measurement.
//
// The question the plan needs answered is about the API, not about our patches:
//   does a change-shaped audit row exist ANYWHERE on this tenant?
// People edit orders in the UI all day. If their edits log a row, changes ARE readable
// and Phase D's blocking rationale collapses. If thousands of rows across the whole
// tenant are create-shaped and nothing else, the claim is safe and now actually earned.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/audit-vocabulary.mjs
// ============================================================================
import './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};

// ── positive control FIRST, per handoff §8.1: prove the instrument sees anything ──
const ctl = await get('/timelineAudits?limit=3');
console.log(`instrument control: unfiltered /timelineAudits -> ${(ctl.data ?? []).length} rows` +
  (ctl.http ? ` (HTTP ${ctl.http})` : ''));
if (!(ctl.data ?? []).length) { console.log('INSTRUMENT BLIND — stop, do not report an absence.'); process.exit(1); }
console.log(`row keys: ${Object.keys(ctl.data[0]).join(', ')}`);
console.log(`total rows the endpoint reports: ${JSON.stringify(ctl.pagination ?? null)}`);

// ── page the tenant's audit log and tally the ACTION vocabulary ──────────────
// The endpoint pages with `page` and orders by TimelineAudit.id ASC, so page 1 is the
// OLDEST rows on a tenant that has been live for years. Sampling only there would
// describe 2023 and call it the API. Sample the last pages too — that is where a UI
// edit made this week would land.
const ACTIONS = new Map();
const EXAMPLES = new Map();
const LIMIT = 200;
const total = ctl.pagination?.count ?? 0;
const lastPage = Math.max(1, Math.ceil(total / LIMIT));
const wanted = [
  ...Array.from({ length: 8 }, (_, i) => lastPage - i),          // newest
  ...Array.from({ length: 4 }, (_, i) => Math.round(lastPage * (0.2 + i * 0.2))), // spread
  1, 2,                                                          // oldest
].filter((p) => p >= 1);
let seen = 0, pages = 0;
for (const page of wanted) {
  const a = await get(`/timelineAudits?limit=${LIMIT}&page=${page}`);
  const rs = a.data ?? [];
  if (!rs.length) continue;
  pages++;
  for (const r of rs) {
    seen++;
    const act = r.action ?? '(null)';
    ACTIONS.set(act, (ACTIONS.get(act) ?? 0) + 1);
    if (!EXAMPLES.has(act)) EXAMPLES.set(act, r);
  }
}
console.log(`\nsampled ${seen} audit rows over ${pages} pages of ${lastPage} (newest 8, 4 spread, oldest 2)`);
console.log(`\nEVERY action in the tenant's audit vocabulary:`);
for (const [a, n] of [...ACTIONS].sort((x, y) => y[1] - x[1])) {
  console.log(`   ${String(n).padStart(6)}  ${a}`);
}

// ── the decisive question ────────────────────────────────────────────────────
const changey = [...ACTIONS.keys()].filter((a) => /change|update|edit|modif|delete|remove/i.test(a));
console.log(`\nchange-shaped actions present: ${changey.length ? changey.join(', ') : 'NONE'}`);
for (const a of changey) {
  const e = EXAMPLES.get(a);
  console.log(`\n  ${a}  (n=${ACTIONS.get(a)})`);
  console.log(`    ${JSON.stringify(e).slice(0, 600)}`);
}
