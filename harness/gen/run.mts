// ============================================================================
// THE GENERATED BUSINESS: generated clients and jobs through the real intake, decision, minute sync, TV and
// labels code, on the fake OnSinch, with simulated staff (ADDENDUM §14).
// ----------------------------------------------------------------------------
//   input      harness/gen/cases.ts: n cases per category, seeded
//   through    app/lib/n8nInbound.ts handleInbound -> decideDelivery -> the reader -> grounding -> the planner;
//              the minute sync (/api/bot/sync) and the labels route after every event; the TV (serveFeed) at
//              each look. Settings as production's on 31 Oct: writes off, drafts only, the two-week rule on.
//   reader     --reader oracle (default, $0): the perfect reading written with the case; mutant: the same with every
//              date a day late; record: the perfect reading, with each email's reader input as production sends it
//              (system and user message) saved to <dir>/requests/qNNN.txt for an outside reader, the case of each in
//              <dir>/map.json; answers: <dir>/answers/qNNN.json as the reading (a Claude session, no OpenRouter).
//              --dir names that folder; --limit spreads that many cases evenly over the categories. The model runs wait on the owner's choice of OpenRouter key (ADDENDUM §14.10).
//   boundary   harness/sim: PGlite, the fake OnSinch, the simulated clock; every fetch intercepted.
//   output     .tmp-data/gen/<run>/results.json and report.md (harness/gen/score.ts)
//
//   npx tsx harness/gen/run.mts --cats A,E,K --n 5 [--seed 31102026] [--reader mutant|record|answers --dir d] [--limit 100] [--out dir]
//   (never with --env-file)
//   GEN_DEBUG=<case id> writes that case's decisions, orders, looks and stored history to .tmp-data/gen-debug-<id>.json
// ============================================================================
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { pg, os, net } = require("../sim/boot.ts").bootSim();

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const cats = arg("cats", "A,B,C,D,E,F,J,K,M").split(",");
const n = Number(arg("n", "5"));
const seed = Number(arg("seed", "31102026"));
// oracle: the case's own reading. mutant: the same with every date a day late, which grounding must refuse (no write).
const reader = arg("reader", "oracle");
const runId = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}-${cats.join("")}-${n}-${reader}`;

const { generate } = require("./cases.ts");
const { PLACES, PROFESSIONS, companyRow } = require("./world.ts");
const { score, report } = require("./score.ts");
const { TIMELINE_FROM_ID } = require("../../app/lib/v2/loop/truth.ts");
const { handleInbound } = require("../../app/lib/n8nInbound.ts");
const { POST: syncPOST } = require("../../app/api/bot/sync/route.ts");
const { POST: labelsPOST } = require("../../app/api/bot/labels/route.ts");
const { serveFeed } = require("../../app/lib/feed/serve.ts");
const { liveFeedDeps } = require("../../app/lib/feed/live.ts");
const sql = pg.neonShim();

const limit = Number(arg("limit", "0"));
// A limit keeps the first cases of each category, so the set stays in time order (the clock only moves forward).
const quota = (k: number) => Math.floor(limit / cats.length) + (k < limit % cats.length ? 1 : 0);
const cases = (generate(cats, n, seed) as any[]).filter((c) => !limit || Number(c.id.slice(1)) <= quota(cats.indexOf(c.category)));
const io = arg("dir", ".tmp-data/gen/reader");
const qid = new Map<string, string>();
if (reader === "record") { mkdirSync(`${io}/requests`, { recursive: true }); mkdirSync(`${io}/answers`, { recursive: true }); }
const recorded = reader === "answers" ? new Map(Object.entries(JSON.parse(readFileSync(`${io}/map.json`, "utf8")) as Record<string, string>).map(([q, id]) => [id, q])) : null;
os.store.auditFloor = TIMELINE_FROM_ID;

// The perfect reader: each email's reading as the case wrote it.
const oracle = new Map<string, any>();
const late = (x: any): any => Array.isArray(x) ? x.map(late) : x && typeof x === "object"
  ? Object.fromEntries(Object.entries(x).map(([k, v]: [string, any]) => [k, k === "date" && v && typeof v.value === "string" ? { ...v, value: new Date(Date.parse(`${v.value}T12:00:00Z`) + 864e5).toISOString().slice(0, 10) } : late(v)]))
  : x;
net.answerModel(async (id: string | null, request: any) => {
  if (!id || !oracle.has(id)) return null;
  if (reader === "answers") {
    const q = recorded!.get(id), f = `${io}/answers/${q}.json`;
    if (!q || !existsSync(f)) return null;
    try { return { extraction: JSON.parse(readFileSync(f, "utf8").replace(/^```(?:json)?\s*|\s*```\s*$/g, "")), model: "claude session" }; } catch { return null; }
  }
  if (reader === "record") {
    const q = `q${String(qid.size + 1).padStart(3, "0")}`;
    qid.set(q, id);
    const msgs = (request?.messages ?? []) as Array<{ role: string; content: string }>;
    if (qid.size === 1) writeFileSync(`${io}/system.txt`, msgs.find((m) => m.role === "system")?.content ?? "");
    writeFileSync(`${io}/requests/${q}.txt`, msgs.find((m) => m.role === "user")?.content ?? "");
  }
  return { extraction: reader === "mutant" ? late(oracle.get(id)) : oracle.get(id), model: reader };
});

pg.clock.set(cases[0].t0 - 3600e3);
await pg.syncSqlClock();
await sql`CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
await sql`INSERT INTO app_settings (id, value) VALUES ('singleton', ${JSON.stringify({ order_mode: "draft-only", reply_scope: "all", intake_paused: false, reply_delivery: "draft", replies_enabled: false,
  create_lead_days: 14, tv_show_unlinked: false, default_rate_card: 315, bot_writes_enabled: false, jobs_board_enabled: false, create_lead_enabled: true, test_data_autoclear: false,
  analytics_tab_enabled: false, create_lead_applies_to: "creates" })}::jsonb) ON CONFLICT (id) DO NOTHING`;

