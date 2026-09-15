// ============================================================================
// WORK AROUND THE DELETION — BIND ON THE DELETE EVENT, NOT ON A GUESS
// ----------------------------------------------------------------------------
// Phase C of the plan resolves a successor by company + happening day + id > ours,
// single candidates only: 57% recall, 3.0% false positive. That was the best rule
// available while the deletion looked untraceable.
//
// It is traceable. `common_delete` names the order, the USER and the MINUTE. So a much
// stronger anchor exists: the successor is the order the SAME PERSON created shortly
// after deleting ours. This measures that rule on the same population, with instrument
// controls first and a matched control at the end, so it is comparable to the plan's.
//
// Cheap by construction: job ids come from `conversation_state.onsinch_job_id` rather
// than a full `common_create` sweep (that action has ~200k rows and paging it was what
// made the first attempt crawl).
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/delete-anchored-successor.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status, data: [] };
};
const parse = (r) => { try { return JSON.parse(r.data); } catch { return null; } };
// The API wants `2026-09-07T11:00:00`. A space separator instead of the T is accepted,
// silently matches nothing, and returns a confident empty list — which is why the
// instrument control below exists rather than being assumed.
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19);

// ── INSTRUMENT CONTROLS FIRST (handoff §8.1) ────────────────────────────────
// Every number below rests on creator[eq] and created[gte]/[lte] actually filtering.
// request_approval[eq] silently returned 0 for BOTH values earlier this session, so an
// unverified filter on this API is not a filter.
const cCre = (await get('/orders?creator[eq]=413&limit=20')).data ?? [];
const creatorWorks = cCre.length > 0 && cCre.every((o) => o.creator === 413);
const win = (await get(`/orders?created[gte]=${encodeURIComponent('2026-09-01T00:00:00')}&created[lte]=${encodeURIComponent('2026-09-03T00:00:00')}&limit=50`)).data ?? [];
const dateWorks = win.length > 0 && win.every((o) => o.created >= '2026-09-01' && o.created <= '2026-09-03T23');
console.log(`control: creator[eq] filters = ${creatorWorks} (${cCre.length} rows, all creator 413: ${cCre.every((o) => o.creator === 413)})`);
console.log(`control: created[gte]/[lte] filters = ${dateWorks} (${win.length} rows in a 2-day window)`);
if (!creatorWorks || !dateWorks) { console.log('\nFILTERS DO NOT WORK — every rule below would be unmeasurable. Stop.'); process.exit(1); }

// ── ours, with the company we sent and the job we made ──────────────────────
const rows = await sql`select thread_id, state from conversation_state`;
const ours = new Map();
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if ((a.kind === 'create' || a.kind === 'replace') && a.ok && a.order_id) {
      ours.set(Number(a.order_id), {
        thread: r.thread_id, ts: a.ts ?? null,
        company_id: s.company_id ?? null,
        job_id: s.onsinch_job_id ?? null,
      });
    }
  }
}
console.log(`\nengine orders: ${ours.size}`);

// ── the delete ledger ───────────────────────────────────────────────────────
const first = await get('/timelineAudits?action[eq]=common_delete&limit=200');
const delCount = first.pagination?.count ?? 0;
const dels = [...(first.data ?? [])];
for (let p = 2; p <= Math.ceil(delCount / 200); p++) dels.push(...((await get(`/timelineAudits?action[eq]=common_delete&limit=200&page=${p}`)).data ?? []));
const orderDel = new Map(), jobDel = new Map();
for (const r of dels) {
  const d = parse(r); if (!d) continue;
  if (d.model === 'Order') orderDel.set(Number(d.id), { creator: r.creator, created: r.created });
  if (d.model === 'Job') jobDel.set(Number(d.id), { creator: r.creator, created: r.created });
}
console.log(`common_delete rows: ${dels.length}   distinct Orders deleted: ${orderDel.size}   Jobs: ${jobDel.size}`);

// ── which of ours are gone, and is the deletion readable ────────────────────
const gone = [];
for (const id of ours.keys()) if (!((await get(`/orders?id[eq]=${id}&limit=1`)).data ?? []).length) gone.push(id);

