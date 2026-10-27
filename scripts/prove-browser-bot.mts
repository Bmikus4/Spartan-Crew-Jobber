// ============================================================================
// PROOF THAT THE BROWSER BOT WRITES THE ORDERS, from OnSinch's own log, not ours.
// ----------------------------------------------------------------------------
// OnSinch's timeline records every edit made in the staff screens, field by field, and none
// made through the API (0 of 2,901 rows in 32 hours, verify.ts). So a common_change or
// common_create row whose creator is 2257 (the bot's login) on the field and node an operation
// changed can only have come from the bot driving the browser. An order made by the API shows
// as order_created_via_api instead, and the harness says which is which.
//
// The steps run the production planner (plan.ts) and the production writer (run.ts runOp) on
// TEST - Eventz (515) only, in bench mode, at a date in 2027. No model call: each step's
// reading is written out, as a reader would give it. The TEST order is deleted at the end.
//
//   npx tsx --env-file=.env.local scripts/prove-browser-bot.mts [--keep]
// Writes .tmp-data/browser-proof.json (the evidence, step by step) and prints the table.
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { httpTransport } from "../app/lib/onsinch/onsinch";
import { plan, type World } from "../app/lib/v2/interpret/plan";
import type { Interpretation, Request } from "../app/lib/v2/interpret/interpret";
import { onsinchWorld } from "../app/lib/v2/process";
import { runOp, type RunResult } from "../app/lib/v2/bot/run";
import { readPage } from "../app/lib/v2/read";

const KEEP = process.argv.includes("--keep");
const BOT = 2257;
const TEST = 515;
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
const get = async (path: string) => { const r = await t("GET", path); if (r.status >= 400) throw new Error(`${path} -> ${r.status}`); return r.data; };

// The world, narrowed to the TEST company: the sender's domain finds it, nothing else is visible.
const live = onsinchWorld();
const world: World = {
  ...live,
  companies: async () => (await live.companies()).filter((c: any) => Number(c.id) === TEST).map((c: any) => ({ ...c, Client: [{ id: 1591, email: "bench@test-eventz.co.uk" }] })),
};
const FROM = "bench@test-eventz.co.uk";
const DAY = "2027-11-17";
const NEXT = "2027-11-18";

async function newestAuditId(): Promise<number> {
  const first = await readPage(t, `/timelineAudits?limit=100`);
  const last = first.pageCount > 1 ? await readPage(t, `/timelineAudits?limit=100&page=${first.pageCount}`) : first;
  return last.rows.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
}
/** Every timeline row after the cursor, oldest first. */
async function auditSince(cursor: number): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await get(`/timelineAudits?id[gt]=${cursor}&limit=100&page=${page}`);
    out.push(...(r?.data ?? []));
    if ((r?.data ?? []).length < 100) break;
  }
  return out;
}
const parse = (x: any) => { try { return typeof x.data === "string" ? JSON.parse(x.data) : x.data; } catch { return {}; } };

type Step = { name: string; email: string; requests: Request[]; intent?: Interpretation["intent"] };
const r = (x: Partial<Request>): Request => ({ action: "new_shift", problems: [], ...x });
const msg = (n: number, text: string) => ({ message_id: `proof-${Date.now()}-${n}`, from: FROM, subject: "Proof: browser bot", sentIso: new Date().toISOString(), text });

