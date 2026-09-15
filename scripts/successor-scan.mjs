// ============================================================================
// Where does an engine order go when the team presses Confirm?
// ----------------------------------------------------------------------------
// Confirm does not move our order into a state — it destroys it and a new order
// appears in its place, raised by a person, carrying the tenant's own block names.
// This measures how reliably that successor can be identified after the fact, which
// is the whole basis of amending a booking the engine no longer holds an id for.
//
// Three questions, three sections:
//   1. RECALL      of the orders we lost, how many resolve to exactly one candidate
//   2. SPECIFICITY how often that candidate is a coincidence rather than the successor
//   3. FIDELITY    does the successor carry the crew we asked for
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/successor-scan.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status };
};
const day = (s) => String(s ?? '').slice(0, 10);
const unesc = (s) => String(s ?? '').split('\\').join('');
const TEAM = /^Order:(\d+)\/Job:(\d+)\/SlotTeam:(\d+)$/;

/** The shape a live order will admit to: block ids, names and crew, out of the audit log. */
async function auditShape(order_id) {
  const a = await get(`/timelineAudits?data[like]=${encodeURIComponent('%Order:' + order_id + '%')}&limit=200`);
  const rows = a.data ?? [];
  const teams = []; let total = null;
  for (const r of rows) {
    let p; try { p = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch { continue; }
    const path = unesc(p?.data?.path);
    if (path === `Order:${order_id}` && r.action === 'order_create') total = Number(p?.created?.workers ?? NaN);
    const m = TEAM.exec(path);
    if (m && Number(m[1]) === Number(order_id)) teams.push({ id: Number(m[3]), name: p?.name, workers: Number(p?.created?.workers ?? 0) });
  }
  return { rows: rows.length, teams, total };
}

/**
 * CREW TOTAL IS NOT A FINGERPRINT, and this is where that was established.
 *
 * A SlotTeam created empty and filled slot-by-slot in the UI reports `workers: 0` at team
 * level for the rest of its life — #15769's four teams all read 0 while eleven Slot rows
 * beneath them carry the real numbers. So the team-level read undercounts every order the
 * ops team assembled by hand, which is most of them.
 *
 * Summing the Slot rows does not rescue it either: those eleven slots sum to 27 against
 * the 8 crew the client asked for, because slots on a multi-day job are SHIFTS, not
 * simultaneous heads. There is no reading of the audit log that returns "how many people
 * does this booking want" for an order built that way.
 *
 * The job window is the quantity that survives. It is on the Job record, it is exact, and
 * it does not depend on how the order was assembled.
 */
async function jobWindow(order_id) {
  const o = (await get(`/orders?id[eq]=${order_id}&limit=1&with=Job`)).data?.[0];
  const j = (o?.Job ?? [])[0];
  return j ? { min: j.min_beginning, max: j.max_end } : null;
}

// ---------------------------------------------------------------------------
// The population: every order id this engine ever put on a thread, with the
// fingerprint we still hold for it. order_records is exact but only exists from
// 2026-09-02; tickets is lossier (crew_size is the thread's, not the order's) and
// goes back to the beginning, which is what gets the sample past 30.
// ---------------------------------------------------------------------------
const recs = await sql`select order_id, company_id, shape_sent, crew_total, block_count, created_at from order_records`;
const exact = new Map(recs.map((r) => [Number(r.order_id), r]));

const tix = await sql`
  select t.thread_id, t.onsinch_order_id::int order_id, t.crew_size, t.dates, t.company_id,
         t.subject, t.created_at, cs.state
  from tickets t left join conversation_state cs on cs.thread_id = t.thread_id
  where t.onsinch_order_id is not null`;

const pop = [];
for (const t of tix) {
  const s = typeof t.state === 'string' ? JSON.parse(t.state) : (t.state ?? {});
  // Only orders THIS ENGINE created. A matched order was raised by a person and was
  // never ours to lose, so counting it would flatter the recall number.
  const weCreated = (s.order_action_log ?? []).some(
    (a) => a.ok && (a.kind === 'create' || a.kind === 'replace') && Number(a.order_id) === Number(t.order_id));
  if (!weCreated) continue;
  const ex = exact.get(Number(t.order_id));
  const teams = s.last_ordered_teams ?? s.desired_order?.slot_teams ?? [];
  const d = day(ex?.shape_sent?.slot_teams?.[0]?.beginning ?? teams[0]?.beginning ?? (Array.isArray(t.dates) ? t.dates[0] : null));
  const crew = ex?.crew_total ?? (teams.length ? teams.reduce((n, x) => n + (x.size || 0), 0) : Number(t.crew_size) || null);
  const company = ex?.company_id ?? s.desired_order?.company_id ?? t.company_id ?? null;
  pop.push({
    order_id: Number(t.order_id), company_id: company ? Number(company) : null, day: d,
    crew: crew ? Number(crew) : null, exact: !!ex, when: ex?.created_at ?? t.created_at,
    subject: String(t.subject ?? '').slice(0, 34),
  });
}
// One row per order — a thread can log the same id twice.
const byId = new Map(); for (const p of pop) if (!byId.has(p.order_id)) byId.set(p.order_id, p);
const all = [...byId.values()].filter((p) => !/new booking request in london/.test(p.subject));
console.log(`engine-created orders on real threads: ${all.length}  (exact shape on record: ${all.filter((p) => p.exact).length})`);

const dead = [];
for (const p of all) {
  const j = await get(`/orders?id[eq]=${p.order_id}&limit=1`);
  if (!j.data?.length) dead.push(p);
}
console.log(`of those, vanished from OnSinch: ${dead.length}\n`);

// ---------------------------------------------------------------------------
// 1. RECALL
// ---------------------------------------------------------------------------
const usable = dead.filter((p) => p.company_id && p.day);
console.log(`== 1. RECALL — company_id + happening day, n=${usable.length} ==`);
const t1 = { 0: 0, 1: 0, 2: 0, '3+': 0 };
const found = [];
for (const p of usable) {
  const q = await get(`/orders?company_id[eq]=${p.company_id}&limit=100`);
  // A successor is raised AFTER ours and therefore carries a higher id. An order with a
  // lower id existed before we ever wrote and cannot be what replaced us — without this
  // the scan matched #15601 to #15702 and #15578 to #15585 purely on company and day.
  const cands = (q.data ?? []).filter((o) => day(o.happening) === p.day && Number(o.id) > p.order_id);
  t1[cands.length === 0 ? 0 : cands.length === 1 ? 1 : cands.length === 2 ? 2 : '3+']++;
  if (cands.length === 1) found.push({ p, c: cands[0] });
  p._cands = cands;
}
for (const [k, v] of Object.entries(t1)) console.log(`   ${String(k).padStart(3)} candidate(s): ${String(v).padStart(3)}  ${(100 * v / usable.length).toFixed(0)}%`);

const idPlus = found.filter(({ p, c }) => Number(c.id) - p.order_id >= 1 && Number(c.id) - p.order_id <= 3).length;
const gaps = found.map(({ p, c }) => Number(c.id) - p.order_id).sort((a, b) => a - b);
console.log(`   of the ${found.length} unique matches, ${idPlus} sit within +3 ids of ours`);
console.log(`   id gaps: ${JSON.stringify(gaps)}`);

// ---------------------------------------------------------------------------
// 2. SPECIFICITY — a control. Ask the same question of orders that did NOT vanish.
//    If a live engine order also has exactly one same-company same-day neighbour,
//    then "exactly one candidate" is not evidence of a successor at all.
// ---------------------------------------------------------------------------
/**
 * The control was first written against the engine's own still-live orders and there are
 * only seven of them — too few to say anything. The population that answers the question
 * is the tenant's, so this asks the identical question of 400 orders nobody deleted: if
 * this order vanished right now, how many candidates would the rule offer?
 *
 * A high "exactly one" rate here would mean the rule is reading coincidence.
 */
console.log('\n== 2. SPECIFICITY — the same question asked of orders nobody deleted ==');
const sample = [];
for (let page = 1; page <= 4; page++) {
  const j = await get(`/orders?limit=100&page=${page}`);
  for (const o of j.data ?? []) if (o.company_id && o.happening) sample.push(o);
}
const peersOf = new Map();
for (const o of sample) {
  if (peersOf.has(o.company_id)) continue;
  peersOf.set(o.company_id, (await get(`/orders?company_id[eq]=${o.company_id}&limit=100`)).data ?? []);
}
const t2 = { 0: 0, 1: 0, 2: 0, '3+': 0 };
let ctlOne = 0, ctlNear = 0;
for (const o of sample) {
  const peers = (peersOf.get(o.company_id) ?? [])
    .filter((x) => day(x.happening) === day(o.happening) && Number(x.id) > Number(o.id));
  t2[peers.length === 0 ? 0 : peers.length === 1 ? 1 : peers.length === 2 ? 2 : '3+']++;
  if (peers.length === 1) { ctlOne++; if (Number(peers[0].id) - Number(o.id) <= 3) ctlNear++; }
}
console.log(`   n=${sample.length}`);
for (const [k, v] of Object.entries(t2)) console.log(`   ${String(k).padStart(3)} later order(s) same company+day: ${String(v).padStart(4)}  ${(100 * v / sample.length).toFixed(1)}%`);
console.log(`   of the ${ctlOne} with exactly one, ${ctlNear} lie within +3 ids`);
console.log(`   FALSE POSITIVE RATE for company + day + within-3-ids: ${ctlNear}/${sample.length} = ${(100 * ctlNear / sample.length).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// 3. FIDELITY — does the successor carry the crew we asked for?
// ---------------------------------------------------------------------------
console.log(`\n== 3. FIDELITY — does the successor's job window start on the day we asked for? n=${found.length} ==`);
let onDay = 0, offDay = 0, noWindow = 0;
const rows = [];
for (const { p, c } of found) {
  const w = await jobWindow(c.id);
  if (!w?.min) { noWindow++; continue; }
  const match = day(w.min) === p.day;
  match ? onDay++ : offDay++;
  const s = await auditShape(c.id);
  rows.push({ ours: p.order_id, theirs: c.id, our: p.day, their: day(w.min), max: day(w.max), blocks: s.teams.length, match });
}
console.log(`   starts on our day    : ${onDay}`);
console.log(`   starts elsewhere     : ${offDay}`);
console.log(`   no readable job      : ${noWindow}`);
for (const r of rows.filter((x) => !x.match)) {
  console.log(`   OFF   ours #${r.ours} wanted ${r.our} -> #${r.theirs} runs ${r.their}..${r.max}`);
}
