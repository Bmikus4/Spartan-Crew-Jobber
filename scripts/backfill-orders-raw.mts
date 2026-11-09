// ============================================================================
// Every order OnSinch serves, stored raw and append-only (research build 1).
// ----------------------------------------------------------------------------
// onsinch_orders is a current-state cache: each refresh overwrites body, so the
// database holds no order as it stood when an email arrived, and OnSinch keeps
// nothing at all for a deleted order (its create row is dropped from the
// timeline too — audit 10-30). onsinch_orders_raw never updates a row; this
// script fills it with the full /orders listing, the longest record the
// business has (~12,000 ids against ~3,000 cached).
//
//   npx tsx --env-file=.env.local scripts/backfill-orders-raw.mts probe   read-only: how far back /orders and /timelineAudits go
//   npx tsx --env-file=.env.local scripts/backfill-orders-raw.mts pull    the backfill; reruns skip stored ids
//
// GETs only, one at a time: OnSinch 500s under concurrent load (onsinch.ts has
// the measurement). Nothing here retries; a failed page kills the run and the
// rerun resumes past what was stored. /orders lists newest first, so an order
// created mid-run shifts the pages under the walk — the final count check
// reports any shortfall, and a rerun collects it.
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";
import { httpTransport } from "../app/lib/onsinch/onsinch";
import { readPage } from "../app/lib/v2/read";
import { migrate } from "../app/lib/migrations";

loadEnv();
const mode = process.argv[2];
if (mode !== "probe" && mode !== "pull") {
  console.error("usage: backfill-orders-raw.mts probe|pull");
  process.exit(2);
}
const t = httpTransport({
  baseUrl: (process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1").replace(/\/$/, ""),
  apiKey: requireEnv("ONSINCH_API_KEY"),
});
const sql: any = neon(requireEnv("DATABASE_URL").trim());
const WITH = "Job__SlotTeam__Slot__SlotLocation"; // the same embed the app stores, so raw and cache compare field for field
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (mode === "probe") {
  // Ids rise with time and pages come back id-ascending (pullTimeline's invariant), so page 1 row 1 is the oldest served.
  const tl = await readPage(t, "/timelineAudits?limit=1&page=1");
  const oldest = tl.rows[0];
  console.log(`timelineAudits: ${tl.count} rows served; oldest id ${oldest?.id} created ${oldest?.created} action ${oldest?.action}`);
  const stored = await sql`SELECT min(id)::bigint lo, max(id)::bigint hi, count(*) n FROM onsinch_timeline`;
  console.log(`onsinch_timeline stored: ids ${stored[0].lo}..${stored[0].hi}, ${stored[0].n} rows (pull began at id 867675)`);
  const o = await readPage(t, `/orders?limit=1&page=1`);
  const last = await readPage(t, `/orders?limit=1&page=${o.count}`);
  console.log(`orders: ${o.count} served; newest number ${o.rows[0]?.number}, oldest number ${last.rows[0]?.number} begin ${last.rows[0]?.begin ?? last.rows[0]?.created ?? "?"}`);
  process.exit(0);
}

await migrate(sql);
const have = new Set(((await sql`SELECT DISTINCT order_id FROM onsinch_orders_raw`) as any[]).map((r: any) => Number(r.order_id)));
console.log(`stored already: ${have.size} order ids`);
let page = 1, pageCount = 1, fetched = 0, kept = 0, served = 0;
for (; page <= pageCount; page++) {
  const r = await readPage(t, `/orders?limit=100&page=${page}&with=${WITH}`);
  pageCount = r.pageCount || pageCount;
  served = r.count || served;
  const fresh = r.rows.filter((o: any) => !have.has(Number(o.id)));
  const at = new Date().toISOString();
  for (let i = 0; i < fresh.length; i += 50)
    await sql`INSERT INTO onsinch_orders_raw (order_id, fetched_at, number, company_id, body)
      SELECT (o->>'id')::bigint, ${at}::timestamptz, o->>'number', (o->>'company_id')::int, o
      FROM jsonb_array_elements(${JSON.stringify(fresh.slice(i, i + 50))}::jsonb) o
      ON CONFLICT (order_id, fetched_at) DO NOTHING`;
  for (const o of fresh) have.add(Number(o.id));
  fetched += r.rows.length;
  kept += fresh.length;
  if (page % 10 === 0 || page === pageCount) console.log(`page ${page}/${pageCount}: read ${fetched}, stored ${kept} new`);
  await pause(150);
}
const n = await sql`SELECT count(DISTINCT order_id) n FROM onsinch_orders_raw`;
console.log(`done: OnSinch serves ${served} orders; ${n[0].n} distinct ids stored raw${Number(n[0].n) >= served ? "" : ` — ${served - Number(n[0].n)} SHORT, rerun to collect`}`);
