// ============================================================================
// The sync's fold step keeps fold_state equal to a full refold, touching only what moved.
// ----------------------------------------------------------------------------
// Pinned: a new reading folds its thread; a timeline act on a linked order refolds the thread; an
// untouched thread is not rewritten (folded_at stands); the daily refold-and-diff passes on a clean
// table, throws on a hand-corrupted row, and runs at most once a day; a version bump refolds all.
// fold-v2: an act's days reach the fold through both channels — a Slot beginning diff names its own
// day (zoneless strings are UTC: a 23:30 UTC June slot is the NEXT London day), and a diffless row
// reaches one through model_id and the order's stored body — and each act then touches only its day.
// npx tsx --require ./test/fixtures/pg.ts test/foldSync.ts
// ============================================================================
import { sql, clock, syncSqlClock } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { syncFold, DIFF_EVERY_MS } from "../app/lib/v2/fold/live";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const T0 = Date.parse("2026-11-02T09:00:00Z");
const at = async (ms: number) => { clock.set(ms); await syncSqlClock(); };
const MIN = 60_000;
const ask = (mid: string, date: string) => JSON.stringify({ version: "ask-v1", message_id: mid, intent: "booking", problems: [], asks: [{ key: `${mid}:0`, kind: "new_shift", values: { date: { value: date, tier: "given" } }, problems: [] }] });