const anchors = new Map();
let viaOrder = 0, viaJob = 0, none = 0;
for (const id of gone) {
  const od = orderDel.get(id);
  if (od) { anchors.set(id, { ...od, level: 'Order' }); viaOrder++; continue; }
  const jid = ours.get(id).job_id;
  const jd = jid ? jobDel.get(Number(jid)) : null;
  if (jd) { anchors.set(id, { ...jd, level: 'Job' }); viaJob++; continue; }
  none++;
}
console.log(`\nvanished: ${gone.length}`);
console.log(`   deletion readable at Order level: ${viaOrder}`);
console.log(`   readable only at Job level:       ${viaJob}`);
console.log(`   no deletion event found:          ${none}`);
console.log(`   => READABLE DELETION for ${anchors.size}/${gone.length} (${Math.round(anchors.size / gone.length * 100)}%)`);

// ── the rule ────────────────────────────────────────────────────────────────
const WINDOWS = [60, 240, 1440];
const res = new Map(WINDOWS.map((w) => [w, { one: 0, oneCo: 0, many: 0, zero: 0 }]));
let scored = 0, noUser = 0;
const shown = [];
for (const [id, a] of anchors) {
  if (!a.creator) { noUser++; continue; }
  scored++;
  const t0 = new Date(a.created).getTime();
  const co = ours.get(id).company_id;
  const cand = (await get(`/orders?creator[eq]=${a.creator}&created[gte]=${encodeURIComponent(stamp(t0 - 5 * 60000))}&created[lte]=${encodeURIComponent(stamp(t0 + 1440 * 60000))}&limit=100`)).data ?? [];
  for (const w of WINDOWS) {
    const inWin = cand.filter((o) => { const dt = (new Date(o.created).getTime() - t0) / 60000; return dt >= -5 && dt <= w; });
    const r = res.get(w);
    if (inWin.length === 0) r.zero++;
    else if (inWin.length === 1) r.one++;
    else r.many++;
    // narrowing by the company we sent — the condition the plan's rule already uses
    const coWin = co ? inWin.filter((o) => Number(o.company_id) === Number(co)) : [];
    if (coWin.length === 1) r.oneCo++;
  }
  if (shown.length < 12) {
    const w60 = cand.filter((o) => { const dt = (new Date(o.created).getTime() - t0) / 60000; return dt >= -5 && dt <= 60; });
    shown.push(`   #${id} co=${String(co ?? '?').padEnd(4)} deleted by ${a.creator} (${a.level}) @${String(a.created).slice(5, 16)} -> 60m: ${w60.map((o) => `#${o.id}${Number(o.company_id) === Number(co) ? '*' : ''}`).join(' ') || '(none)'}`);
  }
}
console.log(`\nscored ${scored} anchors (${noUser} deletions record no user)\n`);
console.log(`window   exactly one order by that person   ...and it is OUR company   >1      0`);
for (const w of WINDOWS) {
  const r = res.get(w);
  console.log(`  ${String(w).padStart(4)}m   ${String(r.one).padStart(3)} (${String(Math.round(r.one / scored * 100)).padStart(2)}%)                        ` +
    `${String(r.oneCo).padStart(3)} (${String(Math.round(r.oneCo / scored * 100)).padStart(2)}%)        ${String(r.many).padStart(3)}   ${String(r.zero).padStart(3)}`);
}
console.log(`\nexamples ( * = same company as the order we lost ):`);
for (const s of shown) console.log(s);

// ── matched control: the same rule on deletions that are nothing to do with us ──
console.log(`\ncontrol — 120 deletions of orders the engine never made:`);
const foreign = [...orderDel].filter(([id]) => !ours.has(id)).slice(-120);
let cs = 0; const cRes = { one: 0, many: 0, zero: 0 };
for (const [, a] of foreign) {
  if (!a.creator) continue;
  const t0 = new Date(a.created).getTime();
  const cand = (await get(`/orders?creator[eq]=${a.creator}&created[gte]=${encodeURIComponent(stamp(t0 - 5 * 60000))}&created[lte]=${encodeURIComponent(stamp(t0 + 60 * 60000))}&limit=50`)).data ?? [];
  cs++;
  if (cand.length === 0) cRes.zero++; else if (cand.length === 1) cRes.one++; else cRes.many++;
}
console.log(`   ${cs} scored: exactly one order by that person within 60m = ${cRes.one} (${Math.round(cRes.one / Math.max(cs, 1) * 100)}%), >1 = ${cRes.many}, none = ${cRes.zero}`);
console.log(`   (this is the ambiguity floor: how often "one order in the window" happens anyway)`);
