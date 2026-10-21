// ============================================================================
// THE SIMULATOR: the real intake, decision, writer, sync, TV and labels code, fed every email
// that reached Spartan since the rebuild went live, in the shape and order it arrived. $0.
// ----------------------------------------------------------------------------
//   input      .tmp-data/sim/payloads.json: n8n's deliveries, verbatim (snapshot.mts)
//   through    app/lib/n8nInbound.ts handleInbound -> decideDelivery -> processMessage ->
//              decideMessage (reading = the stored one) -> plan -> runOp (simulated browser)
//              -> links; between deliveries the minute sync (/api/bot/sync) and the TV's own
//              refresh (serveFeed, verifier included), as production runs them
//   boundary   database = PGlite (pg.ts), OnSinch = the snapshot in time (onsinch.ts),
//              browser = bot.ts, network = net.ts. Nothing reaches production: the process is
//              started without production credentials and every fetch is intercepted.
//   output     .tmp-data/sim/result.json: the TV at the end, every card's R/J numbers, and the
//              run's own counts; .tmp-data/sim/end.json: the end moment and the TV every simulated
//              hour, which harness/sim/onepass.mts scores
//
//   npx tsx --env-file=.env.local harness/sim/snapshot.mts && npx tsx --env-file=.env.local harness/sim/supplement.mts
//   npx tsx harness/sim/run.mts            (never with --env-file: production credentials refused)
//   npx tsx harness/sim/onepass.mts [--series] [--thread <id>]
// ============================================================================
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

// One run at a time: two share result.json and the output file, and their lines interleave
// into a log that reads as one run (10-16: a stale run's bigint errors read as the new run's).
const LOCK = ".tmp-data/sim/run.lock";
try { const pid = Number(readFileSync(LOCK, "utf8")); process.kill(pid, 0); console.error(`refusing to run: run ${pid} is still going`); process.exit(2); } catch { /* no live run */ }
writeFileSync(LOCK, String(process.pid));
process.on("exit", () => { try { unlinkSync(LOCK); } catch { /* gone */ } });

for (const k of ["DATABASE_URL", "POSTGRES_URL", "ONSINCH_API_KEY", "OPENROUTER_API_KEY", "N8N_API_KEY", "BOT_SECRET"]) {
  if (process.env[k] && !/^sim/.test(process.env[k]!)) { console.error(`refusing to run: ${k} is set in this process (start without --env-file)`); process.exit(2); }
}
Object.assign(process.env, {
  SPARTAN_ENGINE: "v2", SPARTAN_WRITES: "live", DATABASE_URL: "sim://pglite", ONSINCH_BASE_URL: "https://spartancrew.onsinch.com/api/v1", ONSINCH_API_KEY: "sim",
  OPENROUTER_API_KEY: "sim", N8N_WEBHOOK_SECRET: "sim-secret", BOT_SECRET: "sim", SPARTAN_INTERPRET_MODEL: "recorded",
  // Not "local": the TV hides a workstation's decisions, and every simulated one would vanish.
  VERCEL_GIT_COMMIT_SHA: "sim",
});
delete process.env.VERCEL; delete process.env.SPARTAN_ERROR_NOTIFY;

const require = createRequire(import.meta.url);
const pg = require("./pg.ts");
const os = require("./onsinch.ts");
const net = require("./net.ts");
const bot = require("./bot.ts");
pg.installDate();
net.installFetch();
// The two modules that would reach out: the database driver and the browser bot.
const stub = (path: string, exports: unknown) => { require.cache[path] = { id: path, filename: path, loaded: true, exports, children: [], paths: [] } as any; };
stub(require.resolve("@neondatabase/serverless"), { neon: pg.neonShim, neonConfig: {}, Pool: class {}, Client: class {} });
stub(resolve("app/lib/v2/bot/run.ts"), bot);

const load = (n: string) => JSON.parse(readFileSync(`.tmp-data/sim/${n}.json`, "utf8"));
const meta = load("meta");
os.seed();

const { handleInbound } = require("../../app/lib/n8nInbound.ts");
const { POST: syncPOST } = require("../../app/api/bot/sync/route.ts");
const { POST: labelsPOST } = require("../../app/api/bot/labels/route.ts");
const { serveFeed } = require("../../app/lib/feed/serve.ts");
const { liveFeedDeps } = require("../../app/lib/feed/live.ts");
const { addMark } = require("../../app/lib/feed/marksDb.ts");
const sql = pg.neonShim();

