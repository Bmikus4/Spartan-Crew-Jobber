// ============================================================================
// Every timer for this automation is a Vercel cron into the app, on its own secret.
// ----------------------------------------------------------------------------
// The owner, 26 Oct: no heartbeat for this automation runs in n8n, ever (DECISIONS O1, addendum
// F32). The minute sync and the heartbeat are GET entry points a Vercel cron calls with
// `Authorization: Bearer $CRON_SECRET`. Once CRON_SECRET is set the intake secret, which every
// n8n intake node holds, no longer opens the sync or the labels (addendum F3); until it is set
// the n8n minute schedule keeps the sync running. A step that fails makes the sync answer not ok
// (addendum F37). The sync's steps are injected and its route is refused before any IO; the
// heartbeat runs against PGlite (fixtures/pg.ts). Nothing here reaches OnSinch, n8n or production.
// npx tsx test/cronEntryPoints.ts
// ============================================================================
import "./fixtures/pg";
import { readFileSync } from "node:fs";
import { authorizeCronCall } from "../app/lib/apiAuth";
import { runSync } from "../app/lib/routes/sync";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const env = process.env as Record<string, string | undefined>;
const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/bot/sync", { headers });
const asProduction = <T>(cron: string | undefined, f: () => T): T => {
  const keep = { NODE_ENV: env.NODE_ENV, CRON_SECRET: env.CRON_SECRET, N8N_WEBHOOK_SECRET: env.N8N_WEBHOOK_SECRET, AUTH_REQUIRED: env.AUTH_REQUIRED };
  env.NODE_ENV = "production"; env.N8N_WEBHOOK_SECRET = "intake-secret"; delete env.AUTH_REQUIRED;
  if (cron === undefined) delete env.CRON_SECRET; else env.CRON_SECRET = cron;
  try { return f(); } finally { for (const [k, v] of Object.entries(keep)) if (v === undefined) delete env[k]; else env[k] = v; }
};

(async () => {
  console.log("\n[secret] CRON_SECRET set: the cron's secret opens the sync, the intake secret does not");
  asProduction("cron-secret", () => {
    ok(authorizeCronCall(req({ authorization: "Bearer cron-secret" })).ok, "Vercel's Bearer CRON_SECRET: allowed");
    ok(authorizeCronCall(req({ "x-webhook-secret": "cron-secret" })).ok, "CRON_SECRET in x-webhook-secret (n8n's label workflow): allowed");
    ok(!authorizeCronCall(req({ "x-webhook-secret": "intake-secret" })).ok, "the intake secret: refused");
    ok(!authorizeCronCall(req({ authorization: "Bearer intake-secret" })).ok, "the intake secret as a Bearer: refused");
    ok(!authorizeCronCall(req()).ok, "nothing presented: refused");
  });
  console.log("\n[switch-over] CRON_SECRET not yet set: the n8n minute schedule keeps the sync running");
  asProduction(undefined, () => {
    ok(authorizeCronCall(req({ "x-webhook-secret": "intake-secret" })).ok, "the intake secret: allowed until CRON_SECRET exists");
    ok(!authorizeCronCall(req()).ok, "nothing presented: refused (the cron's unauthenticated call before the secret is set)");
  });

  console.log("\n[entry points] GET handlers behind the cron gate, and the crons that call them");
  const sync = readFileSync("app/api/bot/sync/route.ts", "utf8");
  const beat = readFileSync("app/api/health/heartbeat/route.ts", "utf8");
  const labels = readFileSync("app/api/bot/labels/route.ts", "utf8");
  ok(/export async function GET/.test(sync) && /export async function GET/.test(beat), "/api/bot/sync and /api/health/heartbeat answer GET");
  for (const [name, src] of [["sync", sync], ["heartbeat", beat], ["labels", labels]] as const)
    ok(/authorizeCronCall\(request\)/.test(src) && !/authorizeMachineCall/.test(src), `${name}: authorizeCronCall, never the intake secret's authorizeMachineCall`);
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const crons = new Map<string, string>((vercel.crons ?? []).map((c: { path: string; schedule: string }) => [c.path, c.schedule]));
  ok(crons.get("/api/bot/sync") === "* * * * *", "vercel.json: the sync every minute", [...crons]);
  ok(crons.get("/api/health/heartbeat") === "*/5 * * * *", "vercel.json: the heartbeat every 5 minutes", [...crons]);
  ok(!crons.has("/api/reconcile"), "vercel.json: not /api/reconcile (the old engine's)", [...crons]);
  for (const path of ["/api/bot/sync", "/api/health/heartbeat"]) {
    const mod = await import(`../app${path}/route`);
    const r = await asProduction("cron-secret", () => mod.GET(new Request(`http://localhost${path}`)) as Promise<Response>);
    ok(r.status === 401, `${path} GET without the secret: 401 before any work`, r.status);
  }
  {
    const mod = await import("../app/api/health/heartbeat/route");
    const r = await asProduction("cron-secret", () => mod.GET(new Request("http://localhost/api/health/heartbeat", { headers: { authorization: "Bearer cron-secret" } })) as Promise<Response>);
    const body = await r.json();
    ok(r.status === 200 && Array.isArray(body.beats) && body.beats.some((b: { signal: string }) => b.signal === "sync"), "/api/health/heartbeat GET with the cron's secret: runs and answers each signal", { status: r.status, body });
  }

  console.log("\n[honest sync] a step that fails makes the answer not ok, and the finish is recorded");
  {
    const marks: Array<[string, boolean]> = [];
    const mark = async (name: string, good: boolean) => { marks.push([name, good]); };
    const good = await runSync([["a", async () => ({ n: 1 })], ["b", async () => "skipped"]], { mark });
    ok(good.ok && good.failed.length === 0, "every step fine: ok", good);
    const threw = await runSync([["a", async () => ({ n: 1 })], ["b", async () => { throw new Error("OnSinch 500"); }], ["c", async () => 1]], { mark });
    ok(!threw.ok && threw.failed.join() === "b", "a step that throws: not ok, named", threw);
    ok((threw as any).c === 1, "and the steps after it still run", threw);
    const caught = await runSync([["a", async () => ({ error: "links 500" })], ["b", async () => "error: board 500"]], { mark });
    ok(!caught.ok && caught.failed.join() === "a,b", "a step answering with its own caught error: not ok", caught);
    ok(JSON.stringify(marks) === JSON.stringify([["sync", true], ["sync", false], ["sync", false]]), "each run's finish is recorded for the heartbeat, with its verdict", marks);
    const unmarked = await runSync([["a", async () => 1]], { mark: async () => { throw new Error("db down"); } });
    ok(unmarked.ok, "a finish that cannot be recorded does not fail the sync (the heartbeat then sees it stale)", unmarked);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
