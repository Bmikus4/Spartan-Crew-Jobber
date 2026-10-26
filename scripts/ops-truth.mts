// What ops actually did for each client email: the ground truth the system is scored against.
// Read-only. Every staff booking action in OnSinch's timeline since FROM (an order created, a
// shift or position added, a size, time, profession, PO or cancel edit) is put on its order,
// and each order's actions are given to the latest email from that order's client before them
// (within 36 hours). An email with no staff action after it is "nothing to book".
//   npx tsx --env-file=.env.local scripts/ops-truth.mts [--from 2026-10-09T10:20:00Z] [--out .tmp-data/ops-truth.json]
import { readOnlySql, proveReadOnly } from "./_readonly.mts";
import { writeFileSync, mkdirSync } from "node:fs";
import { httpTransport } from "../app/lib/engine/onsinch";
import { onsinchWorld } from "../app/lib/v2/process";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg("--from", "2026-10-09T10:20:00Z");
const OUT = arg("--out", ".tmp-data/ops-truth.json");
const BOT = 2257;
const sql = readOnlySql();
console.log(`database read-only: ${(await proveReadOnly(sql)).slice(0, 80)}`);
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);

const emails = (await sql`SELECT d.message_id, d.company_id, d.company, d.kind, m.thread_id, m.subject, m.date_iso FROM v2_decisions d JOIN thread_messages m USING (message_id)
  WHERE coalesce(d.code_version,'') <> 'local' AND d.created_at > ${FROM} AND d.company_id IS NOT NULL ORDER BY m.date_iso`) as any[];

// Every order of every client that wrote, indexed by each of its ids.
const world = onsinchWorld();
const owner = new Map<string, { order_id: number; number: string; company_id: number }>();
const orderRec = new Map<number, any>();
for (const c of [...new Set(emails.map((e) => Number(e.company_id)))]) {
  for (const o of await world.companyOrders(c)) {
    const who = { order_id: Number(o.id), number: String(o.number), company_id: c };
    orderRec.set(Number(o.id), o);
    owner.set(`Order:${o.id}`, who);
    // An Order's own audit rows (cancel, copy, an edit of the Order) name it by its NUMBER; only
    // order_create names the id. Numbers and ids overlap: read as ids, 26 cancels and PO edits and a
    // copy were filed under another order, and the rest dropped (eval/item-correctness.md, 10-26).
    owner.set(`OrderNo:${o.number}`, who);
    for (const j of ([] as any[]).concat(o.Job ?? [])) {
      owner.set(`Job:${j.id}`, who);
      for (const tm of ([] as any[]).concat(j.SlotTeam ?? [])) {
        owner.set(`SlotTeam:${tm.id}`, who);
        for (const s of ([] as any[]).concat(tm.Slot ?? [])) owner.set(`Slot:${s.id}`, who);
      }
    }
  }
}

// The timeline back to FROM, newest page first.
let page = Number((await t("GET", "/timelineAudits?limit=100&page=1"))?.data?.pagination?.pageCount);
const audits: any[] = [];
for (; page > 0; page--) { const r = rowsOf(await t("GET", `/timelineAudits?limit=100&page=${page}`)); audits.push(...r); if (r.length && Date.parse(r[0].created) < Date.parse(FROM)) break; }

const BOOKING = /^Slot\.(size|beginning|end|profession_id|cancelled|role)$|^Order\.intern_name$/;
// The model, its id and the booking fields with their old and new values ride along: the strict
// scorer (app/lib/v2/score.ts) judges by value, not by which order was touched.
type Act = { at: string; by: number; what: string; order_id: number; number: string; company_id: number; model?: string; model_id?: number; changes?: Record<string, { old: unknown; new: unknown }> };
const acts: Act[] = [];
for (const a of audits) {
  if (Date.parse(a.created) < Date.parse(FROM)) continue;
  let d: any = {}; try { d = JSON.parse(a.data); } catch { continue; }
  let what = "";
  let key = "";
  let changes: Act["changes"];
  if (a.action === "order_create") { what = "create order"; key = `Order:${d.id}`; }
  else if (a.action === "order_create_by_copy") { what = "create order"; key = `OrderNo:${d.id}`; }
  else if (a.action === "order_cancel") { what = "cancel order"; key = `OrderNo:${d.id}`; }
  else if (a.action === "common_create" && /^(SlotTeam|Slot|Job)$/.test(d.model)) { what = `add ${d.model === "SlotTeam" ? "shift" : d.model === "Slot" ? "position" : "job"}`; key = String(d.data?.path ?? "").split("/")[0] || `${d.model}:${d.id}`; }
  else if (a.action === "common_change") {
    const fields = Object.entries(d.diffChanges ?? {}).flatMap(([m, f]) => Object.keys(f as any).map((k) => `${m}.${k}`)).filter((f) => BOOKING.test(f));
    if (!fields.length) continue;
    what = `edit ${[...new Set(fields)].sort().join("+")}`; key = d.model === "Order" ? `OrderNo:${d.id}` : `${d.model}:${d.id}`;
    changes = Object.fromEntries(fields.filter((f) => f.startsWith(`${d.model}.`)).map((f) => [f.split(".")[1], (d.diffChanges as any)[d.model][f.split(".")[1]]]));
  } else continue;
  const who = owner.get(key);
  if (!who) continue; // an order of a client that never wrote in the window
  acts.push({ at: a.created, by: Number(a.creator), what, ...who, model: String(d.model ?? ""), model_id: Number(d.id) || undefined, ...(changes ? { changes } : {}) });
}

// Each staff action goes to the latest email from that client before it, within 36 hours.
const truth = emails.map((e) => ({ id: e.message_id, at: e.date_iso, company_id: Number(e.company_id), company: e.company, subject: e.subject, thread_id: e.thread_id, staff: [] as Act[], bot: [] as Act[] }));
for (const a of acts.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
  const before = truth.filter((e) => e.company_id === a.company_id && Date.parse(e.at) <= Date.parse(a.at) && Date.parse(a.at) - Date.parse(e.at) <= 36 * 3600e3);
  const e = before[before.length - 1];
  if (!e) continue;
  (a.by === BOT ? e.bot : e.staff).push(a);
}
const label = (acts: Act[]) => (acts.some((a) => a.what === "create order") ? "create" : acts.length ? "update" : "none");
const out = truth.map((e) => ({ ...e, truth: label(e.staff.length ? e.staff : e.bot), created: [...new Set(e.staff.concat(e.bot).filter((a) => a.what === "create order").map((a) => `R${a.number}`))], touched: [...new Set(e.staff.concat(e.bot).map((a) => `R${a.number}`))] }));
mkdirSync(".tmp-data", { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
writeFileSync(OUT.replace(/\.json$/, "-acts.json"), JSON.stringify(acts, null, 1));
// The orders the acts touched, as read now: what a created order or an added shift holds.
writeFileSync(OUT.replace(/\.json$/, "-orders.json"), JSON.stringify([...new Set(acts.map((a) => a.order_id))].map((id) => orderRec.get(id)).filter(Boolean)));
const n = (k: string) => out.filter((o) => o.truth === k).length;
console.log(`emails ${out.length} since ${FROM}: ops created an order after ${n("create")}, updated an order after ${n("update")}, did nothing after ${n("none")}; staff actions placed ${acts.filter((a) => a.by !== BOT).length}, bot ${acts.filter((a) => a.by === BOT).length}`);
