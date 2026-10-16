// ============================================================================
// THE VERCEL BROWSER BOT, 50 NEW JOBS AND 50 UPDATES, NO AI (Ben, 2026-10-16).
// ----------------------------------------------------------------------------
// Each job is planned by the production planner (plan.ts) from a reading written out here, as
// a reader would give it, so no model is called. Every operation it plans is sent to the
// DEPLOYED bot (POST /api/bot/run, which writes only on TEST - Eventz, 515) and the bot drives
// OnSinch's staff screens from Vercel. Each job is created, then changed once, then read back.
//
// Proof is OnSinch's, not ours:
//   - the bot's own verdict per operation (read back through the API + the save's audit row)
//   - the order as OnSinch holds it after the update, read here
//   - the timeline: every staff-screen edit is logged field by field and the API's never are,
//     so common_create / common_change rows by user 2257 on the job's nodes are the browser
// Jobs are created and updated back to back: the 15-minute test sweep clears TEST orders older
// than 30 minutes, and the timeline keeps the bot's rows after an order is gone. Whatever the
// sweep has not cleared is deleted at the end (TEST orders made by 2257 only).
//
//   npx tsx --env-file=.env.local scripts/vercel-bot-100.mts [--jobs 50] [--gap 8]
// Progress: .tmp-data/vercel-bot-100.jsonl (one line per job). Result: .tmp-data/vercel-bot-100.json
// ============================================================================
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { httpTransport } from "../app/lib/engine/onsinch";
import { plan, type World } from "../app/lib/v2/interpret/plan";
import type { Interpretation, Request } from "../app/lib/v2/interpret/interpret";
import { onsinchWorld } from "../app/lib/v2/process";
import { readPage, readRows } from "../app/lib/v2/read";
import type { Op } from "../app/lib/v2/bot/ops";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const JOBS = Number(arg("--jobs", "50"));
const GAP_MS = Number(arg("--gap", "8")) * 1000;
const APP = (process.env.SPARTAN_APP_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const BOT = 2257, TEST = 515, PLACE = 5;
const RUN = `v100-${Date.now().toString(36)}`;
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
mkdirSync(".tmp-data", { recursive: true });
// ONE RUN AT A TIME. Stopping the shell on 10-16 left the node process running, and a second
// run started beside it: the two fought for the bot ("busy") and wrote into one log, and
// neither run's numbers could be reported.
const LOCK = ".tmp-data/vercel-bot-100.lock";
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, "utf8"));
  let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* gone */ }
  if (alive) { console.error(`another run (pid ${pid}) is going; refusing to start beside it`); process.exit(2); }
}
writeFileSync(LOCK, String(process.pid));
process.on("exit", () => { try { unlinkSync(LOCK); } catch { /* gone */ } });
const LOG = ".tmp-data/vercel-bot-100.jsonl";
writeFileSync(LOG, "");

// The world, narrowed to TEST: the sender's domain finds it and nothing else is visible.
const live = onsinchWorld();
const world: World = { ...live, companies: async () => (await live.companies()).filter((c: any) => Number(c.id) === TEST).map((c: any) => ({ ...c, Client: [{ id: 1591, email: "bench@test-eventz.co.uk" }] })) };
const FROM = "bench@test-eventz.co.uk";
const r = (x: Partial<Request>): Request => ({ action: "new_shift", problems: [], ...x });
const msg = (id: string, text: string) => ({ message_id: id, from: FROM, subject: "Vercel bot test", sentIso: new Date().toISOString(), text });

