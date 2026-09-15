// ============================================================================
// HOW MANY OF THE 85 ARE REAL CLIENT JOBS?
// ----------------------------------------------------------------------------
// "89% of what the engine makes is destroyed" treats all 85 engine orders as equivalent
// evidence. Two of the first `desired_order` records inspected are plainly synthetic —
// "FutureTech Expo 2027", "Quantum Leap Tech Summit", happening dates in 2027 — and the
// handoff already dates a corpus replay window at 2026-08-27/28 (§6, the dead
// createCompany 400s, "all inside the corpus replay window").
//
// If a large share of the 85 are replayed test enquiries, then ops deleting them is
// correct behaviour and not evidence of anything about real work. The survival rate has
// to be computed on real client threads alone or it measures our own test traffic.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/real-or-corpus.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};
const parse = (r) => { try { return JSON.parse(r.data); } catch { return null; } };

const rows = await sql`select thread_id, state from conversation_state`;
const recs = [];
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if ((a.kind === 'create' || a.kind === 'replace') && a.ok && a.order_id) {
      const d = s.desired_order ?? {};
      recs.push({
        order_id: Number(a.order_id), thread: r.thread_id, ts: a.ts ?? null,
        company_id: s.company_id ?? null,
        want: String(d.slot_teams?.[0]?.beginning ?? '').slice(0, 10) || null,
        subject: s.subject ?? '', sender: s.sender_email ?? '', domain: s.sender_domain ?? '',
        review_only: Boolean(s.review_only), participants: (s.participants ?? []).join(' '),
      });
    }
  }
}
console.log(`engine order records: ${recs.length}`);
console.log(`with a requested day now readable: ${recs.filter((r) => r.want).length}\n`);

// ── when were they posted, and how far out do they claim to happen ──────────
const byPostDay = new Map();
for (const r of recs) {
  const d = r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '(no ts)';
  byPostDay.set(d, (byPostDay.get(d) ?? 0) + 1);
}
console.log(`engine orders by the day we posted them:`);
for (const [d, n] of [...byPostDay].sort()) console.log(`   ${d}  ${'#'.repeat(Math.min(n, 40))} ${n}`);

const far = recs.filter((r) => r.want && r.want >= '2027-01-01');
console.log(`\nhappening in 2027 or later (a corpus tell — nobody books 14 months out): ${far.length}`);

// ── who sent the enquiry ────────────────────────────────────────────────────
const byDomain = new Map();
for (const r of recs) {
  const dom = r.domain || (r.sender.includes('@') ? r.sender.split('@')[1] : '(none)');
  byDomain.set(dom, (byDomain.get(dom) ?? 0) + 1);
}
console.log(`\nsender domain of the enquiry behind each engine order:`);
for (const [d, n] of [...byDomain].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}  ${d}`);

// ── survival, split real vs suspected corpus ────────────────────────────────
const CORPUS_TELLS = /futuretech|quantum leap|tech solutions expo|global tech summit|innovate events|event solutions uk|eventful uk|connect events|corporate event crew/i;
const suspect = (r) => Boolean((r.want && r.want >= '2027-01-01') || CORPUS_TELLS.test(r.subject) || /example|test|corpus/i.test(r.sender + r.domain));

const alive = new Set();
for (const r of recs) {
  if (((await get(`/orders?id[eq]=${r.order_id}&limit=1`)).data ?? []).length) alive.add(r.order_id);
}

const del = await (async () => {
  const first = await get('/timelineAudits?action[eq]=common_delete&limit=200');
  const out = [...(first.data ?? [])];
  for (let p = 2; p <= Math.ceil((first.pagination?.count ?? 0) / 200); p++) out.push(...((await get(`/timelineAudits?action[eq]=common_delete&limit=200&page=${p}`)).data ?? []));
  const m = new Map();
  for (const r of out) { const d = parse(r); if (d?.model === 'Order') m.set(Number(d.id), { creator: r.creator, created: r.created }); }
  return m;
})();

const groups = { 'suspected corpus/test': recs.filter(suspect), 'the rest': recs.filter((r) => !suspect(r)) };
console.log(`\n${'group'.padEnd(24)} n    alive   deleted-by-a-person   deleted by`);
for (const [label, g] of Object.entries(groups)) {
  const a = g.filter((r) => alive.has(r.order_id)).length;
  const d = g.filter((r) => del.has(r.order_id));
  const who = new Map();
  for (const r of d) who.set(del.get(r.order_id).creator, (who.get(del.get(r.order_id).creator) ?? 0) + 1);
  console.log(`${label.padEnd(24)} ${String(g.length).padStart(3)}  ${String(a).padStart(5)}   ${String(d.length).padStart(19)}   ${[...who].map(([k, v]) => `${k}×${v}`).join(' ')}`);
}

console.log(`\nthe non-corpus orders, one line each:`);
for (const r of groups['the rest']) {
  const d = del.get(r.order_id);
  console.log(`   #${r.order_id} ${alive.has(r.order_id) ? 'ALIVE  ' : 'gone   '} posted ${r.ts ? new Date(r.ts).toISOString().slice(0, 16) : '?'} wants ${r.want ?? '?'}` +
    ` ${d ? `deleted by ${d.creator} @${String(d.created).slice(5, 16)}` : 'no delete row'}  ${String(r.subject).slice(0, 46)}`);
}