const machine = (path: string, body: unknown) => new Request(`https://sim${path}`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "sim-secret" }, body: JSON.stringify(body) });
const syncErrors: string[] = [];
async function tick(): Promise<void> {
  await pg.syncSqlClock();
  const s = await (await syncPOST(machine("/api/bot/sync", {}))).json().catch(() => ({}));
  if (s && s.ok === false) syncErrors.push(JSON.stringify(s).slice(0, 300));
  await labelsPOST(machine("/api/bot/labels", { mode: "live" }));
}
async function look(thread: string): Promise<any> {
  const tv = await serveFeed({ ...liveFeedDeps(), jobs: undefined, remember: undefined }, pg.clock.now());
  const shown = ((tv.body.items ?? []) as any[]).find((c) => c.thread_id === thread) ?? null;
  const any = ((tv.all ?? []) as any[]).find((c) => c.thread_id === thread) ?? null;
  return { status: tv.status, history_at: tv.body?.health?.history_at ?? null, shown, any };
}

const results: any[] = [];
const t0 = performance.now();
// Each case on an empty world: the app's tables emptied (their schema kept), OnSinch holding only this client.
// Sharing one world, earlier cases' open cards took the sync's five client reads a run (truth.ts CLIENTS_PER_RUN)
// whenever the harness ticked only at events, and E006 never saw its own client's orders. Production ticks every
// minute, so that starvation was the harness's, not the business's.
const KEEP = new Set(["sim_clock", "schema_migrations", "app_settings"]);
async function emptyWorld(c: any): Promise<void> {
  const tables = ((await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`) as any[]).map((r) => r.tablename).filter((t: string) => !KEEP.has(t));
  if (tables.length) await sql.query(`TRUNCATE ${tables.map((t: string) => `"${t}"`).join(", ")}`);
  os.seedWith({ orders: [], companies: [companyRow(c.client)], places: PLACES.map((p: any) => ({ id: p.id, name: p.name, address: p.address })), professions: PROFESSIONS, timeline: [] });
}

for (const c of cases) {
  const thread = `gen-${c.id}`;
  await emptyWorld(c);
  const orders: any[] = [];
  pg.clock.set(c.t0 - 2 * 864e5);
  await pg.syncSqlClock();
  const staff = require("./staff.ts");
  for (const o of c.orders) orders.push(staff.createOrder(c.client, o.calls, o.by, o.po ?? null, o.number));
  pg.clock.set(c.t0 - 5 * 60e3);
  await tick();
  type Ev = { at: number; kind: "email" | "staff" | "look"; x: any };
  const evs: Ev[] = [...c.emails.map((x: any) => ({ at: x.at, kind: "email" as const, x })), ...c.staff.map((x: any) => ({ at: x.at, kind: "staff" as const, x })), ...c.looks.map((x: any) => ({ at: x.at, kind: "look" as const, x }))]
    .sort((a, b) => a.at - b.at || (a.kind === "look" ? 1 : 0) - (b.kind === "look" ? 1 : 0));
  const seen: any[] = [];
  let k = 0;
  for (const e of evs) {
    pg.clock.set(c.t0 + e.at);
    await pg.syncSqlClock();
    if (e.kind === "email") {
      const id = `${thread}-m${++k}`;
      oracle.set(id, e.x.oracle);
      const res = await handleInbound(new Request("https://sim/api/n8n-inbound", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: thread, messages: [{ message_id: id, from: e.x.from, to: ["bookings@spartancrew.co.uk"], date_iso: new Date(c.t0 + e.at).toISOString(), subject: e.x.subject, body: e.x.body }] }) }));
      seen.push({ kind: "email", ok: (await res.json().catch(() => ({}))).ok === true });
      pg.clock.set(c.t0 + e.at + 60e3);
      await tick();
    } else if (e.kind === "staff") {
      e.x.act(orders);
      pg.clock.set(c.t0 + e.at + 60e3);
      await tick();
    } else {
      await tick();
      seen.push({ kind: "look", label: e.x.label, ...(await look(thread)) });
    }
  }
  const decisions = await sql`SELECT message_id, kind, decision, interpretation->'grounded' AS grounded FROM v2_decisions WHERE thread_id = ${thread} ORDER BY sent_at`;
  const stored = await sql`SELECT count(*)::int AS n FROM thread_messages WHERE thread_id = ${thread}`;
  results.push(score(c, { decisions, stored: stored[0].n, seen }));
  if (process.env.GEN_DEBUG === c.id) writeFileSync(`.tmp-data/gen-debug-${c.id}.json`, JSON.stringify({ decisions: await sql`SELECT kind, decision, interpretation FROM v2_decisions WHERE thread_id = ${thread}`, orders: orders.map((o) => ({ id: o.id, company_id: o.company_id, status: o.status, slots: o.Job[0].SlotTeam.flatMap((t: any) => t.Slot.map((s: any) => [s.beginning, s.size, s.SlotLocation])) })), emails: c.emails, seen, marks: await sql`SELECT item_key, mark, evidence FROM feed_marks WHERE thread_id = ${thread}`, timeline: await sql`SELECT id, action, creator, created, model, model_id, order_id, part FROM onsinch_timeline WHERE created > ${new Date(c.t0 - 3 * 864e5).toISOString()}::timestamptz ORDER BY id`, contacts: await sql`SELECT email, company_id FROM onsinch_contacts WHERE email = ${c.sender}`, stored: await sql`SELECT order_id, company_id, number, read_at, deleted_at FROM onsinch_orders WHERE company_id = ${c.client.id}` }, null, 1));
  if (results.length % 10 === 0) console.log(`${results.length}/${cases.length} cases, ${Math.round((performance.now() - t0) / 1000)}s`);
}

const dir = arg("out", `.tmp-data/gen/${runId}`);
mkdirSync(dir, { recursive: true });
if (reader === "record") writeFileSync(`${io}/map.json`, JSON.stringify(Object.fromEntries(qid), null, 1));
writeFileSync(`${dir}/results.json`, JSON.stringify({ cats, n, seed, reader, syncErrors, network_refused: [...new Set(net.net.refused)], results }, null, 1));
const md = report(results, { cats, n, seed, reader, seconds: Math.round((performance.now() - t0) / 1000), syncErrors: syncErrors.length });
writeFileSync(`${dir}/report.md`, md);
console.log(md);
process.exit(0);
