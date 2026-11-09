// ============================================================================
// One day replays from one query over one relation, and the log only ever grows.
// ----------------------------------------------------------------------------
// The event log is derived (event_view over the six tables) and landed by the minute sync, so what
// is pinned here is the derivation: every source lands with its keys, a landed event is never
// rewritten, a rerun adds nothing, a NULL time stays out (the insert would refuse it), and a card's
// open and exit are two events, not one mutating row.
// npx tsx --require ./test/fixtures/pg.ts test/eventLog.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { syncEventLog } from "../app/lib/v2/loop/events";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

(async () => {
  await ensureSchema(sql as never);
  await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, is_from_spartan)
    VALUES ('m1', 't1', 'a@b', '2026-11-05T09:00:00Z', false), ('m2', 't1', 'us@spartan', '2026-11-05T09:30:00Z', true), ('m3', 't2', 'c@d', NULL, false)`;
  await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, created_at)
    VALUES ('m1', 't1', 'a@b', '2026-11-05T09:00:00Z', 'handoff', '{}'::jsonb, '2026-11-05T09:00:30Z')`;
  await sql`INSERT INTO onsinch_timeline (id, action, creator, created, order_id, data)
    VALUES (901, 'order_create', 7, '2026-11-05T10:00:00Z', 500, '{}'::jsonb), (902, 'slot_update', 7, '2026-11-05T11:00:00Z', NULL, '{}'::jsonb)`;
  await sql`INSERT INTO v2_trace (trace_id, source, component, at, data)
    VALUES ('t1', 'live', 'plan', '2026-11-05T09:01:00Z', '{}'::jsonb), ('sync-abc', 'sync', 'truth', '2026-11-05T09:02:00Z', '{}'::jsonb)`;
  await sql`INSERT INTO feed_marks (item_key, thread_id, mark, by, at) VALUES ('t1:0', 't1', 'done', 'cards', '2026-11-05T12:00:00Z')`;
  await sql`INSERT INTO v2_card_exits (item_key, thread_id, kind, opened_at, exit, exit_by, exit_at)
    VALUES ('t1:0', 't1', 'book', '2026-11-05T09:05:00Z', 'worked', 'staff', '2026-11-05T12:30:00Z')`;

  console.log("\n[land] every source lands with its keys");
  const first = await syncEventLog(sql as never);
  const rows = (await sql`SELECT source, ref, kind, thread_id, order_id, ask_key, actor FROM event_log ORDER BY at, source, ref`) as any[];
  ok(first.added === rows.length && rows.length === 10, "10 events: 2 mail (not the undated one), 1 reader, 2 onsinch, 2 trace, 1 mark, open + exit", { added: first.added, rows: rows.length });
  const by = (s: string) => rows.filter((r) => r.source === s);
  ok(by("mail").length === 2 && by("mail").every((r) => r.thread_id === "t1"), "mail events carry the conversation", by("mail"));
  ok(by("mail").map((r) => r.actor).sort().join(",") === "client,spartan", "mail actors are the sides", by("mail").map((r) => r.actor));
  ok(by("onsinch").length === 2 && by("onsinch")[0].order_id === 500 && by("onsinch")[1].order_id === null, "onsinch events carry the order when the row holds one");
  ok(by("trace").filter((r) => r.thread_id === "t1").length === 1 && by("trace").filter((r) => r.thread_id === null).length === 1, "a trace on a thread is keyed to it; a system trace is not", by("trace"));
  ok(by("exit").length === 2 && by("exit").map((r) => r.kind).sort().join(",") === "open,worked", "a card's open and exit are two events", by("exit").map((r) => r.kind));
  ok(by("mark").length === 1 && by("mark")[0].ask_key === "t1:0" && by("exit")[0].ask_key === "t1:0", "marks and exits carry the item key as the ask-pair ancestor");

  console.log("\n[append-only] a rerun adds nothing and rewrites nothing");
  const again = await syncEventLog(sql as never);
  ok(again.added === 0 && again.total === 10, "idempotent", again);
  await sql`UPDATE thread_messages SET is_from_spartan = true WHERE message_id = 'm1'`;
  await syncEventLog(sql as never);
  const kept = (await sql`SELECT kind FROM event_log WHERE source = 'mail' AND ref = 'm1'`) as any[];
  ok(kept[0].kind === "inbound", "a landed event keeps what it was when it happened", kept);

  console.log("\n[replay] one chosen day, one query, one relation");
  const day = (await sql`SELECT source, at FROM event_log WHERE at >= '2026-11-05' AND at < '2026-11-06' ORDER BY at`) as any[];
  ok(day.length === 10 && new Set(day.map((r) => r.source)).size === 6, "the day comes back whole, every source present, in time order", { n: day.length, sources: [...new Set(day.map((r) => r.source))] });

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exitCode = fails ? 1 : 0;
})();
