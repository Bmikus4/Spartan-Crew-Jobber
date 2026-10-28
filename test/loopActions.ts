// ============================================================================
// Each staff action is recorded once, with whether the TV showed it first, how a moved start was moved, and
// whether a new order breaks one order per venue (ADDENDUM §12.2, §12.5, P2.5).
// ----------------------------------------------------------------------------
// Pure parts, then the minute step on PGlite with a fake OnSinch. Pinned: an action is one person's changes to one
// order with no 30-minute gap; it is recorded once, only after 30 minutes have passed inside the stored timeline;
// coverage is read from emails by their senders' contact companies, never the resolver; a moved start is counted
// as the length kept, the end kept, or neither; a multi-venue order and a same-venue split are categorised by what
// OnSinch holds; the test company and an order gone from OnSinch are said, not judged; a failed read throws and the
// action waits.
// npx tsx --require ./test/fixtures/pg.ts test/loopActions.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { actionDays, coverage, decisionDays, exceptionOf, groupActs, movedStarts, recordActions } from "../app/lib/v2/loop/actions";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const at = (s: string) => `2026-10-20T${s}:00.000Z`;
const act = (row_id: number, by: number, order_id: number, time: string, extra: Record<string, unknown> = {}) => ({ row_id, at: at(time), by, what: "edit Slot.size", order_id, number: "", company_id: 0, model: "Slot", model_id: 1, ...extra });
const slot = (id: number, day: string, place: number, start = "08:00", end = "16:00") => ({ id, beginning: `${day}T${start}:00+00:00`, end: `${day}T${end}:00+00:00`, size: 2, profession_id: "7", role: 0, cancelled: false, SlotLocation: { place_id: place } });
const order = (id: number, number: number, slots: any[], o: Record<string, unknown> = {}) => ({ id, number, company_id: 900, user_id: 5, name: "North @ Hall", intern_name: "PO1", status: 1, Job: [{ id: id * 10, SlotTeam: slots.map((s, i) => ({ id: id * 100 + i, Slot: [s] })) }], ...o });

