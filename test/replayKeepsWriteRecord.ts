// ============================================================================
// Deciding an email again never erases what the bot sent for it.
// ----------------------------------------------------------------------------
// The decision upsert writes `executed` as JSON null, and `coalesce` keeps a jsonb null, so a
// replay through POST /api/bot/process replaced a write's executed statuses with nothing: the
// only record of what reached OnSinch (audit/pipeline-trace-addendum.md R4, 2026-10-25). The
// intake alarm names that route. An email with something sent is refused there instead, as the
// replan already refuses it (replan.ts:63). An email that sent nothing still decides again.
// Against PGlite (fixtures/pg.ts): nothing here reaches the production database.
// npx tsx test/replayKeepsWriteRecord.ts
// ============================================================================
import { sql } from "./fixtures/pg";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.VERCEL_GIT_COMMIT_SHA = "test";
// No key, so the reader throws before any request: the unguarded path then records a hand-off, which
// is how a replay erases (and it costs nothing).
delete process.env.OPENROUTER_API_KEY;
const { processMessage, decideDelivery } = require("../app/lib/v2/process.ts");
const { captureInboundRaw } = require("../app/lib/inboundRawDb.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

(async () => {
  // The message store and the decisions table exist, as in production; nothing is decided.
  await captureInboundRaw({ thread_id: "t0", messages: [{ message_id: "m0", from: "Sam <sam@client.co.uk>", to: ["bookings@spartancrew.co.uk"], date: "2026-11-02T08:00:00Z", subject: "Crew", body: "thanks" }] });
  // w1's own message is captured too, so without the guard it is decided again and its record overwritten.
  await captureInboundRaw({ thread_id: "t1", messages: [{ message_id: "w1", from: "Sam <sam@client.co.uk>", to: ["bookings@spartancrew.co.uk"], date: "2026-11-02T09:00:00Z", subject: "PO", body: "PO 4471 please" }] });
  await decideDelivery([]);
  await processMessage("warm-up", { execute: false }).catch(() => {});
  const executed = [{ status: "verified", op: "set_po" }];
  await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, executed, code_version)
    VALUES ('w1', 't1', 'sam@client.co.uk', '2026-11-02T09:00:00Z', 'write', ${JSON.stringify({ kind: "write", ops: [], why: [] })}::jsonb, ${JSON.stringify(executed)}::jsonb, 'test'),
           ('h1', 't2', 'sam@client.co.uk', '2026-11-02T09:00:00Z', 'handoff', ${JSON.stringify({ kind: "handoff", reasons: ["x"] })}::jsonb, 'null'::jsonb, 'test')`;

  console.log("\nan email with a write that ran");
  const r = await processMessage("w1", { execute: false });
  ok(/record stands/.test(String(r.skipped)), "is refused, with the reason", r);
  const [row] = (await sql`SELECT executed FROM v2_decisions WHERE message_id = 'w1'`) as any[];
  ok(row?.executed?.length === 1 && row.executed[0].status === "verified" && row.executed[0].op === "set_po", "and keeps its executed statuses", row?.executed);

  console.log("\nan email that sent nothing");
  const h = await processMessage("h1", { execute: false });
  ok(!/record stands/.test(String(h.skipped ?? "")), "is not refused by the guard (it goes on to read the message)", h);

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})().catch((e) => { console.error(e); process.exit(1); });
