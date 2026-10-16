// ============================================================================
// THE EFFECT BEN MEASURES THE OFFER BY (10-15): the share of the bot's orders staff take as
// they are. Read from OnSinch, never from our own record of what we did.
// ----------------------------------------------------------------------------
// Every order the bot created for a real client since --since (default 2026-10-12), from the
// decisions that verified a create, is one of:
//   adopted     workers assigned or confirmed on it (attendance status 0, 1 or 3)
//   re-keyed    staff made another order for the same client and day within 2 hours after it
//   deleted     no longer in OnSinch
//   waiting     none of those yet
// request_approval cannot tell: it never clears (#16607 was worked and still reads 1).
//
//   npx tsx --env-file=.env.local scripts/adoption.mts [--since 2026-10-12] [--gate]
// --gate writes .tmp-data/gate-measurements.json for the session gate to fold into its ticket.
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { httpTransport } from "../app/lib/engine/onsinch";
import { readRows } from "../app/lib/v2/read";
import { isTestSender, isTestId } from "../app/lib/testData";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const SINCE = arg("--since") ?? "2026-10-12";
const GATE = process.argv.includes("--gate");
const sql = neon((process.env.DATABASE_URL || "").trim());
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
const TEST = 515;
const ON = new Set([0, 1, 3]);

const made = (await sql`
  SELECT DISTINCT (e->'detail'->>'order_id')::bigint AS order_id, d.company_id, d.thread_id, d.message_id, d.from_address
    FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.executed) = 'array' THEN d.executed ELSE '[]'::jsonb END) e
   WHERE d.created_at >= ${SINCE} AND e->>'status' = 'verified' AND (e->'detail'->>'order_id') ~ '^[0-9]+$'
     AND d.decision->'ops'->0->'op'->>'kind' = 'create_order' AND coalesce(d.code_version, '') <> 'local'`) as any[];

const days = (o: any) => [...new Set(([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => [].concat(j.SlotTeam ?? [])).flatMap((s: any) => [].concat(s.Slot ?? [])).map((s: any) => String(s.beginning).slice(0, 10)))];
const rows: any[] = [];
for (const m of made) {
  if (Number(m.company_id) === TEST || isTestSender(m.from_address) || isTestId(m.message_id) || isTestId(m.thread_id)) continue;
  const o = (await readRows(t, `/orders?id[eq]=${m.order_id}&with=Job__SlotTeam__Slot`))[0];
  if (!o) {
    // Gone. If the thread is now linked to another order of the client's, staff keyed their own
    // and the bot's copy was deleted as a duplicate: that is a re-key, not a deletion.
    const now = (await sql`SELECT r_number FROM job_links WHERE thread_id = ${m.thread_id} AND order_id <> ${Number(m.order_id)} AND state IN ('linked', 'relinked')`) as any[];
    rows.push({ order_id: Number(m.order_id), company_id: m.company_id, state: now.length ? "re-keyed" : "deleted", twin: now.length ? `R${now[0].r_number}` : null });
    continue;
  }
  if (/safe to delete|canary/i.test(`${o.name ?? ""} ${o.Job?.[0]?.name ?? ""}`)) continue;
  const att = await readRows(t, `/attendance?with=Order&Order__id=${o.id}&limit=200`);
  const workers = att.filter((a: any) => ON.has(Number(a.status))).length;
  const mine = days(o);
  const sibs = await readRows(t, `/orders?company_id[eq]=${o.company_id}&with=Job__SlotTeam__Slot&limit=30`);
  const twin = sibs.find((x: any) => Number(x.id) !== Number(o.id) && Number(x.creator) !== 2257 && Date.parse(x.created) >= Date.parse(o.created) && Date.parse(x.created) - Date.parse(o.created) <= 2 * 3600e3 && days(x).some((d) => mine.includes(d)));
  const state = workers ? "adopted" : twin ? "re-keyed" : "waiting";
  rows.push({ order_id: Number(o.id), number: o.number, company_id: o.company_id, created: o.created, workers, twin: twin ? `R${twin.number}` : null, state });
}
const count = (s: string) => rows.filter((r) => r.state === s).length;
const decided = count("adopted") + count("re-keyed") + count("deleted");
const summary = { since: SINCE, orders: rows.length, adopted: count("adopted"), rekeyed: count("re-keyed"), deleted: count("deleted"), waiting: count("waiting"), adoption_rate: decided ? Math.round((count("adopted") / decided) * 1000) / 10 : null };
for (const r of rows) console.log(`${r.number ? `R${r.number}` : r.order_id}  ${r.state}${r.twin ? ` (staff ${r.twin})` : ""}${r.workers ? ` ${r.workers} workers` : ""}`);
console.log(JSON.stringify(summary));
if (GATE) {
  mkdirSync(".tmp-data", { recursive: true });
  const f = ".tmp-data/gate-measurements.json";
  const prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  writeFileSync(f, JSON.stringify({ ...prev, adoption: summary }, null, 2));
}
