// ============================================================================
// The comparator says whose word stands: the fold's, the world's, or neither — never a guess.
// ----------------------------------------------------------------------------
// Pure classes pinned: acted + held = settled-confirmed; acted + absent = acted-not-held; open +
// held = done-unacted (the phone/portal half showing itself); open + absent = open; withdrawn
// against both; a cancel is held when its day is gone; value differences name their fields; no
// body or no day = unkeyed, said rather than guessed. Then the sync writes verdicts beside the
// state, and the rolling sweep covers threads nothing refolded.
// npx tsx --require ./test/fixtures/pg.ts test/compare.ts
// ============================================================================
import { sql, clock, syncSqlClock } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { compare, tally } from "../app/lib/v2/fold/compare";
import { syncFold } from "../app/lib/v2/fold/live";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const askS = (key: string, status: "open" | "acted" | "withdrawn", date?: string, values: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ key, akind: "new_shift", date, values, status, opened_at: "2026-11-02T09:00:00Z", proof: [], merged: [], ...extra });
const state = (asks: any[]) => ({ version: "fold-v1", thread_id: "t1", asks, waiting: null, last_event: "e", last_t: "2026-11-02T09:00:00Z", events: 1 }) as any;
const body = (slots: Array<{ day: string; start?: string; size?: number; cancelled?: boolean; place?: number }>) => ({
  Job: [{ SlotTeam: slots.map((s, i) => ({ id: i, Slot: [{ beginning: `${s.day}T${s.start ?? "09:00"}:00+00:00`, end: `${s.day}T17:00:00+00:00`, size: s.size ?? 4, cancelled: !!s.cancelled, SlotLocation: { place_id: s.place ?? 7 } }] })) }],
});

(async () => {
  console.log("\n[classes] fold status x world state");
  const bodies = new Map<number, any>([[500, body([{ day: "2026-11-12", start: "09:00", size: 4 }])]]);
  const v = compare(state([
    askS("a:0", "acted", "2026-11-12", { start: "09:00", crew: 4 }),
    askS("b:0", "acted", "2026-11-13"),
    askS("c:0", "open", "2026-11-12"),
    askS("d:0", "open", "2026-11-14"),
    askS("e:0", "withdrawn", "2026-11-12"),
    askS("f:0", "withdrawn", "2026-11-15"),
    askS("g:0", "open"),
  ]), bodies, [500]);
  const by = Object.fromEntries(v.map((x) => [x.key, x.verdict]));
  ok(by["a:0"] === "settled-confirmed", "acted and held exactly: confirmed", by["a:0"]);
  ok(by["b:0"] === "acted-not-held", "acted but the day is not in the state", by["b:0"]);
  ok(by["c:0"] === "done-unacted", "held with no email-visible act: the invisible half", by["c:0"]);
  ok(by["d:0"] === "open", "not held, no act: genuinely open", by["d:0"]);
  ok(by["e:0"] === "withdrawn-but-held", "withdrawn yet the state holds it", by["e:0"]);
  ok(by["f:0"] === "withdrawn-confirmed", "withdrawn and gone", by["f:0"]);
  ok(by["g:0"] === "unkeyed", "no day named: said, not guessed", by["g:0"]);

  console.log("\n[values] a held day with different values names the fields");
  const v2 = compare(state([askS("h:0", "acted", "2026-11-12", { start: "08:00", crew: 6 })]), bodies, [500]);
  ok(v2[0].held === "adjusted" && (v2[0].differs ?? []).join("+") === "start+crew", "start and crew differ", v2[0]);
  const v2b = compare(state([askS("h2:0", "acted", "2026-11-12", {}, { place_id: 99 })]), bodies, [500]);
  ok((v2b[0].differs ?? []).join() === "venue", "a resolved venue the slots do not hold differs", v2b[0]);

  console.log("\n[cancel] a cancel is held when its day is gone");
  const vc = compare(state([
    { ...askS("i:0", "open", "2026-11-12"), akind: "cancel_shift" },
    { ...askS("j:0", "acted", "2026-11-20"), akind: "cancel_shift" },
  ]), new Map([[500, body([{ day: "2026-11-12" }, { day: "2026-11-20", cancelled: true }])]]), [500]);
  ok(vc[0].verdict === "open" && vc[1].verdict === "settled-confirmed", "live slots keep a cancel open; cancelled slots settle it", vc.map((x) => x.verdict));

  console.log("\n[unkeyed] no reachable body");
  const vn = compare(state([askS("k:0", "acted", "2026-11-12")]), new Map(), []);
  ok(vn[0].verdict === "unkeyed", "an order nothing holds is unkeyed", vn[0]);

  console.log("\n[sync] verdicts land beside the state, and the sweep covers the rest");
  await ensureSchema(sql as never);
  clock.set(Date.parse("2026-11-02T09:00:00Z")); await syncSqlClock();
  await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, is_from_spartan) VALUES ('m1', 't1', 'a@b', '2026-11-02T08:00:00Z', false)`;
  await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, ask, created_at)
    VALUES ('m1', 't1', 'a@b', '2026-11-02T08:00:00Z', 'handoff', '{}'::jsonb,
      ${JSON.stringify({ version: "ask-v1", message_id: "m1", intent: "booking", problems: [], asks: [{ key: "m1:0", kind: "new_shift", values: { date: { value: "2026-11-12", tier: "given" } }, problems: [] }] })}::jsonb,
      '2026-11-02T08:00:30Z')`;
  await sql`INSERT INTO job_links (thread_id, order_id, state) VALUES ('t1', 500, 'linked')`;
  await sql`INSERT INTO onsinch_orders (order_id, number, company_id, body, read_at) VALUES (500, '11500', 9, ${JSON.stringify(body([{ day: "2026-11-12" }]))}::jsonb, now())`;
  const r = await syncFold(sql as never, Date.parse("2026-11-02T09:00:00Z"));
  const row = (await sql`SELECT verdicts, compared_at FROM fold_state WHERE thread_id = 't1'`) as any[];
  ok(row[0].compared_at !== null && row[0].verdicts[0].verdict === "done-unacted", "the verdict is stored: held with no visible act", row[0].verdicts);
  ok((r.verdicts ?? {})["done-unacted"] === 1, "the step reports the tally", r.verdicts);
  ok(tally([{ key: "x", status: "open", held: "exact", verdict: "done-unacted" } as any])["done-unacted"] === 1, "tally counts by verdict");

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exitCode = fails ? 1 : 0;
})();