// Production's settings and the paused engine's threads, as they stood.
pg.clock.set(Date.parse(meta.from) - 60_000);
await pg.syncSqlClock();
for (const s of load("settings")) {
  await sql`CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`INSERT INTO app_settings (id, value) VALUES (${s.id}, ${JSON.stringify(s.value)}::jsonb) ON CONFLICT (id) DO NOTHING`;
}
await sql`CREATE TABLE IF NOT EXISTS conversation_state (thread_id TEXT PRIMARY KEY, status TEXT, needs_human BOOLEAN, onsinch_order_id BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), state JSONB NOT NULL)`;
await sql`ALTER TABLE conversation_state ADD COLUMN IF NOT EXISTS swept_at TIMESTAMPTZ`;
for (const s of load("states")) await sql`INSERT INTO conversation_state (thread_id, status, needs_human, onsinch_order_id, updated_at, state, swept_at) VALUES (${s.thread_id}, ${s.status}, ${s.needs_human}, ${s.onsinch_order_id}, ${s.updated_at}, ${JSON.stringify(s.state)}::jsonb, ${s.swept_at}) ON CONFLICT DO NOTHING`;

const marks = (load("marks") as any[]).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
let markAt = 0;
const machine = (path: string, body: unknown) => new Request(`https://sim${path}`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "sim-secret" }, body: JSON.stringify(body) });
const gmail = new Map<string, Set<string>>();
let lastMinute = 0;
const timeline: any[] = [];

async function minute(): Promise<void> {
  await pg.syncSqlClock();
  // People's ticks on the TV, when they made them.
  while (markAt < marks.length && Date.parse(marks[markAt].at) <= pg.clock.now()) { const m = marks[markAt++]; await addMark({ item_key: m.item_key, thread_id: m.thread_id, mark: m.mark, by: m.by, evidence: m.evidence, at: Date.parse(m.at) }).catch(() => {}); }
  const s = await syncPOST(machine("/api/bot/sync", {}));
  const l = await (await labelsPOST(machine("/api/bot/labels", { mode: "live" }))).json();
  for (const t of l.threads ?? []) { const set = gmail.get(t.thread_id) ?? new Set(); for (const r of t.remove) set.delete(r); for (const a of t.add) set.add(a); gmail.set(t.thread_id, set); }
  // The TV page polls the feed, which runs the verifier.
  await serveFeed(liveFeedDeps(), pg.clock.now());
  void s;
}

// Each delivery as n8n sent it: its envelope, its thread, and the messages it carried.
const bodies = new Map((load("messages") as any[]).map((m) => [String(m.message_id), m]));
const payloadOf = (p: any) => ({
  ...(p.envelope ?? {}), thread_id: p.thread_id,
  messages: ((p.message_ids ?? []) as string[]).map((id) => bodies.get(String(id))).filter(Boolean).map((m: any) => ({
    message_id: m.message_id, from: m.from_address, to: m.to_addresses ?? [], date_iso: m.date_iso, subject: m.subject, body: m.body,
    ...(m.rfc_message_id ? { rfc_message_id: m.rfc_message_id } : {}), ...(m.in_reply_to ? { in_reply_to: m.in_reply_to } : {}),
  })),
});
const payloads = load("payloads") as any[];
const t0 = performance.now();
let n = 0, failed = 0;
// The TV every simulated hour, as its screen showed it (onepass.mts --series reads them): the
// open cards with their R and J, and the links at that moment.
const frames: any[] = [];
let nextHour = Math.ceil(Date.parse(meta.from) / 3600_000) * 3600_000;
async function frame(): Promise<void> {
  const f = await serveFeed({ ...liveFeedDeps(), jobs: undefined }, pg.clock.now());
  const open = ((f.body.items ?? []) as any[]).filter((c) => !c.green).map((c) => ({ thread_id: c.thread_id, kinds: c.items.map((i: any) => i.kind), need: (c.items.find((i: any) => /^needs-(created|updated)$/.test(i.kind) && !i.green) ?? null) && { kind: c.items.find((i: any) => /^needs-(created|updated)$/.test(i.kind) && !i.green).kind, at: c.items.find((i: any) => /^needs-(created|updated)$/.test(i.kind) && !i.green).at }, r: c.r_number ?? null, j: c.j_number ?? null, company: c.company, subject: c.subject }));
  frames.push({ at: pg.clock.iso(), open, links: await sql`SELECT thread_id, order_id, state FROM job_links` });
}
for (const p of payloads) {
  const at = Date.parse(p.received_at);
  while (nextHour <= at) { pg.clock.set(nextHour); await minute(); await frame(); lastMinute = nextHour; nextHour += 3600_000; }
  if (at - lastMinute >= 60_000) { pg.clock.set(at - 1); await minute(); lastMinute = at; }
  pg.clock.set(at);
  await pg.syncSqlClock();
  const res = await handleInbound(new Request("https://sim/api/n8n-inbound", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payloadOf(p)) }));
  const j = await res.json().catch(() => ({}));
  if (!j.ok) failed++;
  timeline.push({ at: p.received_at, thread: p.thread_id, ok: !!j.ok, decided: j.decided ?? null, error: j.error ?? null });
  if (++n % 100 === 0) console.log(`${n}/${payloads.length} deliveries, ${bot.ran.length} bot operations, ${failed} intake failures`);
}
// The end: the snapshot's moment, after one more sync and refresh.
pg.clock.set(Date.parse(meta.taken_at));
await minute();
const feed = await serveFeed({ ...liveFeedDeps(), jobs: undefined }, pg.clock.now());

