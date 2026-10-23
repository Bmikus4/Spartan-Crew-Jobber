// ============================================================================
// The job matcher's gold set input, read ONCE from production, read-only (GETs and SELECTs).
// ----------------------------------------------------------------------------
// Everything a link between a client email and an OnSinch order can be judged on, back to
// the first stored delivery (29 Jul): every stored message, the readings and decisions made
// of them, the old engine's tickets (its own links and dates, Jul to Oct), the links kept
// now, and OnSinch's companies, places, newest orders and timeline over the same window.
// The timeline is what the labels are made from: a staff action on an order after an email.
// Written to .tmp-data/gold/ (gitignored: it is client data).
//
//   npx tsx --env-file=.env.local scripts/gold/snapshot.mts [--from 2026-07-29T00:00:00Z] [--orders 3500]
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { mkdirSync, writeFileSync } from "node:fs";
import { httpTransport } from "../../app/lib/engine/onsinch";
import { readPage, readRows } from "../../app/lib/v2/read";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg("--from", "2026-07-29T00:00:00Z");
const ORDERS = Number(arg("--orders", "3500"));
const OUT = ".tmp-data/gold";
const sql = neon((process.env.DATABASE_URL || "").trim());
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" }) as any;
mkdirSync(OUT, { recursive: true });
const save = (name: string, v: unknown) => { writeFileSync(`${OUT}/${name}.json`, JSON.stringify(v)); console.log(`${name}: ${Array.isArray(v) ? v.length : Object.keys(v as object).length}`); };

save("meta", { from: FROM, taken_at: new Date().toISOString() });
// Every column, so the Cc and attachment columns (added 22 Oct) come along once intake has made
// them; 1,000 rows a read, because the whole table in one answer passes Neon's 64 MB cap.
const messages: any[] = [];
for (let last = ""; ;) {
  const page = (await sql`SELECT * FROM thread_messages WHERE message_id > ${last} ORDER BY message_id LIMIT 1000`) as any[];
  messages.push(...page);
  if (page.length < 1000) break;
  last = page[page.length - 1].message_id;
}
save("messages", messages);
save("readings", await sql`SELECT message_id, thread_id, sent_at, interpretation->'extraction' AS extraction FROM v2_decisions WHERE interpretation->'extraction' IS NOT NULL`);
save("decisions", await sql`SELECT message_id, thread_id, sent_at, kind, decision, executed, code_version, company_id, company, created_at FROM v2_decisions`);
save("tickets", await sql`SELECT thread_id, subject, contact, company_id, user_id, place_id, onsinch_order_id, onsinch_order_number, onsinch_job_id,
  classification, status, is_client_inquiry, crew_size, dates, location, extracted, created_at, updated_at FROM tickets`);
save("links", await sql`SELECT * FROM job_links`);

const all = async (path: string, max = 100) => { const out: any[] = []; for (let p = 1; p <= max; p++) { const r = await readPage(t, `${path}${path.includes("?") ? "&" : "?"}limit=100&page=${p}`); out.push(...r.rows); if (r.rows.length < 100) break; } return out; };
save("companies", await all("/companies?with=Client"));
save("places", await all("/places"));
save("professions", await readRows(t, "/professions?limit=200"));
// Newest first (the API's order): 3,500 reaches back past every job a July email can be about.
save("orders", await all(`/orders?with=Job__SlotTeam__Slot__SlotLocation`, Math.ceil(ORDERS / 100)));

// The timeline from FROM: the first page whose oldest row is at or after FROM, found by halving.
const first = await readPage(t, `/timelineAudits?limit=100`);
let lo = 1, hi = first.pageCount;
while (lo < hi) { const mid = Math.floor((lo + hi) / 2); const r = await readPage(t, `/timelineAudits?limit=100&page=${mid}`); if (Date.parse(r.rows[0]?.created ?? "") < Date.parse(FROM)) lo = mid + 1; else hi = mid; }
const startId = Number((await readPage(t, `/timelineAudits?limit=100&page=${Math.max(1, lo - 1)}`)).rows[0]?.id ?? 0);
const rows: any[] = [];
for (const action of ["common_change", "common_create", "order_create", "order_create_by_copy", "order_confirm_provisional", "common_delete", "order_cancel", "order_created_via_api"]) {
  for (let p = 1; p <= 1000; p++) {
    const r = await readPage(t, `/timelineAudits?action[eq]=${action}&id[gte]=${startId}&limit=100&page=${p}`);
    rows.push(...r.rows);
    if (r.rows.length < 100) break;
  }
}
save("timeline", rows.filter((x) => Date.parse(x.created) >= Date.parse(FROM)).sort((a, b) => Number(a.id) - Number(b.id)));
