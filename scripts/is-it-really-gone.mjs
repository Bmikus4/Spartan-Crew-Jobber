// ============================================================================
// THE ABSENCE THE WHOLE STORY RESTS ON
// ----------------------------------------------------------------------------
// "89% of what the engine makes is destroyed and retyped by a person" rests entirely on
// `GET /orders?id[eq]=N` coming back empty. Everything else — successor matching, id
// custody, the amendment plan — is downstream of that one read.
//
// Two things now say that read deserves a harder look:
//   - 776 copy links exist on this tenant and NOT ONE involves an engine order, so the
//     team is not copying ours.
//   - a person deleting an order should leave `common_delete` (102 in the vocabulary
//     sample). Not one of our 77 has one. 23 still carry their own creation row.
//
// An order that was destroyed leaves a delete row. An order that is merely INVISIBLE to
// one query leaves exactly what we see: nothing. Handoff §8.1 is this error's own
// warning — never report an absence without proving the instrument can see a presence,
// and the 5-id control only proved it can see the 5 NEWEST orders.
//
// So: take vanished ids and hunt them by every other route the API offers.
//
// Read-only. No writes to OnSinch, no model calls.
//   node scripts/is-it-really-gone.mjs
// ============================================================================
import { sql } from './_q.mjs';

const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const raw = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { status: r.status, json: j, text: t.slice(0, 200) };
};
const get = async (p) => (await raw(p)).json ?? { data: [] };

// ── engine orders, and which are invisible to the id query ──────────────────
const rows = await sql`select thread_id, state from conversation_state`;
const ours = new Map();
for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  for (const a of s.order_action_log ?? []) {
    if ((a.kind === 'create' || a.kind === 'replace') && a.ok && a.order_id) ours.set(Number(a.order_id), r.thread_id);
  }
}
const missing = [];
for (const id of ours.keys()) {
  if (!((await get(`/orders?id[eq]=${id}&limit=1`)).data ?? []).length) missing.push(id);
}
console.log(`engine orders invisible to /orders?id[eq]=: ${missing.length} of ${ours.size}`);

// ── what the creation audit row knows about them (number + name) ────────────
const known = new Map();
for (const id of missing) {
  const a = await get(`/timelineAudits?data[like]=${encodeURIComponent('%Order:' + id + '%')}&limit=20`);
  for (const r of a.data ?? []) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    if (String(d.id) === String(id) && d.model === 'Order') {
      known.set(id, { name: d.name, number: d.data?.number ?? null, quote: d.data?.quote ?? null, created: r.created });
    }
  }
}
console.log(`of those, ${known.size} still carry their own creation row (name + order number)\n`);

// ── hunt each one by every other route ──────────────────────────────────────
const probes = ['singular /orders/<id>', 'number[eq]', 'quote[eq]=true', 'name[like]', 'status[eq]=1'];
const tally = new Map(probes.map((p) => [p, 0]));
let tested = 0;
for (const [id, k] of [...known].slice(0, 12)) {
  tested++;
  const out = [];

  const s = await raw(`/orders/${id}`);
  const okSingular = s.status === 200 && (s.json?.data?.id || s.json?.id);
  if (okSingular) { tally.set(probes[0], tally.get(probes[0]) + 1); out.push(`SINGULAR 200`); }
  else out.push(`singular ${s.status}`);

  if (k.number) {
    const n = (await get(`/orders?number[eq]=${k.number}&limit=3`)).data ?? [];
    if (n.length) { tally.set(probes[1], tally.get(probes[1]) + 1); out.push(`number->#${n.map((o) => o.id).join(',')}`); }
    else out.push('number->0');
  }

  const q = (await get(`/orders?id[eq]=${id}&quote[eq]=true&limit=1`)).data ?? [];
  if (q.length) { tally.set(probes[2], tally.get(probes[2]) + 1); out.push('QUOTE'); }

  if (k.name) {
    const frag = k.name.slice(0, 24);
    const nm = (await get(`/orders?name[like]=${encodeURIComponent('%' + frag + '%')}&limit=5`)).data ?? [];
    if (nm.length) { tally.set(probes[3], tally.get(probes[3]) + 1); out.push(`name->#${nm.map((o) => o.id).join(',')}`); }
    else out.push('name->0');
  }

  const st = (await get(`/orders?id[eq]=${id}&status[eq]=1&limit=1`)).data ?? [];
  if (st.length) { tally.set(probes[4], tally.get(probes[4]) + 1); out.push('STATUS1'); }

  console.log(`#${id} n=${k.number} ${String(k.name).slice(0, 40)}`);
  console.log(`    ${out.join('  |  ')}`);
}

console.log(`\nroutes that found a supposedly-gone order (of ${tested} tested):`);
for (const [p, n] of tally) console.log(`   ${String(n).padStart(3)}/${tested}  ${p}`);

// ── and the arithmetic control: does the status breakdown still close? ──────
const un = (await get('/orders?limit=1')).pagination?.count ?? 0;
let sum = 0;
for (const s of [-2, -1, 0, 1, 2]) {
  const c = (await get(`/orders?status[eq]=${s}&limit=1`)).pagination?.count ?? 0;
  if (c) console.log(`status ${String(s).padStart(2)}: ${c}`);
  sum += c;
}
console.log(`unfiltered ${un}   sum of statuses ${sum}   ${un === sum ? 'closes' : 'DOES NOT CLOSE — ' + (un - sum) + ' orders are in no status'}`);
