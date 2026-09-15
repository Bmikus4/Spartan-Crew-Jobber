// ============================================================================
// WHAT CAN ACTUALLY BE READ BACK OFF A LIVE ORDER.
// ----------------------------------------------------------------------------
// The evidence behind reconcile.ts. There is no `GET /slotTeams` and no `GET /slots` —
// every spelling is 404 or 405 — so a crew block's size, window, venue, profession and
// name are not directly readable at all. They ride on the attendance rows.
//
// Run it before trusting anything reconcile.ts claims about readability. It takes a
// POSITIVE CONTROL first — an order that definitely has attendance — because the failure
// mode here is an empty list that looks like an answer.
//
// Read-only. No writes.
//   node scripts/probe-live-shape.mjs
// ============================================================================
import { loadEnv } from "./_env.mjs";
loadEnv();
const base = (process.env.ONSINCH_BASE_URL || "").replace(/\/$/, "");
const key = (process.env.ONSINCH_API_KEY || "").trim();
const get = async (p) => {
  const r = await fetch(base + p, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  return { status: r.status, body: r.ok ? await r.json() : await r.text() };
};

const orders = (await get(`/orders?status[eq]=0&limit=40&with=Job`)).body?.data ?? [];
console.log(`open orders sampled: ${orders.length}`);

let staffed = null;
for (const o of orders) {
  const c = (await get(`/attendance?limit=1&with=Order&Order__id=${o.id}`)).body?.pagination?.count ?? 0;
  if (c > 0) { staffed = { o, c }; break; }
}

if (!staffed) {
  // The control, and it matters: without it, "the expansion returns nothing" and "no
  // sampled order has anybody on it" are the same output and the wrong one gets believed.
  console.log("CONTROL FAILED: no sampled order has attendance — the staffed read is untested, not disproved");
} else {
  const { o, c } = staffed;
  console.log(`\nSTAFFED order #${o.id} R${o.number} "${o.name}" — ${c} attendance row(s)`);
  const job = Array.isArray(o.Job) ? o.Job[0] : o.Job;
  console.log(`  Job window: ${job?.min_beginning} -> ${job?.max_end}`);
  console.log(`  specification: ${JSON.stringify(String(o.specification ?? "").slice(0, 60))}  intern_name: ${JSON.stringify(o.intern_name)}`);

  const r = await get(`/attendance?limit=5&with=Slot,SlotTeam,Order&Order__id=${o.id}`);
  const rows = r.body?.data ?? [];
  console.log(`  attendance?with=Slot,SlotTeam -> status ${r.status}, ${rows.length} row(s)`);
  const row = rows[0];
  if (row) {
    const slot = Array.isArray(row.Slot) ? row.Slot[0] : row.Slot;
    const st = Array.isArray(row.SlotTeam) ? row.SlotTeam[0] : row.SlotTeam;
    console.log(`  Slot keys:     ${slot ? Object.keys(slot).join(",") : "ABSENT"}`);
    console.log(`  SlotTeam keys: ${st ? Object.keys(st).join(",") : "ABSENT"}`);
    console.log(`  Slot:     ${JSON.stringify(slot)?.slice(0, 400)}`);
    console.log(`  SlotTeam: ${JSON.stringify(st)?.slice(0, 400)}`);
  }
}

// The unstaffed case, which is the common one for a To Confirm order and the reason
// reconcile.ts must never read "no rows" as "no blocks".
const empty = orders.find((o) => o.id !== staffed?.o?.id);
if (empty) {
  const c = (await get(`/attendance?limit=1&with=Order&Order__id=${empty.id}`)).body?.pagination?.count ?? 0;
  const r = await get(`/attendance?limit=5&with=Slot,SlotTeam,Order&Order__id=${empty.id}`);
  const job = Array.isArray(empty.Job) ? empty.Job[0] : empty.Job;
  console.log(`\nOTHER order #${empty.id} R${empty.number} — attendance count ${c}`);
  console.log(`  Job window: ${job?.min_beginning} -> ${job?.max_end}`);
  console.log(`  attendance rows returned: ${(r.body?.data ?? []).length}`);
}

// `with=Job` is the only expansion that works on /orders, and an unstaffed order depends
// on it entirely, so it gets its own control.
if (orders[0]) {
  const one = await get(`/orders?id[eq]=${orders[0].id}&limit=1&with=Job`);
  const j = one.body?.data?.[0];
  console.log(`\nJob expansion control on #${orders[0].id}: ${j?.Job ? "present" : "ABSENT"} ${JSON.stringify((Array.isArray(j?.Job) ? j.Job[0] : j?.Job) ?? {}).slice(0, 200)}`);
}
