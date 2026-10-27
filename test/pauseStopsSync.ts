// ============================================================================
// SPARTAN_PAUSED=1 stops the minute sync's own actions, not only the intake routes.
// ----------------------------------------------------------------------------
// The addendum's F3 and F15 (23 Oct): the pause gated the routes in AUTOMATION_ROUTES, and
// /api/bot/* is not among them, so the n8n minute sync kept retrying stopped writes and
// clearing test data from the live tenant while paused. The test-data clear was gated by one
// Settings switch and neither write key. Against PGlite with the bot and OnSinch faked: a
// retry is counted at runOp, a deletion at the transport.
// npx tsx test/pauseStopsSync.ts
// ============================================================================
import { sql } from "./fixtures/pg";
/* eslint-disable @typescript-eslint/no-require-imports */
const ran: string[] = [];
const runPath = require.resolve("../app/lib/v2/bot/run.ts");
require.cache[runPath] = { id: runPath, filename: runPath, loaded: true, children: [], paths: [], exports: {
  runOp: async (source: string) => { ran.push(source); return { op_key: "k", status: "verified", reasons: [] }; },
} } as any;
const calls: string[] = [];
(globalThis as any).fetch = async (url: string, init?: { method?: string }) => {
  calls.push(`${init?.method ?? "GET"} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
};
Object.assign(process.env, { SPARTAN_WRITES: "live", VERCEL_GIT_COMMIT_SHA: "test", N8N_WEBHOOK_SECRET: "test-secret", ONSINCH_API_KEY: "test" });
delete process.env.SPARTAN_PAUSED;
const { saveSettings } = require("../app/lib/settingsDb.ts");
const { retryStopped } = require("../app/lib/v2/process.ts");
const { maybeSweep } = require("../app/lib/testData.ts");
const { POST: syncPOST } = require("../app/api/bot/sync/route.ts");
const { POST: labelsPOST } = require("../app/api/bot/labels/route.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const post = (fn: (r: Request) => Promise<Response>, body: unknown = {}) =>
  fn(new Request("https://x/api/bot", { method: "POST", headers: { "x-webhook-secret": "test-secret", "content-type": "application/json" }, body: JSON.stringify(body) }));

/** A write the bot stopped before sending: retryStopped tries it again while writes are on. */
async function stoppedWrite(id: string) {
  const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const decision = { kind: "write", ops: [{ source: `${id}#0`, op: { kind: "set_position_times", order_id: 9, slot_id: 1, date: day, start: "09:00", end: "17:00" } }], why: [] };
  await sql`CREATE TABLE IF NOT EXISTS v2_decisions (message_id TEXT PRIMARY KEY, thread_id TEXT, from_address TEXT, sent_at TEXT, kind TEXT NOT NULL,
    interpretation JSONB, decision JSONB NOT NULL, executed JSONB, code_version TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), company_id INTEGER, company TEXT)`;
  await sql`INSERT INTO v2_decisions (message_id, thread_id, sent_at, kind, decision, executed, code_version)
    VALUES (${id}, ${"t-" + id}, ${new Date().toISOString()}, 'write', ${JSON.stringify(decision)}::jsonb, ${JSON.stringify([{ op_key: "k", status: "blocked", reasons: ["bot error before submit"] }])}::jsonb, 'test')`;
}

(async () => {
  await saveSettings({ bot_writes_enabled: true, test_data_autoclear: true });

  console.log("\n[1] paused, the minute sync retries nothing and deletes nothing");
  {
    await stoppedWrite("r1");
    process.env.SPARTAN_PAUSED = "1";
    const body = await (await post(syncPOST)).json();
    ok(ran.length === 0 && body.retry?.paused === true, "no stopped write is tried again", { ran, retry: body.retry });
    ok(body.testData === "paused" && !calls.some((c) => c.startsWith("DELETE")), "the test-data clear does not run", { testData: body.testData, calls });
    ok(body.undecided?.paused === true, "nor does the undecided sweep", body.undecided);
    const labels = await post(labelsPOST, { mode: "live" });
    const lb = await labels.json();
    ok(labels.status === 503 && lb.paused === true && !lb.threads, "and no labels are handed out, so n8n changes none this minute", { status: labels.status, lb });
    delete process.env.SPARTAN_PAUSED;
  }

  console.log("\n[2] the controls: unpaused, the same sync acts");
  {
    ran.length = 0;
    await sql`DELETE FROM v2_decisions WHERE message_id = 'r1'`;
    await stoppedWrite("r2");
    const body = await (await post(syncPOST)).json();
    ok(ran.length === 1 && body.retry?.retried === 1, "the stopped write is tried again", { ran, retry: body.retry });
    ok(body.testData !== "paused" && body.testData !== "writes off", "and the test-data clear runs", body.testData);
  }

  console.log("\n[3] the test-data clear needs both write keys, like a write");
  {
    calls.length = 0;
    await saveSettings({ bot_writes_enabled: false });
    ok((await maybeSweep(sql, async () => { calls.push("t"); return { status: 200, data: [] }; }, true, { writes: false })) === "writes off" && calls.length === 0, "with writes off it reads and removes nothing");
    process.env.SPARTAN_PAUSED = "1";
    ok((await maybeSweep(sql, async () => { calls.push("t"); return { status: 200, data: [] }; }, true, { writes: true })) === "paused" && calls.length === 0, "paused, the same with writes on");
    delete process.env.SPARTAN_PAUSED;
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
