// ============================================================================
// A write that stopped ends in exactly one final result, with no operation run twice (addendum Prompt 6).
// ----------------------------------------------------------------------------
// Fault-injected on PGlite: a run that stopped before the submit, one that died between two operations,
// one that died inside an operation, one from an older build (F38), and one staff overtook. The bot,
// the ledger and the planner are injected; nothing reaches OnSinch. A model timeout is the re-read's
// (test/retryUnread.ts); a capture that fails part-way keeps what it stored (test/noDataLoss.ts).
// npx tsx --require ./test/fixtures/pg.ts test/resumeStopped.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import type { Decision } from "../app/lib/v2/interpret/plan";
import type { RunResult } from "../app/lib/v2/bot/run";
import type { Op } from "../app/lib/v2/bot/ops";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.VERCEL_GIT_COMMIT_SHA = "build-2";
delete process.env.SPARTAN_PAUSED;
const { resumeStopped, RESUME_AFTER_MS } = require("../app/lib/v2/resume.ts");
const { ensureSchema } = require("../app/lib/migrations.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const NOW = Date.now();
const day = new Date(NOW + 7 * 86_400_000).toISOString().slice(0, 10);
const times = (slot: number, start: string): Op => ({ kind: "set_position_times", order_id: 9, slot_id: slot, date: day, start, end: "17:00" } as Op);
const OPS = (id: string) => [{ source: `${id}#0`, op: times(1, "08:00") }, { source: `${id}#1`, op: times(2, "08:00") }];
const write = (id: string): Decision => ({ kind: "write", ops: OPS(id), why: ["R1 shift 1: times to 08:00-17:00"] });
const verified = (k: string): RunResult => ({ op_key: k, status: "verified", reasons: [] });

async function decision(id: string, executed: RunResult[], build = "build-2") {
  await sql`INSERT INTO v2_decisions (message_id, thread_id, sent_at, kind, decision, executed, code_version)
    VALUES (${id}, ${"t-" + id}, ${new Date(NOW).toISOString()}, 'write', ${JSON.stringify(write(id))}::jsonb, ${JSON.stringify(executed)}::jsonb, ${build})`;
}
const executedOf = async (id: string) => ((await sql`SELECT executed FROM v2_decisions WHERE message_id = ${id}`) as any[])[0].executed as RunResult[];

/** The injected world: what ran, what the ledger holds, what planning again says. */
function rig(o: { ledger?: Record<string, { status: string; at: number }>; again?: (id: string) => Decision | null } = {}) {
  const ran: string[] = [];
  return {
    ran,
    deps: {
      writes: async () => true,
      now: () => NOW,
      run: async (source: string, op: Op): Promise<RunResult> => { ran.push(`${source}:${(op as any).slot_id}`); return verified(source); },
      ledger: async (source: string) => o.ledger?.[source] ?? null,
      planAgain: async (id: string) => (o.again ? o.again(id) : { kind: "write", ops: OPS(id).slice(1), why: [] } as Decision),
    },
  };
}
const old = NOW - RESUME_AFTER_MS - 60_000;

(async () => {
  await ensureSchema(sql);

  console.log("\n[1] stopped before the submit: planned again, the rest runs, one final result");
  {
    await decision("s1", [verified("s1#0"), { op_key: "k", status: "blocked", reasons: ["bot error before submit"] }]);
    const r = rig();
    const rep = await resumeStopped(sql, r.deps);
    const ex = await executedOf("s1");
    ok(r.ran.join() === "s1#1:retry1:2" && rep.resumed === 1, "the stopped operation runs again, once", { ran: r.ran, rep });
    ok(ex.map((x) => x.status).join() === "verified,verified", "the record ends verified, the blocked attempt replaced", ex);
    const again = rig();
    await resumeStopped(sql, again.deps);
    ok(again.ran.length === 0, "a second sweep runs nothing: the decision is final", again.ran);
  }

  console.log("\n[2] the run died between two operations: the one that never started runs, once");
  {
    await decision("b1", [verified("b1#0")]);
    const live = rig({ ledger: { "b1#0": { status: "verified", at: NOW - 60_000 } } });
    await resumeStopped(sql, live.deps);
    ok(live.ran.length === 0, "a minute after the last move it may still be running: left alone", live.ran);
    const r = rig({ ledger: { "b1#0": { status: "verified", at: old } } });
    await resumeStopped(sql, r.deps);
    ok(r.ran.join() === "b1#1:retry1:2", "after RESUME_AFTER_MS of stillness the rest runs", r.ran);
    ok((await executedOf("b1")).map((x) => x.status).join() === "verified,verified", "and the record is whole");
  }

  console.log("\n[3] the run died inside an operation: never sent again, recorded unknown");
  {
    await decision("d1", [verified("d1#0")]);
    const r = rig({ ledger: { "d1#0": { status: "verified", at: old }, "d1#1": { status: "intent", at: old } } });
    const rep = await resumeStopped(sql, r.deps);
    const ex = await executedOf("d1");
    ok(r.ran.length === 0 && rep.closed === 1, "nothing runs: it may have landed", { ran: r.ran, rep });
    ok(ex.length === 2 && ex[1].status === "unknown" && /a person checks/.test(ex[1].reasons[0]), "one final result, unknown, for a person", ex);
  }

  console.log("\n[4] staff overtook it, or the plan changed: closed, not resumed");
  {
    await decision("c1", [verified("c1#0")]);
    const r = rig({ ledger: { "c1#0": { status: "verified", at: old } }, again: () => ({ kind: "none", reason: "staff changed R1 after the email" }) });
    await resumeStopped(sql, r.deps);
    const ex = await executedOf("c1");
    ok(r.ran.length === 0 && ex[ex.length - 1].status === "cancelled" && /staff changed R1/.test(ex[ex.length - 1].reasons[0]), "one cancelled result saying why", ex);
    const r2 = rig({ ledger: { "c1#0": { status: "verified", at: old } } });
    await resumeStopped(sql, r2.deps);
    ok(r2.ran.length === 0 && (await executedOf("c1")).length === 2, "and it stays closed", await executedOf("c1"));
  }

  console.log("\n[5] a decision of an older build is planned again, not dropped (F38)");
  {
    await decision("o1", [verified("o1#0"), { op_key: "k", status: "busy", reasons: ["another operation holds the bot"] }], "build-1");
    const r = rig();
    await resumeStopped(sql, r.deps);
    ok(r.ran.join() === "o1#1:retry1:2", "the stopped write of build-1 runs under build-2 after planning again", r.ran);
  }

  console.log("\n[6] writes off, or paused: nothing is looked at");
  {
    await decision("w1", [verified("w1#0"), { op_key: "k", status: "busy", reasons: ["another operation holds the bot"] }]);
    const r = rig();
    await resumeStopped(sql, { ...r.deps, writes: async () => false });
    process.env.SPARTAN_PAUSED = "1";
    const p = await resumeStopped(sql, r.deps);
    delete process.env.SPARTAN_PAUSED;
    ok(r.ran.length === 0 && p.paused === true, "no run, and the pause is said", { ran: r.ran, p });
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
