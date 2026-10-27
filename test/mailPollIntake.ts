// ============================================================================
// The Gmail poll decides what it reads as n8n's intake does, and only when it is the live intake (R14, F43).
// ----------------------------------------------------------------------------
// settlePolled (app/lib/mail/pollIntake.ts) on PGlite, with the decision injected so no model is called.
// Pinned: live, each thread is decided once, on its undecided messages only, whichever intake stored them;
// a thread that throws or misses the time budget is left to the sweep and the others go on; in shadow
// nothing is decided; paused, what the poll stored is marked store-only and the sweep never decides it.
// n8n's intake, once INTAKE_PATH=routing, stores and decides nothing. And the route is no longer shut.
// npx tsx --require ./test/fixtures/pg.ts test/mailPollIntake.ts
// ============================================================================
import { sql, clock, syncSqlClock } from "./fixtures/pg";
import { existsSync, readFileSync } from "node:fs";
import type { PollIO, Polled } from "../app/lib/mail/pollIntake";
import type { InboundIO } from "../app/lib/n8nInbound";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.VERCEL_GIT_COMMIT_SHA = "test";
delete process.env.SPARTAN_PAUSED;
delete process.env.INTAKE_PATH;
const { settlePolled, productionPollIO } = require("../app/lib/mail/pollIntake.ts");
const { handleInbound, productionInboundIO } = require("../app/lib/n8nInbound.ts");
const { captureInboundRaw } = require("../app/lib/inboundRawDb.ts");
const { sweepUndecided } = require("../app/lib/v2/process.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const T0 = Date.parse("2026-11-03T09:00:00Z");
const MIN = 60_000;
const at = async (ms: number) => { clock.set(ms); await syncSqlClock(); };
const mail = (id: string, when: string) => ({ message_id: id, from: "Sam <sam@client.co.uk>", to: ["bookings@spartancrew.co.uk"], date_iso: when, subject: "Crew", body: "Please add 2 crew on Friday" });
const store = (thread: string, ...ids: string[]) => captureInboundRaw({ thread_id: thread, messages: ids.map((id, i) => mail(id, `2026-11-03T08:0${i}:00Z`)) });
const P = (message_id: string, thread_id: string, inserted = true): Polled => ({ message_id, thread_id, inserted });
const post = (body: unknown) => new Request("http://localhost/api/n8n-inbound", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function rig(o: { throwOn?: string } = {}) {
  const decided: string[][] = [], reported: string[] = [];
  const io: PollIO = {
    ...productionPollIO,
    decide: (async (ids: string[]) => { if (ids.includes(o.throwOn ?? "-")) throw new Error("model timeout"); decided.push(ids); return ids.map((message_id) => ({ message_id, decision: { kind: "none", reason: "x" } })); }) as PollIO["decide"],
    report: (async (r: any) => { reported.push(r.route); return true; }) as PollIO["report"],
  };
  return { io, decided, reported };
}

(async () => {
  await at(T0);
  await store("t1", "a1", "a2");
  await store("t2", "b1");
  await store("t3", "c1");
  await sql`INSERT INTO v2_decisions (message_id, thread_id, kind, decision) VALUES ('c1', 't3', 'none', '{"kind":"none","reason":"x"}'::jsonb)`;
  const batch = [P("a1", "t1"), P("b1", "t2", false), P("a2", "t1"), P("c1", "t3")];

  console.log("\n[live] INTAKE_PATH=routing: one decision per thread, on what has none");
  process.env.INTAKE_PATH = "routing";
  {
    const r = rig();
    const out = await settlePolled(batch, r.io);
    ok(JSON.stringify(r.decided) === JSON.stringify([["a1", "a2"], ["b1"]]), "t1 read as one, t2 though n8n stored it first, t3 already decided", r.decided);
    ok(out.length === 2, "an answer per thread decided", out);
  }

  console.log("\n[throws] a thread that throws is left to the sweep, and the next is still decided");
  {
    const r = rig({ throwOn: "a1" });
    const out = await settlePolled(batch, r.io);
    ok(JSON.stringify(r.decided) === JSON.stringify([["b1"]]), "t2 decided after t1 threw", r.decided);
    ok(r.reported.join() === "engine-threw" && /sweep/.test(out[0]?.engine ?? ""), "the throw is reported once and named as the sweep's", { reported: r.reported, out });
  }

  console.log("\n[budget] past the time budget nothing more is decided");
  {
    const r = rig();
    const out = await settlePolled(batch, r.io, { deadline: Date.now() - 1 });
    ok(r.decided.length === 0 && out.every((x: any) => /time budget/.test(x.engine)), "each thread left to the sweep", { decided: r.decided, out });
  }

  console.log("\n[shadow] INTAKE_PATH unset: the poll stores and decides nothing");
  delete process.env.INTAKE_PATH;
  {
    const r = rig();
    const out = await settlePolled(batch, r.io);
    ok(r.decided.length === 0 && out.every((x: any) => /^shadow/.test(x.engine)), "nothing decided", { decided: r.decided, out });
  }

  console.log("\n[paused] what the poll stored first is marked, and the sweep never decides it");
  await store("t4", "d1");
  await store("t5", "e1");
  for (const path of ["routing", ""]) {
    process.env.INTAKE_PATH = path;
    process.env.SPARTAN_PAUSED = "1";
    const r = rig();
    await settlePolled([P("d1", "t4"), P("e1", "t5", false)], r.io);
    ok(r.decided.length === 0, `INTAKE_PATH=${path || "unset"}: nothing decided`, r.decided);
  }
  delete process.env.SPARTAN_PAUSED;
  delete process.env.INTAKE_PATH;
  const marked = ((await sql`SELECT message_id FROM v2_store_only ORDER BY message_id`) as any[]).map((x) => x.message_id);
  ok(marked.join() === "d1", "the poll marks only what it stored; n8n's intake marks its own", marked);
  await at(T0 + 20 * MIN);
  const asked: string[] = [];
  await sweepUndecided({ decide: async (id: string) => { asked.push(id); }, limit: 10 });
  ok(!asked.includes("d1"), "the sweep skips the marked message after the pause", asked);
  ok(asked.includes("e1"), "control: an unmarked one is the sweep's", asked);

  console.log("\n[n8n] once the poll is live, n8n's intake stores and decides nothing");
  {
    const decided: string[][] = [];
    const io: InboundIO = { ...productionInboundIO, decide: (async (ids: string[]) => { decided.push(ids); return []; }) as InboundIO["decide"] };
    process.env.INTAKE_PATH = "routing";
    const res = await handleInbound(post({ thread_id: "t6", messages: [mail("f1", "2026-11-03T09:30:00Z")] }), io);
    const body = await res.json();
    ok(res.status === 200 && decided.length === 0, "answered 200 and decided nothing", { status: res.status, body, decided });
    ok(((await sql`SELECT 1 FROM thread_messages WHERE message_id = 'f1'`) as any[]).length === 1, "the message is stored");
    delete process.env.INTAKE_PATH;
    await handleInbound(post({ thread_id: "t7", messages: [mail("g1", "2026-11-03T09:31:00Z")] }), io);
    ok(JSON.stringify(decided) === JSON.stringify([["g1"]]), "control: with INTAKE_PATH unset n8n's intake decides", decided);
  }

  console.log("\n[route] /api/mail-poll hands its client mail to settlePolled, and nothing shuts it");
  {
    const route = readFileSync("app/api/mail-poll/route.ts", "utf8");
    ok(/settlePolled\(/.test(route), "the route calls settlePolled");
    ok(!readFileSync("middleware.ts", "utf8").includes("automationPaused") && !readFileSync("app/lib/paused.ts", "utf8").includes("SHUT_ROUTES"), "no route is shut by the middleware");
    ok(existsSync("app/api/n8n-inbound/route.ts"), "control: the n8n intake is still there");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