async function runOnVercel(source: string, op: Op): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${APP}/api/bot/run`, { method: "POST", headers: { "x-bot-secret": (process.env.BOT_SECRET || "").trim(), "content-type": "application/json" }, body: JSON.stringify({ source, op }) });
    const j: any = await res.json().catch(() => ({ status: `http ${res.status}` }));
    // "busy": a real email holds the bot. Nothing was sent; wait and ask again.
    if (j.status === "busy") { await new Promise((ok) => setTimeout(ok, 30_000)); continue; }
    return { http: res.status, ...j };
  }
  return { status: "busy", reasons: ["the bot stayed busy for 90 seconds"] };
}

async function newestAuditId(): Promise<number> {
  const first = await readPage(t, `/timelineAudits?limit=100`);
  const last = first.pageCount > 1 ? await readPage(t, `/timelineAudits?limit=100&page=${first.pageCount}`) : first;
  return last.rows.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
}

// Fifty shapes: sizes across every chief band, a carpenter on every third, a second day on
// every fourth, five windows including one past midnight. Each job on its own day, so no job
// can read as another's booking.
const SIZES = [2, 4, 6, 9, 10, 12, 15, 20, 25, 3];
const WINDOWS: Array<[string, string]> = [["08:00", "16:00"], ["07:00", "12:00"], ["18:00", "23:00"], ["22:00", "02:00"], ["06:30", "10:30"]];
const dayOf = (k: number) => new Date(Date.parse("2027-11-01T12:00:00Z") + k * 2 * 864e5).toISOString().slice(0, 10);
const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

function jobReading(k: number): { text: string; i: Interpretation; want: number } {
  const crew = SIZES[k % SIZES.length], [start, end] = WINDOWS[k % WINDOWS.length], date = dayOf(k);
  const reqs: Request[] = [r({ date, start, end, crew, venue: "Spartan Crew Unit 7", place_id: PLACE })];
  let text = `Please book ${crew} crew on ${date} ${start}-${end} at Spartan Crew Unit 7`;
  if (k % 3 === 0) { reqs.push(r({ date, start, end, crew: 1, trade: "carpenter", venue: "Spartan Crew Unit 7", place_id: PLACE })); text += " and a carpenter"; }
  if (k % 4 === 1) { reqs.push(r({ date: nextDay(date), start: "09:00", end: "13:00", crew: 4, venue: "Spartan Crew Unit 7", place_id: PLACE })); text += `, and 4 crew on ${nextDay(date)} 09:00-13:00`; }
  return { text, i: { intent: "booking", requests: reqs, problems: [] }, want: crew + (k % 3 === 0 ? 1 : 0) };
}

/** Five kinds of change, in turn: more crew, an earlier start, a carpenter, another day, fewer crew. */
function updateReading(k: number, orderId: number): { kind: string; text: string; i: Interpretation } {
  const date = dayOf(k), crew = SIZES[k % SIZES.length], [start] = WINDOWS[k % WINDOWS.length];
  const earlier = `${String((Number(start.slice(0, 2)) + 23) % 24).padStart(2, "0")}${start.slice(2)}`;
  const kinds = [
    { kind: "more crew", text: `Can we make ${date} ${crew + 4} crew please`, i: [r({ action: "change_crew", date, crew: crew + 4 })] },
    { kind: "earlier start", text: `Can the crew arrive for ${earlier} instead of ${start} on ${date}`, i: [r({ action: "change_times", date, start: earlier })] },
    { kind: "add a carpenter", text: `Please add a carpenter on ${date}`, i: [r({ action: "change_crew", date, crew_add: 1, trade: "carpenter" })] },
    { kind: "another day", text: `Please add 3 crew on ${nextDay(nextDay(date))} 10:00-14:00 too`, i: [r({ date: nextDay(nextDay(date)), start: "10:00", end: "14:00", crew: 3, order_id: orderId })] },
    { kind: "fewer crew", text: `Sorry, ${date} is now just ${crew > 3 ? 3 : crew - 1} crew`, i: [r({ action: "change_crew", date, crew: crew > 3 ? 3 : crew - 1 })] },
  ];
  const u = kinds[k % kinds.length];
  return { kind: u.kind, text: u.text, i: { intent: "change", requests: u.i, problems: [] } };
}

const startCursor = await newestAuditId();
const t0 = Date.now();
const jobs: any[] = [];
for (let k = 0; k < JOBS; k++) {
  const job: any = { k, create: null, update: null };
  // CREATE
  const c = jobReading(k);
  const d = await plan(msg(`${RUN}-c${k}`, c.text), c.i, world, null);
  if (d.kind !== "write") { job.create = { planned: d.kind, why: (d as any).reasons ?? (d as any).reason }; jobs.push(job); appendFileSync(LOG, JSON.stringify(job) + "\n"); continue; }
  const cr: any[] = [];
  for (const [n, { op }] of d.ops.entries()) { cr.push(await runOnVercel(`${RUN}:c${k}:${n}`, op)); await new Promise((ok) => setTimeout(ok, GAP_MS)); }
  const orderId = Number(cr.find((x) => Number(x.detail?.order_id))?.detail?.order_id) || 0;
  const orderNo = String(cr.find((x) => x.detail?.number)?.detail?.number ?? "");
  job.create = { ops: d.ops.map((o) => o.op.kind), results: cr.map((x) => x.status), reasons: cr.flatMap((x) => x.status === "verified" ? [] : x.reasons ?? []), order_id: orderId, number: orderNo, people: c.want };
  // UPDATE, on the order just made
  if (orderId && cr.every((x) => x.status === "verified")) {
    const u = updateReading(k, orderId);
    const du = await plan(msg(`${RUN}-u${k}`, u.text), u.i, world, orderId);
    if (du.kind !== "write") job.update = { kind: u.kind, planned: du.kind, why: (du as any).reasons ?? (du as any).reason };
    else {
      const ur: any[] = [];
      for (const [n, { op }] of du.ops.entries()) { ur.push(await runOnVercel(`${RUN}:u${k}:${n}`, op)); await new Promise((ok) => setTimeout(ok, GAP_MS)); }
      job.update = { kind: u.kind, ops: du.ops.map((o) => o.op.kind), results: ur.map((x) => x.status), reasons: ur.flatMap((x) => x.status === "verified" ? [] : x.reasons ?? []), why: du.why.filter((w) => !/^assumed/.test(w)) };
    }
    // The order as OnSinch holds it now: every live position, size, profession and window.
    const o = (await readRows(t, `/orders?id[eq]=${orderId}&with=Job__SlotTeam__Slot`))[0];
    const slots = ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => [].concat(j.SlotTeam ?? [])).flatMap((s: any) => [].concat(s.Slot ?? [])).filter((s: any) => s.cancelled !== true);
    job.after = { found: !!o, positions: slots.map((s: any) => `${s.size}x${Number(s.role) === 1 ? "chief" : s.profession_id}@${String(s.beginning).slice(5, 16)}`) };
  }
  jobs.push(job);
  appendFileSync(LOG, JSON.stringify(job) + "\n");
  const done = jobs.filter((j) => j.create?.results?.every((s: string) => s === "verified")).length;
  console.log(`${k + 1}/${JOBS}  R${job.create?.number ?? "-"}  create ${job.create?.results?.join(",") ?? job.create?.planned}  update(${job.update?.kind ?? "-"}) ${job.update?.results?.join(",") ?? job.update?.planned ?? "-"}  [${done} created so far, ${Math.round((Date.now() - t0) / 60000)} min]`);
}

// THE TIMELINE: every row by the bot since the start, on these orders' nodes.
const rows: any[] = [];
for (let page = 1; page <= 60; page++) {
  const p = await readPage(t, `/timelineAudits?id[gt]=${startCursor}&limit=100&page=${page}`);
  rows.push(...p.rows.filter((x) => Number(x.creator) === BOT));
  if (p.rows.length < 100) break;
}
const tally = rows.reduce((a: any, x) => ((a[x.action] = (a[x.action] ?? 0) + 1), a), {});

// Clean up whatever the sweep has not: TEST orders the bot made in this run.
const made = jobs.map((j) => j.create?.order_id).filter(Boolean);
const still = [];
for (const id of made) { const o = (await readRows(t, `/orders?id[eq]=${id}`))[0]; if (o && Number(o.company_id) === TEST && Number(o.creator) === BOT) still.push(id); }
if (still.length) { const del = await t("DELETE", "/orders", still); console.log(`deleted ${still.length} TEST orders: ${del.status}`); }
const left = [];
for (const id of made) if ((await readRows(t, `/orders?id[eq]=${id}`))[0]) left.push(id);

const ok = (xs: string[] | undefined) => !!xs?.length && xs.every((s) => s === "verified");
const summary = {
  run: RUN, minutes: Math.round((Date.now() - t0) / 60000), app: APP,
  jobs: JOBS,
  creates_verified: jobs.filter((j) => ok(j.create?.results)).length,
  updates_planned: jobs.filter((j) => j.update?.ops).length,
  updates_verified: jobs.filter((j) => ok(j.update?.results)).length,
  update_kinds: jobs.reduce((a: any, j) => { if (j.update) { const k = `${j.update.kind}: ${ok(j.update.results) ? "verified" : j.update.results?.join(",") ?? j.update.planned}`; a[k] = (a[k] ?? 0) + 1; } return a; }, {}),
  operations_sent: jobs.reduce((a, j) => a + (j.create?.results?.length ?? 0) + (j.update?.results?.length ?? 0), 0),
  operations_verified: jobs.reduce((a, j) => a + (j.create?.results ?? []).filter((s: string) => s === "verified").length + (j.update?.results ?? []).filter((s: string) => s === "verified").length, 0),
  timeline_rows_by_bot: tally,
  test_orders_left: left.length,
  failures: jobs.filter((j) => !ok(j.create?.results) || (j.update && !ok(j.update.results))).map((j) => ({ k: j.k, create: j.create, update: j.update })),
};
writeFileSync(".tmp-data/vercel-bot-100.json", JSON.stringify({ summary, jobs }, null, 2));
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.creates_verified === JOBS && summary.updates_verified === JOBS ? 0 : 1);
