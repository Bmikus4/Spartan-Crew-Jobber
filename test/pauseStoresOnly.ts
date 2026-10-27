// ============================================================================
// A pause under v2 stores the mail it receives and decides none of it, now or later.
// ----------------------------------------------------------------------------
// Addendum F31 (26 Oct): SPARTAN_PAUSED=1 answered 503 at /api/n8n-inbound and /api/dedupe before
// capture, so the 10-21 pause left 40 client emails unstored, beyond intake's 72 h catch-up. The
// owner ruled those 40 are stored, not decided (decisions/2026-10-25-pause-window-store-only.md).
// Now a pause under v2 keeps intake open, stores each delivery and marks its new messages store-only,
// and the undecided sweep never decides a marked message after the pause lifts.
// Against PGlite (fixtures/pg.ts); no model is called.
// npx tsx test/pauseStoresOnly.ts
// ============================================================================
import { sql, clock, syncSqlClock } from "./fixtures/pg";
import type { InboundIO } from "../app/lib/n8nInbound";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.VERCEL_GIT_COMMIT_SHA = "test";
delete process.env.INTAKE_PATH;
const { handleInbound, productionInboundIO } = require("../app/lib/n8nInbound.ts");
const { captureInboundRaw } = require("../app/lib/inboundRawDb.ts");
const { sweepUndecided } = require("../app/lib/v2/process.ts");
const { automationPaused } = require("../app/lib/paused.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const T0 = Date.parse("2026-11-02T09:00:00Z");
const MIN = 60_000;
const mail = (id: string, at: string) => ({ message_id: id, from: "Sam <sam@client.co.uk>", to: ["bookings@spartancrew.co.uk"], date_iso: at, subject: "Crew", body: "Please add 2 crew on Friday" });
const post = (body: unknown) => new Request("http://localhost/api/n8n-inbound", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const at = async (ms: number) => { clock.set(ms); await syncSqlClock(); };

(async () => {
  process.env.SPARTAN_ENGINE = "v2";

  console.log("\n[door] a pause under v2 leaves intake and its dedupe claim open");
  ok(!automationPaused("/api/n8n-inbound", "1", "v2") && !automationPaused("/api/dedupe", "1", "v2"), "intake and dedupe answer while paused under v2");
  ok(automationPaused("/api/n8n-inbound", "1", "") && automationPaused("/api/dedupe", "1", ""), "control: under the old engine a pause still shuts them");
  ok(automationPaused("/api/mail-poll", "1", "v2") && automationPaused("/api/confirm-order", "1", "v2"), "the old engine's routes stay shut");

  console.log("\n[paused] the delivery is stored and marked, and nothing decides it");
  await at(T0);
  const decided: string[][] = [];
  const io: InboundIO = { ...productionInboundIO, decide: (async (ids: string[]) => { decided.push(ids); return []; }) as InboundIO["decide"] };
  process.env.SPARTAN_PAUSED = "1";
  const res = await handleInbound(post({ thread_id: "tq", messages: [mail("q1", "2026-11-02T08:00:00Z"), mail("q2", "2026-11-02T08:05:00Z")] }), io);
  const body = await res.json();
  ok(res.status === 200 && body.paused === true, "answered 200, paused, so n8n does not retry", { status: res.status, body });
  ok(decided.length === 0, "decide was never called", decided);
  const stored = (await sql`SELECT message_id FROM thread_messages WHERE thread_id = 'tq' ORDER BY message_id`) as any[];
  ok(stored.map((r) => r.message_id).join() === "q1,q2", "both messages are stored", stored);
  const marked = (await sql`SELECT message_id FROM v2_store_only ORDER BY message_id`) as any[];
  ok(marked.map((r) => r.message_id).join() === "q1,q2", "and both are marked store-only", marked);
  delete process.env.SPARTAN_PAUSED;

  console.log("\n[lifted] the sweep skips marked mail and decides unmarked mail");
  await captureInboundRaw({ thread_id: "tu", messages: [mail("u1", "2026-11-02T08:10:00Z")] });
  await at(T0 + 20 * MIN);
  const asked: string[] = [];
  const rep = await sweepUndecided({ decide: async (id: string) => { asked.push(id); } });
  ok(!asked.includes("q2") && !asked.includes("q1"), "the pause-time mail is never decided", { asked, rep });
  ok(asked.includes("u1"), "control: mail stored outside the pause is decided", { asked, rep });
  const rows = (await sql`SELECT message_id FROM v2_decisions WHERE message_id IN ('q1', 'q2')`) as any[];
  ok(rows.length === 0, "and no decision row is written for the marked mail", rows);

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