(async () => {
  await ensureSchema(sql as never);
  await at(T0);
  await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, is_from_spartan) VALUES ('m1', 't1', 'a@b', '2026-11-02T08:00:00Z', false)`;
  await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, ask, created_at)
    VALUES ('m1', 't1', 'a@b', '2026-11-02T08:00:00Z', 'handoff', '{}'::jsonb, ${ask("m1", "2026-11-12")}::jsonb, '2026-11-02T08:00:30Z')`;

  console.log("\n[moved] a new reading folds its thread");
  const r1 = await syncFold(sql as never, T0);
  const s1 = (await sql`SELECT thread_id, state, folded_at::text f FROM fold_state`) as any[];
  ok(r1.refolded === 1 && s1.length === 1 && s1[0].state.asks.length === 1, "one thread folded, one ask", r1);
  ok(r1.drift === 0, "the first run also ran the daily diff, clean", r1);

  console.log("\n[untouched] nothing moved, nothing rewritten");
  await at(T0 + MIN);
  const r2 = await syncFold(sql as never, T0 + MIN);
  const s2 = (await sql`SELECT folded_at::text f FROM fold_state WHERE thread_id = 't1'`) as any[];
  ok(r2.refolded === 0 && s2[0].f === s1[0].f, "folded_at stands", { r2, was: s1[0].f, now: s2[0].f });
  ok(!("drift" in r2), "the diff does not run again inside a day", r2);

  console.log("\n[act] a timeline act on a linked order refolds the thread");
  await sql`INSERT INTO job_links (thread_id, order_id, state) VALUES ('t1', 500, 'linked')`;
  await at(T0 + 2 * MIN);
  await sql`INSERT INTO onsinch_timeline (id, action, creator, created, order_id, data) VALUES (901, 'common_change', 7, '2026-11-02T09:01:00Z', 500, '{}'::jsonb)`;
  const r3 = await syncFold(sql as never, T0 + 2 * MIN);
  const s3 = (await sql`SELECT state FROM fold_state WHERE thread_id = 't1'`) as any[];
  ok(r3.refolded === 1 && s3[0].state.asks[0].status === "acted" && s3[0].state.asks[0].proof.includes(901), "the ask is acted with the row as proof", s3[0].state.asks[0]);

  console.log("\n[days] a dated act touches only its day, through both channels");
  await at(T0 + 3 * MIN);
  const asks3 = JSON.stringify({ version: "ask-v1", message_id: "m2", intent: "booking", problems: [], asks: [
    { key: "m2:0", kind: "new_shift", values: { date: { value: "2026-11-12", tier: "given" } }, problems: [] },
    { key: "m2:1", kind: "new_shift", values: { date: { value: "2026-11-14", tier: "given" } }, problems: [] },
    { key: "m2:2", kind: "new_shift", values: { date: { value: "2027-06-11", tier: "given" } }, problems: [] },
  ] });
  await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, is_from_spartan) VALUES ('m2', 't2', 'a@b', '2026-11-02T08:30:00Z', false)`;
  await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, ask, created_at)
    VALUES ('m2', 't2', 'a@b', '2026-11-02T08:30:00Z', 'handoff', '{}'::jsonb, ${asks3}::jsonb, '2026-11-02T09:03:00Z')`;
  await sql`INSERT INTO job_links (thread_id, order_id, state) VALUES ('t2', 600, 'linked')`;
  await sql`INSERT INTO onsinch_orders (order_id, body, read_at) VALUES (600,
    ${JSON.stringify({ id: 600, Job: [{ SlotTeam: [{ id: 5, Slot: [{ id: 77, beginning: "2026-11-14T09:00:00+00:00" }] }] }] })}::jsonb, '2026-11-02T09:03:00Z')`;
  await sql`INSERT INTO onsinch_timeline (id, action, creator, created, order_id, model, model_id, data) VALUES
    (902, 'common_change', 7, '2026-11-02T09:05:00Z', 600, 'Slot', '88', ${JSON.stringify({ diffChanges: { Slot: { beginning: { old: "2026-11-12 09:00:00", new: "2026-11-12 10:00:00" } } } })}::jsonb),
    (903, 'common_change', 7, '2026-11-02T09:06:00Z', 600, 'Slot', '77', '{}'::jsonb),
    (904, 'common_change', 7, '2026-11-02T09:07:00Z', 600, 'Slot', '89', ${JSON.stringify({ diffChanges: { Slot: { beginning: { old: "2027-06-10 23:30:00", new: "2027-06-10 23:30:00" } } } })}::jsonb)`;
  const r4 = await syncFold(sql as never, T0 + 3 * MIN);
  const s4 = (await sql`SELECT state FROM fold_state WHERE thread_id = 't2'`) as any[];
  const byDate = Object.fromEntries((s4[0].state.asks as any[]).map((a) => [a.date, a]));
  ok(r4.refolded === 1 && (s4[0].state.asks as any[]).every((a) => a.status === "acted"), "all three asks acted, each by its own day's act", s4[0].state.asks);
  ok(byDate["2026-11-12"].proof.join() === "902", "a beginning diff names the act's day; the other days' acts never touch it", byDate["2026-11-12"]?.proof);
  ok(byDate["2026-11-14"].proof.join() === "903", "a diffless Slot row reaches its day through model_id and the stored body", byDate["2026-11-14"]?.proof);
  ok(byDate["2027-06-11"].proof.join() === "904", "a zoneless 23:30 UTC beginning lands on the next London day in summer", byDate["2027-06-11"]?.proof);
  ok((s4[0].state.orders ?? []).join() === "600", "the link is an event: the state carries the order roster", s4[0].state.orders);

  console.log("\n[drift] a corrupted row makes the daily diff throw");
  await sql`UPDATE fold_state SET state = jsonb_set(state, '{waiting}', '"client"') WHERE thread_id = 't1'`;
  await at(T0 + DIFF_EVERY_MS + 3 * MIN);
  let threw = "";
  try { await syncFold(sql as never, T0 + DIFF_EVERY_MS + 3 * MIN); } catch (e) { threw = String((e as Error).message); }
  ok(/1 of 2 threads differ/.test(threw), "the diff names the drift and throws", threw);
  const r5 = await syncFold(sql as never, T0 + DIFF_EVERY_MS + 4 * MIN);
  ok(!("drift" in r5), "the failed diff still counts as run: no re-throw storm every minute", r5);

  console.log("\n[version] a stale fold_version refolds without new events");
  await sql`UPDATE fold_state SET fold_version = 'fold-v0' WHERE thread_id = 't1'`;
  const r6 = await syncFold(sql as never, T0 + DIFF_EVERY_MS + 5 * MIN);
  const v = (await sql`SELECT fold_version FROM fold_state WHERE thread_id = 't1'`) as any[];
  ok(r6.refolded === 1 && v[0].fold_version !== "fold-v0", "the bump is healed", { r6, v: v[0] });

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exitCode = fails ? 1 : 0;
})();
