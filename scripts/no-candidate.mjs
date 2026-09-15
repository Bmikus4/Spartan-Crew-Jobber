// ============================================================================
// §7.2 — WHY 24 OF 67 VANISHED ORDERS OFFER NO CANDIDATE
// ----------------------------------------------------------------------------
// The standing hypothesis, spot-checked on two orders and therefore not a finding:
// the engine had provisioned a DUPLICATE company, and the team raised the successor
// under the real one — so a search scoped to our company_id can never see it.
//
// This drops the company scope and asks the day instead: every order happening on the
// day we asked for, with an id above ours, whoever it belongs to. Then it prints our
// company's name beside the candidate's, because "same client, different company row"
// is a judgement about two strings and the script should not pretend to make it.
//
// If the hypothesis holds, recall is not 57% — it is 57% plus whatever this recovers,
// and the fix is company resolution rather than successor matching.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/no-candidate.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status };
};
const day = (s) => String(s ?? '').slice(0, 10);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const companyName = new Map();
async function company(id) {
  if (!id) return null;
  if (companyName.has(id)) return companyName.get(id);
  const c = (await get(`/companies?id[eq]=${id}&limit=1`)).data?.[0] ?? null;
  const name = c?.name ?? c?.title ?? null;
  companyName.set(id, name);
  return name;
}

// ── the population, matched the way the scan matches it ─────────────────────
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
  const co = ex?.company_id ?? s.desired_order?.company_id ?? t.company_id ?? null;
  const id = Number(t.order_id);
  if (!byId.has(id)) byId.set(id, { order_id: id, company_id: co ? Number(co) : null, day: d, subject: String(t.subject ?? '').slice(0, 40) });
}

const orphans = [];
for (const p of byId.values()) {
  if (!p.company_id || !p.day) continue;
  if ((await get(`/orders?id[eq]=${p.order_id}&limit=1`)).data?.length) continue;
  const q = await get(`/orders?company_id[eq]=${p.company_id}&limit=100`);
  const cands = (q.data ?? []).filter((o) => day(o.happening) === p.day && Number(o.id) > p.order_id);
  if (cands.length === 0) orphans.push(p);
}
console.log(`vanished with no same-company candidate: ${orphans.length}\n`);

// ── drop the company scope, keep the day ────────────────────────────────────
let recovered = 0, none = 0, many = 0;
for (const p of orphans) {
  const q = await get(`/orders?happening[gte]=${p.day}T00:00:00&happening[lt]=${p.day}T23:59:59&limit=100`);
  const cands = (q.data ?? []).filter((o) => Number(o.id) > p.order_id && Number(o.company_id) !== p.company_id);
  const ours = await company(p.company_id);
  if (!cands.length) { none++; console.log(`#${p.order_id}  ${p.day}  co ${p.company_id} "${ours}"  -> nothing that day at all`); continue; }
  const named = [];
  for (const c of cands.slice(0, 6)) named.push({ id: c.id, co: c.company_id, name: await company(c.company_id) });
  // The judgement is left visible rather than made: two company rows for one client is a
  // string comparison a person should see, and an automatic verdict here would be the
  // kind of flattering measurement §8 is a list of.
  const looksSame = named.filter((n) => norm(n.name) && norm(ours) && (norm(n.name).includes(norm(ours).split(' ')[0]) || norm(ours).includes(norm(n.name).split(' ')[0])));
  if (looksSame.length) recovered++; else many++;
  console.log(`#${p.order_id}  ${p.day}  co ${p.company_id} "${ours}"`);
  for (const n of named) console.log(`      -> #${n.id} co ${n.co} "${n.name}"${looksSame.some((x) => x.id === n.id) ? '   <-- same client?' : ''}`);
}
console.log(`\nof ${orphans.length}: ${recovered} have a same-day order under a company whose NAME overlaps ours`);
console.log(`                    ${many} have same-day orders but none whose name overlaps`);
console.log(`                    ${none} have no later order that day at all`);
