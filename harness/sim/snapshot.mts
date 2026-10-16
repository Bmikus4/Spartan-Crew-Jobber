// ============================================================================
// The simulator's input, read ONCE from production, read-only (GETs and SELECTs only).
// ----------------------------------------------------------------------------
// Everything the live path consumed since the rebuild's intake went live (V2_FROM), in the shape
// it arrived, and what it read:
//   payloads   inbound_raw: every n8n delivery, verbatim, in arrival order
//   readings   v2_decisions: the model's stored reading of each email (so no model is called)
//   marks      feed_marks a PERSON made (ticks): human input, replayed at their time
//   states     conversation_state: the paused engine's threads, which the TV still draws
//   settings   app_settings
//   onsinch    companies, places, professions, the newest orders (nested), and staff's
//              timeline rows in the window. Orders the bot made in the window are left out:
//              the simulated bot makes its own.
// Written to .tmp-data/sim/ (gitignored: it is client data).
//
//   npx tsx --env-file=.env.local harness/sim/snapshot.mts [--orders 3000]
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { mkdirSync, writeFileSync } from "node:fs";
import { httpTransport } from "../../app/lib/engine/onsinch";
import { readPage, readRows } from "../../app/lib/v2/read";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = "2026-10-09T10:20:00Z";
const ORDERS = Number(arg("--orders", "3000"));
const BOT = 2257;
const sql = neon((process.env.DATABASE_URL || "").trim());
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" }) as any;
const OUT = ".tmp-data/sim";
mkdirSync(OUT, { recursive: true });
const save = (name: string, v: unknown) => { writeFileSync(`${OUT}/${name}.json`, JSON.stringify(v)); console.log(`${name}: ${Array.isArray(v) ? v.length : Object.keys(v as object).length}`); };

save("meta", { from: FROM, taken_at: new Date().toISOString() });
save("payloads", await sql`SELECT id, dedup_key, source, thread_id, message_id, payload, received_at, message_ids, envelope FROM inbound_raw WHERE received_at >= ${FROM} ORDER BY received_at, id`);
// The bodies: inbound_raw keeps the envelope (the payload minus its messages), thread_messages
// keeps each message once. A delivery is the two put back together (run.mts).
save("messages", await sql`SELECT message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan, rfc_message_id, in_reply_to, reference_ids
  FROM thread_messages WHERE thread_id IN (SELECT DISTINCT thread_id FROM inbound_raw WHERE received_at >= ${FROM} AND thread_id IS NOT NULL)`);
save("readings", await sql`SELECT message_id, thread_id, sent_at, interpretation->'extraction' AS extraction, interpretation->'meta' AS meta FROM v2_decisions WHERE interpretation IS NOT NULL AND interpretation->'extraction' IS NOT NULL`);
// The production decisions themselves, only to compare the simulated TV with the real one.
save("decisions", await sql`SELECT message_id, thread_id, sent_at, kind, decision, executed, code_version, company_id, company, created_at FROM v2_decisions WHERE created_at >= ${FROM}`);
save("marks", await sql`SELECT item_key, thread_id, mark, by, evidence, at FROM feed_marks WHERE by IS NOT NULL OR mark = 'checked'`);
save("states", await sql`SELECT * FROM conversation_state`);
save("settings", await sql`SELECT * FROM app_settings`);
save("links", await sql`SELECT * FROM job_links`);

// OnSinch.
const all = async (path: string, max = 100) => { const out: any[] = []; for (let p = 1; p <= max; p++) { const r = await readPage(t, `${path}${path.includes("?") ? "&" : "?"}limit=100&page=${p}`); out.push(...r.rows); if (r.rows.length < 100) break; } return out; };
save("companies", await all("/companies?with=Client"));
save("places", await all("/places"));
save("professions", await readRows(t, "/professions?limit=200"));
const orders = await all(`/orders?with=Job__SlotTeam__Slot__SlotLocation`, Math.ceil(ORDERS / 100));
save("orders", orders.filter((o) => !(Number(o.creator) === BOT && Date.parse(o.created) >= Date.parse(FROM))));
save("bot_orders_left_out", orders.filter((o) => Number(o.creator) === BOT && Date.parse(o.created) >= Date.parse(FROM)).map((o) => ({ id: o.id, number: o.number, company_id: o.company_id, created: o.created })));
// Staff's timeline rows in the window, for the TV's verifier (it reads every staff edit).
const first = await readPage(t, `/timelineAudits?limit=100`);
let lo = 1, hi = first.pageCount;
while (lo < hi) { const mid = Math.floor((lo + hi) / 2); const r = await readPage(t, `/timelineAudits?limit=100&page=${mid}`); const at = Date.parse(r.rows[0]?.created ?? ""); if (at < Date.parse(FROM)) lo = mid + 1; else hi = mid; }
const startId = Number((await readPage(t, `/timelineAudits?limit=100&page=${Math.max(1, lo - 1)}`)).rows[0]?.id ?? 0);
const rows: any[] = [];
for (const action of ["common_change", "common_create", "order_create", "order_confirm_provisional", "common_delete", "order_cancel", "order_created_via_api"]) {
  for (let p = 1; p <= 400; p++) {
    const r = await readPage(t, `/timelineAudits?action[eq]=${action}&id[gte]=${startId}&limit=100&page=${p}`);
    rows.push(...r.rows.filter((x) => Number(x.creator) !== BOT));
    if (r.rows.length < 100) break;
  }
}
save("timeline", rows.sort((a, b) => Number(a.id) - Number(b.id)));