const evidence: any[] = [];
let orderId = 0;
let orderNumber = "";
async function step(n: number, s: Step) {
  const i: Interpretation = { intent: s.intent ?? (n === 0 ? "booking" : "change"), requests: s.requests, problems: [] };
  const d = await plan(msg(n, s.email), i, world, orderId || null);
  if (d.kind !== "write") { evidence.push({ step: s.name, email: s.email, planned: d, ok: false }); console.log(`${s.name}: planned ${d.kind} ${JSON.stringify(d).slice(0, 200)}`); return; }
  const cursor = await newestAuditId();
  const results: RunResult[] = [];
  for (const { source, op } of d.ops) {
    const res = await runOp(`proof:${source}`, op, { testOnly: true });
    results.push(res);
    if (!orderId && Number((res.detail as any)?.order_id)) { orderId = Number((res.detail as any).order_id); orderNumber = String((res.detail as any).number ?? ""); }
    if (res.status !== "verified") break;
  }
  const rows = (await auditSince(cursor)).filter((x) => Number(x.creator) === BOT);
  const seen = rows.map((x) => { const p = parse(x); const diff = p?.diffChanges ? Object.entries(p.diffChanges).flatMap(([m, f]: any) => Object.entries(f).map(([k, v]: any) => `${m}.${k} ${v?.old ?? ""} -> ${v?.new ?? ""}`)) : []; return { id: Number(x.id), action: x.action, model: p?.model ?? null, node: p?.id ?? null, at: x.created, fields: diff }; });
  const browserRows = seen.filter((x) => x.action === "common_change" || x.action === "common_create");
  const apiRows = seen.filter((x) => /via_api/.test(x.action));
  const allVerified = results.length === d.ops.length && results.every((x) => x.status === "verified");
  evidence.push({ step: s.name, email: s.email, ops: d.ops.map((o) => o.op.kind), why: d.why, results: results.map((x) => ({ status: x.status, reasons: x.reasons })), browser_rows: browserRows, api_rows: apiRows, ok: allVerified && (browserRows.length > 0 || apiRows.length > 0) });
  console.log(`\n${s.name}  [${allVerified ? "verified" : results.map((x) => x.status).join(",")}]`);
  console.log(`  ops: ${d.ops.map((o) => o.op.kind).join(", ")}`);
  for (const b of browserRows) console.log(`  browser (2257, ${b.action}): ${b.model} ${b.node}  ${b.fields.slice(0, 4).join("; ")}`);
  for (const a of apiRows) console.log(`  api (2257, ${a.action}): ${a.model ?? ""} ${a.node ?? ""}`);
}

const steps: Step[] = [
  { name: "1. New booking, 12 crew", email: `Please book 12 crew on 17/11/2027 08:00-16:00 at Spartan Crew Unit 7`, requests: [r({ date: DAY, start: "08:00", end: "16:00", crew: 12, venue: "Spartan Crew Unit 7", place_id: 5 })], intent: "booking" },
  { name: "2. Make it 25 (chiefs 2 -> 3)", email: `Can we make the 17th 25 crew please`, requests: [r({ action: "change_crew", date: DAY, crew: 25 })] },
  { name: "3. Arrive an hour earlier", email: `Can the crew arrive for 07:00 instead of 08:00 on the 17th`, requests: [r({ action: "change_times", date: DAY, start: "07:00" })] },
  { name: "4. Add a carpenter", email: `Please add a carpenter on the 17th`, requests: [r({ action: "change_crew", date: DAY, crew_add: 1, trade: "carpenter" })] },
  { name: "5. Add a shift the next day", email: `Please add 4 crew on 18/11/2027 09:00-13:00 too`, requests: [r({ date: NEXT, start: "09:00", end: "13:00", crew: 4, order_id: 0 as any })] },
  { name: "6. Drop the 17th to 3", email: `Sorry, the 17th is now just 3 crew`, requests: [r({ action: "change_crew", date: DAY, crew: 3 })] },
];

for (const [n, s] of steps.entries()) {
  if (n === 4) s.requests = s.requests.map((q) => ({ ...q, order_id: orderId }));
  await step(n, s);
  if (n === 0 && !orderId) { console.log("no order was made; stopping"); break; }
}

if (orderId && !KEEP) {
  const o = (await get(`/orders?id[eq]=${orderId}`))?.data?.[0];
  if (o && Number(o.company_id) === TEST && Number(o.creator) === BOT) { const d = await t("DELETE", "/orders", [orderId]); console.log(`\ndeleted TEST order R${orderNumber} (${orderId}): ${d.status}`); }
}
mkdirSync(".tmp-data", { recursive: true });
writeFileSync(".tmp-data/browser-proof.json", JSON.stringify({ at: new Date().toISOString(), order: { id: orderId, number: orderNumber }, steps: evidence }, null, 2));
const passed = evidence.filter((e) => e.ok).length;
console.log(`\n${passed} of ${evidence.length} steps written and proven by OnSinch's own log`);
process.exit(passed === evidence.length ? 0 : 1);