(async () => {
  console.log("\n[pure] one action, its days, its moved starts");
  {
    const g = groupActs([act(1, 7, 500, "09:00"), act(2, 7, 500, "09:20"), act(3, 7, 500, "10:00"), act(4, 8, 500, "09:10"), act(5, 7, 501, "09:05")] as any);
    const shape = g.map((x) => `${x.order_id}/${x.by}:${x.ids.join(",")}`).sort().join(" ");
    ok(shape === "500/7:1,2 500/7:3 500/8:4 501/7:5", "split by person, by order, and where 30 minutes pass", shape);
    const o = order(500, 11500, [slot(1, "2026-10-27", 205), slot(2, "2026-10-28", 205)]);
    ok(JSON.stringify(actionDays({ acts: [act(1, 7, 500, "09:00")] as any }, o)) === '["2026-10-27"]', "a position edit touches its position's day");
    ok(JSON.stringify(actionDays({ acts: [{ ...act(1, 7, 500, "09:00"), what: "create order", model: "Order" }] as any }, o)) === '["2026-10-27","2026-10-28"]', "a create touches every day the order holds");
    const m = movedStarts({ acts: [
      act(1, 7, 500, "09:00", { what: "edit Slot.beginning+Slot.end", changes: { beginning: { old: "2026-10-27 08:00:00", new: "2026-10-27 10:00:00" }, end: { old: "2026-10-27 16:00:00", new: "2026-10-27 18:00:00" } } }),
      act(2, 7, 500, "09:01", { what: "edit Slot.beginning", changes: { beginning: { old: "2026-10-27 08:00:00", new: "2026-10-27 09:00:00" } } }),
      act(3, 7, 500, "09:02", { what: "edit Slot.beginning+Slot.end", changes: { beginning: { old: "2026-10-27 08:00:00", new: "2026-10-27 07:00:00" }, end: { old: "2026-10-27 16:00:00", new: "2026-10-27 20:00:00" } } }),
    ] as any });
    ok(JSON.stringify(m) === '{"length":1,"end":1,"other":1}', "the length kept, the end kept, and a new window", m);
    ok(movedStarts({ acts: [act(1, 7, 500, "09:00")] as any }) === null, "no start moved: nothing counted");
    ok(JSON.stringify(decisionDays({ ops: [{ op: { kind: "create_order", shifts: [{ date: "2026-10-30" }] } }] }, [{ target: { date: "2026-10-27" } }])) === '["2026-10-27","2026-10-30"]', "a decision's days: its operations' and its reading's");
  }

  console.log("\n[pure] coverage, by the sender's contact company");
  {
    const dom = new Set(["north.example"]);
    const e = (id: string, from: string, companies: number[], kind: string | null, days: string[]) => ({ message_id: id, from, companies, kind, days });
    ok(coverage(["2026-10-27"], 900, dom, [e("a", "x@north.example", [900], "handoff", ["2026-10-27"])]).bucket === "a card named the day", "a card for the client naming the day");
    ok(coverage(["2026-10-27"], 900, dom, [e("a", "x@north.example", [900], "write", ["2026-11-02"])]).bucket === "a card for the client, another day", "a card for another day");
    ok(coverage(["2026-10-27"], 900, dom, [e("a", "x@north.example", [900], "handoff", [])]).bucket === "a card for the client, naming no day", "a card whose reading kept no day");
    ok(coverage(["2026-10-27"], 900, dom, [e("a", "x@north.example", [900], "none", ["2026-10-27"])]).bucket === "a client email, no card", "an email read as nothing to do");
    ok(coverage(["2026-10-27"], 900, dom, [e("a", "new@north.example", [], "write", ["2026-10-27"])]).bucket.startsWith("can't tell"), "a sender on the client's domain who is no contact: can't tell");
    ok(coverage(["2026-10-27"], 900, dom, [e("a", "y@other.example", [901], "write", ["2026-10-27"])]).bucket === "no client email in the 7 days before", "another client's email is not this client's");
  }

  console.log("\n[pure] one order per venue, and its exceptions");
  {
    const names = (id: number) => ({ 205: "Olympia Grand Hall", 206: "Olympia National", 300: "North Depot", 400: "ExCeL" } as Record<number, string>)[id] ?? "";
    const multi = exceptionOf(order(600, 11600, [slot(1, "2026-10-27", 205), slot(2, "2026-11-05", 206)]), [], names);
    ok(multi?.kind === "multi-venue" && JSON.stringify(multi.categories) === '["a week or more between days","the venues share a site word"]', "two venues a week apart on one site", multi);
    const depot = exceptionOf(order(601, 11601, [slot(1, "2026-10-27", 205), slot(2, "2026-10-27", 300)]), [], names);
    ok(JSON.stringify(depot?.categories) === '["a depot or warehouse"]', "a venue and a depot", depot);
    const prior = order(602, 11602, [slot(1, "2026-10-20", 400)], { intern_name: "PO9", name: "North week 1" });
    const split = exceptionOf(order(603, 11603, [slot(1, "2026-10-28", 400)]), [prior], names);
    ok(split?.kind === "same-venue split" && split.other === "11602" && JSON.stringify(split.categories) === '["PO differs","order name differs","a week or more between days"]', "a second order at the same venue 8 days on: PO, name and a week", split);
    ok(exceptionOf(order(604, 11604, [slot(1, "2026-12-20", 400)]), [prior], names) === null, "control: the same venue two months on is no split");
    ok(exceptionOf(order(605, 11605, [slot(1, "2026-10-21", 400)]), [{ ...prior, status: -1 }], names) === null, "control: a cancelled order is not one to split from");
  }

  console.log("\n[step] recorded once 30 minutes have passed; classified from the emails before it");
  {
    await ensureSchema(sql as any);
    const ORDERS: Record<number, any> = { 500: order(500, 11500, [slot(9001, "2026-10-27", 205)]), 700: { ...order(700, 11700, [slot(9301, "2026-10-29", 205)]), company_id: 515 } };
    let down = false, reads = 0;
    const t = (async (_m: string, path: string) => {
      if (down) return { status: 502, data: null };
      reads++;
      const id = /id\[eq\]=(\d+)/.exec(path)?.[1];
      if (id) return { status: 200, data: { data: ORDERS[Number(id)] ? [ORDERS[Number(id)]] : [], pagination: { pageCount: 1, count: 1 } } };
      return { status: 200, data: { data: [], pagination: { pageCount: 0, count: 0 } } };
    }) as any;
    await sql`INSERT INTO onsinch_contacts (email, company_id, company_name, refreshed_at) VALUES ('ops@north.example', 900, 'North Events', now()), ('t@test.example', 515, 'TEST - Eventz', now())`;
    await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, body, is_from_spartan) VALUES ('e1', 't1', 'Ops <ops@north.example>', '2026-10-20T08:00:00Z', 'x', false)`;
    await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, code_version) VALUES ('e1', 't1', 'ops@north.example', '2026-10-20T08:00:00Z', 'handoff', ${JSON.stringify({ kind: "handoff", reasons: ["x"], ops: [] })}::jsonb, 'abc')`;
    await sql`UPDATE v2_decisions SET interpretation = ${JSON.stringify({ grounded: { requests: [{ date: "2026-10-27" }] } })}::jsonb WHERE message_id = 'e1'`;
    const row = (id: number, order_id: number, created: string, by = 413) => sql`INSERT INTO onsinch_timeline (id, action, creator, created, model, model_id, order_id, data)
      VALUES (${id}, 'common_change', ${by}, ${created}::timestamptz, 'Slot', ${String(order_id === 500 ? 9001 : order_id === 700 ? 9301 : 9401)}, ${order_id}, ${JSON.stringify({ id: String(order_id === 500 ? 9001 : order_id === 700 ? 9301 : 9401), model: "Slot", diffChanges: { Slot: { size: { old: "1", new: "2" } } } })}::jsonb)`;
    await row(1, 500, "2026-10-20T09:00:00Z"); await row(2, 500, "2026-10-20T09:10:00Z");
    await row(3, 700, "2026-10-20T09:30:00Z");
    await row(4, 800, "2026-10-20T09:40:00Z");
    await row(5, 500, "2026-10-20T11:50:00Z");
    await sql`INSERT INTO v2_loop_meta (key, value) VALUES ('timeline_complete_at', '"2026-10-20T12:00:00.000Z"'::jsonb)`;
    down = true;
    const err = await recordActions(sql as any, t).then(() => "no throw", (e) => String(e.message));
    down = false;
    const n0 = (await sql`SELECT count(*)::int AS n, count(classified_at)::int AS c FROM v2_staff_actions`) as any[];
    ok(/answered 502/.test(err) && n0[0].n === 3 && n0[0].c === 0, "recorded, then a failed read throws and nothing is classified", { err, n0 });
    const r = await recordActions(sql as any, t);
    const rows = new Map(((await sql`SELECT * FROM v2_staff_actions`) as any[]).map((x) => [Number(x.order_id), x]));
    ok(rows.get(500)?.rows === 2 && rows.get(500)?.bucket === "a card named the day" && rows.get(500)?.message_id === "e1", "two edits ten minutes apart are one action, covered by the hand-off naming its day", rows.get(500));
    ok(rows.get(700)?.bucket === "test company", "the test company is said, not judged", rows.get(700));
    ok(rows.get(800)?.bucket === "can't tell: the order is gone from OnSinch", "an order OnSinch no longer has", rows.get(800));
    ok(!rows.has(0) && [...rows.values()].filter((x) => Number(x.order_id) === 500).length === 1, "the edit at 11:50 is still within 30 minutes of the timeline's end: not recorded yet", [...rows.keys()]);
    await sql`UPDATE v2_loop_meta SET value = '"2026-10-20T13:00:00.000Z"'::jsonb WHERE key = 'timeline_complete_at'`;
    await recordActions(sql as any, t);
    const later = (await sql`SELECT first_id FROM v2_staff_actions WHERE order_id = 500 ORDER BY first_id`) as any[];
    ok(later.map((x) => Number(x.first_id)).join(",") === "1,5", "an hour on, the 11:50 edit is its own action, and the first is not recorded again", later);
    void r; void reads;
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