// The end moment, for harness/sim/onepass.mts: the orders the simulated bot made or removed,
// the links and readings the run stored, and every card the TV held.
const endState = {
  at: pg.clock.iso(),
  // Orders the bot made, and staff orders as the bot's edits left them.
  bot_orders: [...os.store.orders.values()].filter((o: any) => (Number(o.creator) === 2257 && Date.parse(o.created) >= Date.parse(meta.from))
    || bot.ran.some((r: any) => Number(r.op.order_id ?? r.result.detail?.order_id) === Number(o.id))),
  deleted: [...os.store.deleted],
  sim_timeline: (os.store.timeline as any[]).filter((x) => x.sim),
  links: await sql`SELECT thread_id, order_id, r_number, job_id, state, source, first_seen FROM job_links`,
  grounded: await sql`SELECT thread_id, message_id, created_at::text AS created_at, interpretation->'grounded'->'requests' AS requests FROM v2_decisions WHERE interpretation->'grounded' IS NOT NULL`,
  frames,
  cards: feed.all,
};
writeFileSync(".tmp-data/sim/end.json", JSON.stringify(endState));

const slim = (c: any) => ({ thread_id: c.thread_id, kinds: c.items.map((i: any) => i.kind), green: c.green, r: c.r_number, j: c.j_number, company: c.company, subject: c.subject, note: c.note, dates: c.dates });
const items = (feed.body.items as any[]).map(slim), every = (feed.all ?? []).map(slim);
const open = items.filter((c) => !c.green);
const simDecisions = await sql`SELECT message_id, thread_id, sent_at::text AS sent_at, kind, decision, executed, company_id, company, interpretation->'grounded' AS grounded FROM v2_decisions`;
const simLinks = await sql`SELECT thread_id, order_id, r_number, job_id, state, source FROM job_links`;
const result = {
  window: { from: meta.from, to: meta.taken_at }, deliveries: payloads.length, intake_failures: failed,
  model_calls_answered_from_storage: net.net.model, model_calls_with_no_stored_reading: net.net.modelMissing.length,
  network_refused: [...new Set(net.net.refused)], webhooks: net.net.webhooks.length,
  bot_operations: bot.ran.length, bot_by_status: bot.ran.reduce((a: any, r: any) => ((a[r.result.status] = (a[r.result.status] ?? 0) + 1), a), {}),
  bot_by_kind: bot.ran.reduce((a: any, r: any) => ((a[r.op.kind] = (a[r.op.kind] ?? 0) + 1), a), {}),
  tv: { needs_action_open: open.length, with_R_and_J: open.filter((c) => c.r && c.j).length, with_R_only: open.filter((c) => c.r && !c.j).length, with_neither: open.filter((c) => !c.r && !c.j).length, everything: every.length, counts: feed.body.counts },
  gmail_labelled_threads: [...gmail.values()].filter((s) => s.size).length,
  onsinch_calls: Object.fromEntries(os.calls), seconds: Math.round((performance.now() - t0) / 1000),
  open, everything: every, intake: timeline, decisions: simDecisions, links: simLinks, ran: bot.ran,
};
writeFileSync(".tmp-data/sim/result.json", JSON.stringify(result, null, 2));
const { open: _o, everything: _e, intake: _i, decisions: _d, links: _l, ran: _r, ...head } = result;
console.log(JSON.stringify(head, null, 1));
process.exit(0);
