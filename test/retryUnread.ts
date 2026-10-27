// ============================================================================
// An email the system could not read is read again with backoff, never left as a card for good.
// ----------------------------------------------------------------------------
// 1a144c619a140ea6 (10-23): "the system could not read this email (extract: OpenRouter 429)" stayed on
// the TV as Needs Created for three days, because nothing reads a failed email again (only writes that
// stopped are retried, retryStopped). retryUnread reads it again 5, 15 and 45 minutes on, three times at
// most, within the sweep's week. Against PGlite (fixtures/pg.ts); the reader is a stub, no model is called.
// npx tsx test/retryUnread.ts
// ============================================================================
import { sql } from "./fixtures/pg";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.VERCEL_GIT_COMMIT_SHA = "test";
delete process.env.OPENROUTER_API_KEY;
const { retryUnread, decideDelivery, processMessage, UNREAD_RETRIES } = require("../app/lib/v2/process.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const MIN = 60_000;

(async () => {
  await decideDelivery([]);
  await processMessage("warm-up", { execute: false }).catch(() => {});
  const unread = (id: string, at: string, extra: Record<string, unknown> = {}) => sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, executed, code_version, created_at)
    VALUES (${id}, ${"t-" + id}, 'sam@client.example', ${at}, 'handoff', ${JSON.stringify({ kind: "handoff", reasons: ["the system could not read this email (extract: OpenRouter 429)"], code: "system_failed", ...extra })}::jsonb, 'null'::jsonb, 'test', ${at})`;
  const now = Date.now(), iso = (ms: number) => new Date(ms).toISOString();
  await unread("fresh", iso(now - 2 * MIN));
  await unread("due", iso(now - 10 * MIN));
  await unread("again", iso(now - 60 * MIN), { reads: 1, read_at: iso(now - 20 * MIN) });
  await unread("waiting", iso(now - 60 * MIN), { reads: 1, read_at: iso(now - 10 * MIN) });
  await unread("spent", iso(now - 300 * MIN), { reads: UNREAD_RETRIES, read_at: iso(now - 200 * MIN) });
  await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, executed, code_version)
    VALUES ('other', 't-other', 'sam@client.example', ${iso(now - 60 * MIN)}, 'handoff', ${JSON.stringify({ kind: "handoff", reasons: ["2026-10-20 is within 7 days of the email: a person creates it"] })}::jsonb, 'null'::jsonb, 'test')`;

  console.log("\nthe reader still fails");
  const tried: string[] = [];
  const failing = async (id: string) => { tried.push(id); };
  const r = await retryUnread({ decide: failing, now, limit: 10 });
  ok(JSON.stringify([...tried].sort()) === JSON.stringify(["again", "due"]), "reads again the one 10 min old and the one whose second wait (15 min) is over", tried);
  ok(!tried.includes("fresh"), "not one read 2 min ago (waits 5)");
  ok(!tried.includes("waiting"), "not one whose last try was 10 min ago after a first retry (waits 15)");
  ok(!tried.includes("spent"), `not one already tried ${UNREAD_RETRIES} times`);
  ok(!tried.includes("other"), "not a hand-off for any other reason");
  const [due] = (await sql`SELECT decision FROM v2_decisions WHERE message_id = 'due'`) as any[];
  ok(due.decision.reads === 1 && !!due.decision.read_at, "a failed try is counted on the card", due.decision);
  ok(r.retried.length === 2, "and reported", r);

  console.log("\nthe reader succeeds");
  await unread("heals", iso(now - 10 * MIN));
  const healing = async (id: string) => {
    await sql`UPDATE v2_decisions SET kind = 'write', decision = ${JSON.stringify({ kind: "write", ops: [], why: ["read on retry"] })}::jsonb WHERE message_id = ${id}`;
  };
  await retryUnread({ decide: healing, now, limit: 10 });
  const [h] = (await sql`SELECT kind, decision FROM v2_decisions WHERE message_id = 'heals'`) as any[];
  ok(h.kind === "write" && h.decision.reads === undefined, "the new decision stands, with no try counted on it", h);

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})().catch((e) => { console.error(e); process.exit(1); });
