// ============================================================================
// Is this need done? The one evaluator (done.ts), the absolute links it rests on (links.ts gradeThread), the
// minute step that marks it (loop/cards.ts markNeeds), and the TV's reads (ADDENDUM §13.2 changes 1, 2, 6).
// ----------------------------------------------------------------------------
// Pinned: staff's work counts only on the need's own job, found by the first rung that holds (a thread's absolute
// reference, a guessed link agreeing with the day and the sender's company, the venue and day, the day alone); two
// candidate jobs with work is "possibly", never done; the work must fit the ask; a deleted order and the bot's own
// writes never count; a cancel undone is no cancel; a new booking already on the order is done; an undated booking
// is the client's order staff made after the email. An R counts only in a message's own words and only on the order
// holding it when the email came; a PO only as a whole token of 6+ characters in the client's words. One TV build
// makes the same number of queries whatever the number of cards.
// npx tsx --require ./test/fixtures/pg.ts test/feedDone.ts
// ============================================================================
import { sql, fault } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { isDone, BOT, type Need, type Order, type Row } from "../app/lib/feed/done";
import { gradeThread, type GradeOrder } from "../app/lib/v2/links";
import { markNeeds } from "../app/lib/v2/loop/cards";
import { serveFeed } from "../app/lib/feed/serve";
import { liveFeedDeps } from "../app/lib/feed/live";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const AT = Date.parse("2026-10-28T09:00:00Z");
const need = (x: Partial<Need> = {}): Need => ({ at: AT, asks: ["change"], fresh: false, days: ["2026-11-04"], places: [], venues: [], company_id: 7, ...x });
const order = (id: number, days: string[], x: Partial<Order> & { place?: number; cancelled?: boolean } = {}): Order => ({
  order_id: id, number: String(11000 + id), company_id: x.company_id ?? 7, deleted: x.deleted ?? false,
  body: { id, Job: [{ id: id * 10, SlotTeam: days.map((d, k) => ({ id: id * 100 + k, Slot: [{ id: id * 1000 + k, beginning: `${d}T09:00:00+00:00`, cancelled: x.cancelled ?? false, SlotLocation: [{ place_id: x.place ?? 50 }] }] })) }] },
});
let rid = 1;
const row = (order_id: number, action: string, data: any, at = "2026-10-28T10:00:00Z", creator: number | null = 413): Row => ({ id: rid++, action, creator, created: at, model: data.model ?? null, model_id: data.id != null ? String(data.id) : null, order_id, data });
const crew = (o: number, slot: number, at?: string, creator?: number) => row(o, "common_change", { model: "Slot", id: slot, diffChanges: { Slot: { size: { old: 2, new: 4 } } } }, at, creator);
const map = (...os: Order[]) => new Map(os.map((o) => [o.order_id, o]));

(async () => {
  console.log("\n[1] the job comes from the first rung that holds, absolute first");
  {
    const a = order(1, ["2026-11-04"]), b = order(2, ["2026-11-04"]);
    const both = map(a, b);
    const rows = [crew(1, 1000), crew(2, 2000)];
    const v = isDone(need(), [{ order_id: 1, absolute: true, ref: "R11001" }], both, rows);
    ok(v.state === "done" && v.orders[0] === 1 && v.rung === "named by the thread", "an R the thread names picks the job, beside another job worked that day", v);
    const g = isDone(need(), [{ order_id: 2, absolute: false, ref: "" }], both, [crew(1, 1000)]);
    ok(g.state === "open", "a guessed link is the job: work on another job that day never clears it", g);
    const off = isDone(need(), [{ order_id: 3, absolute: false, ref: "" }], map(a, order(3, ["2026-11-09"])), [crew(1, 1000), crew(3, 3000)]);
    ok(off.state === "done" && off.orders[0] === 1 && off.rung === "the client's only order that day", "a guessed link holding none of the need's days is passed over for the day", off);
    const other = isDone(need(), [{ order_id: 4, absolute: false, ref: "" }], map(order(4, ["2026-11-04"], { company_id: 99 })), [crew(4, 4000)]);
    ok(other.state === "open", "a guessed link to another company's order is no candidate", other);
    const two = isDone(need(), [], both, rows);
    ok(two.state === "possibly" && /Possibly done in R11001 or R11002: check/.test(two.text), "two of the client's jobs that day, both worked: possibly, never done", two);
    const venue = isDone(need({ places: [60] }), [], map(a, order(2, ["2026-11-04"], { place: 60 })), rows);
    ok(venue.state === "done" && venue.orders[0] === 2 && venue.rung === "the need's venue and day", "the need's venue picks between them", venue);
    const named = isDone(need({ venues: [" The Hall "] }), [], map(a, order(2, ["2026-11-04"], { place: 60 })), rows, (n) => (n.trim().toLowerCase() === "the hall" ? [60] : []));
    ok(named.state === "done" && named.orders[0] === 2, "the client's venue words matched exactly to an OnSinch place name", named);
    const refs = isDone(need(), [{ order_id: 1, absolute: true, ref: "J10" }, { order_id: 5, absolute: true, ref: "PO 123456" }], map(a, order(5, ["2026-10-20"])), [crew(1, 1000)]);
    ok(refs.state === "done" && JSON.stringify(refs.orders) === "[1]", "two references, one an older job: the one holding the day is the need's", refs);
    const po2 = isDone(need({ days: [] }), [{ order_id: 1, absolute: true, ref: "PO 123456" }, { order_id: 2, absolute: true, ref: "PO 123456" }], both, rows);
    ok(po2.state === "possibly", "one PO on two orders and no day: possibly", po2);
  }

  console.log("\n[2] the work must fit the ask, after the email, by a person, on a live order");
  {
    const a = order(1, ["2026-11-04", "2026-11-06"]);
    const L = [{ order_id: 1, absolute: true, ref: "R11001" }];
    ok(isDone(need(), L, map(a), [crew(1, 1000, "2026-10-28T08:00:00Z")]).state === "open", "work before the email is not an answer to it");
    ok(isDone(need(), L, map(a), [crew(1, 1000, undefined, BOT)]).state === "open", "the bot's own write is not staff's work");
    ok(isDone(need(), L, map(a), [crew(1, 1001)]).state === "open", "a change on another day of the order does not answer this day's need");
    ok(isDone(need({ asks: ["cancel"] }), L, map(a), [crew(1, 1000)]).state === "open", "a crew change is not a cancellation");
    ok(isDone(need({ asks: ["change"] }), L, map(a), [row(1, "common_change", { model: "Order", id: 1, diffChanges: { Order: { intern_name: { old: "", new: "PO1" } } } })]).state === "open", "a PO typed in is not the change asked for");
    ok(isDone(need({ asks: ["any"] }), L, map(a), [row(1, "common_change", { model: "Order", id: 1, diffChanges: { Order: { intern_name: { old: "", new: "PO1" } } } })]).state === "done", "an ask with no kind takes any booking edit");
    const c = isDone(need({ asks: ["cancel"] }), L, map(a), [row(1, "order_cancel", { model: "Order", id: "11001", data: { automated: true } })]);
    ok(c.state === "done" && /cancelled the order/.test(c.text), "staff's cancel counts, though OnSinch marks it automated", c);
    ok(isDone(need({ asks: ["cancel"] }), L, map(a), [row(1, "order_cancel", { model: "Order", id: "11001" }), row(1, "order_uncancel", { model: "Order", id: "11001" }, "2026-10-28T11:00:00Z")]).state === "open", "a cancel undone is no cancel");
    ok(isDone(need(), L, map(order(1, ["2026-11-04"], { deleted: true })), [crew(1, 1000)]).state === "open", "a deleted order never counts: a create then a delete is no booking");
    ok(isDone(need({ asks: ["book"] }), L, map(order(1, ["2026-11-04"], { cancelled: true })), [row(1, "order_create", { model: "Order", id: "1" })]).state === "done", "a cancelled shift still names the job its need was about");
  }

  console.log("\n[3] new bookings: already on the order, or made after an undated email");
  {
    const a = order(1, ["2026-11-04", "2026-11-06"]);
    const v = isDone(need({ asks: ["book"], fresh: true, days: ["2026-11-04", "2026-11-06"] }), [], map(a), []);
    ok(v.state === "done" && /booked it before the email/.test(v.text) && v.at === null, "a new booking every day of which the client's order already held: done, with no staff moment", v);
    ok(isDone(need({ asks: ["book"], fresh: true, days: ["2026-11-04", "2026-11-09"] }), [], map(a), []).state === "open", "one day not on it: open");
    ok(isDone(need({ asks: ["book"], fresh: false, days: ["2026-11-04"] }), [], map(a), []).state === "open", "a change to an order is never done by the order existing");
    const made = row(2, "order_create", { model: "Order", id: "2" }, "2026-10-28T09:10:00Z");
    const u = isDone(need({ asks: ["book"], fresh: true, days: [] }), [], map(a, order(2, ["2026-11-20"])), [made]);
    ok(u.state === "done" && u.orders[0] === 2 && u.rung === "the client's order made after the email", "an undated booking: the client's order staff made after the email", u);
    const late = row(2, "order_create", { model: "Order", id: "2" }, "2026-11-03T09:10:00Z");
    ok(isDone(need({ asks: ["book"], fresh: true, days: [] }), [], map(a, order(2, ["2026-11-20"])), [late]).state === "open", "made more than 96 hours later: not this email's");
    const two = isDone(need({ asks: ["book"], fresh: true, days: [] }), [], map(order(2, ["2026-11-20"]), order(3, ["2026-11-21"])), [made, row(3, "order_create", { model: "Order", id: "3" }, "2026-10-28T09:20:00Z")]);
    ok(two.state === "possibly", "two made after it: possibly", two);
    ok(isDone(need({ days: [], asks: ["change"] }), [], map(a), [crew(1, 1000)]).state === "open", "an undated change with nothing naming its job stays open");
  }

  console.log("\n[4] absolute references (links.ts gradeThread)");
  {
    const o = (id: number, number: string, x: Partial<GradeOrder> = {}): GradeOrder => ({ order_id: id, number, company_id: 7, po: null, jobs: [id * 10], made: Date.parse("2026-10-01T00:00:00Z"), deleted: false, ...x });
    const m = (body: string, x: { ours?: boolean; subject?: string; at?: string } = {}) => ({ at: Date.parse(x.at ?? "2026-10-28T09:00:00Z"), ours: !!x.ours, subject: x.subject ?? "Re: crew", body });
    const ids = (g: { links: Array<{ order_id: number }> }) => g.links.map((l) => l.order_id).sort();
    ok(JSON.stringify(ids(gradeThread([m("Please add 2 to R11001 thanks")], [o(1, "11001")], [], [7]))) === "[1]", "an R in the client's own words");
    ok(!gradeThread([m("Thanks\n\nOn Mon, 26 Oct 2026, Ops wrote:\n> R11001 is booked")], [o(1, "11001")], [], [7]).links.length, "an R only in quoted history is another thread's");
    ok(JSON.stringify(ids(gradeThread([m("We have added this to R11001", { ours: true })], [o(1, "11001")], [], [7]))) === "[1]", "an R in our own message on the thread");
    ok(!gradeThread([m("R11001 please")], [o(1, "11001", { made: Date.parse("2026-10-29T00:00:00Z") })], [], [7]).links.length, "an R reused by an order made after the email names nothing");
    ok(!gradeThread([m("R11001 please")], [o(1, "11001", { deleted: true })], [], [7]).links.length, "a deleted order names nothing");
    ok(JSON.stringify(ids(gradeThread([m("for job J16915 please")], [o(1, "11001", { jobs: [16915] })], [], [7]))) === "[1]", "a J names the order holding the job");
    const po = [o(1, "11001", { po: "*INV-12397 / ^INV-12450" }), o(2, "11002", { po: "4521" })];
    ok(JSON.stringify(ids(gradeThread([m("PO number INV-12450 for this one")], po, [], [7]))) === "[1]", "a PO token equal to one of an order's PO tokens, staff's markers off");
    ok(!gradeThread([m("track it at https://x.example/p/4521 or ref 4521")], po, [], [7]).links.length, "a PO under 6 characters, or inside a link, is no PO");
    ok(!gradeThread([m("your PO INV-12450", { ours: true })], po, [], [7]).links.length, "a PO in our words only is not the client naming the job");
    ok(JSON.stringify(ids(gradeThread([m("hi")], [o(1, "11001")], [1], [7]))) === "[1]" && gradeThread([m("hi")], [o(1, "11001")], [1], [7]).links[0].proof === "the bot's own order", "the bot's own order");
    ok(/another company's order/.test(String(gradeThread([m("R11001")], [o(1, "11001", { company_id: 9 })], [], [7]).conflict)), "an order of another company than the sender's: a conflict");
    ok(/the bot's order is not the one the PO names/.test(String(gradeThread([m("PO INV-12450")], [...po, o(3, "11003")], [3], [7]).conflict)), "the bot's order beside a PO naming another: a conflict");
    ok(JSON.stringify(ids(gradeThread([m("PO INV-12450 and PO ABC-99999")], [...po, o(3, "11003", { po: "ABC-99999" })], [], [7]))) === "[1,3]", "one email naming several orders links each");
  }

  console.log("\n[5] the minute step marks needs, and the TV reads only the marks");
  {
    await ensureSchema(sql as any);
    const NOW = Date.parse("2026-10-28T12:00:00Z");
    const decision = { kind: "handoff", reasons: ["x"], ops: [] };
    const grounded = (date: string) => ({ intent: "change", requests: [{ action: "change_crew", date, crew: 4, problems: [] }] });
    const seed = async (n: number) => {
      for (let k = 0; k < n; k++) {
        await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, interpretation, code_version, created_at)
          VALUES (${`m${n}-${k}`}, ${`t${n}-${k}`}, 'ops@north.example', '2026-10-28T09:00:00Z', 'handoff', ${JSON.stringify(decision)}::jsonb, ${JSON.stringify({ grounded: grounded("2026-11-04") })}::jsonb, 'abc', '2026-10-28T09:00:00Z')`;
        await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, subject, is_from_spartan) VALUES (${`m${n}-${k}`}, ${`t${n}-${k}`}, 'ops@north.example', '2026-10-28T09:00:00Z', 'crew', false)`;
      }
    };
    await sql`INSERT INTO onsinch_contacts (email, company_id, company_name, refreshed_at) VALUES ('ops@north.example', 7, 'North', now())`;
    await sql`INSERT INTO onsinch_orders (order_id, number, company_id, body, read_at) VALUES (1, '11001', 7, ${JSON.stringify(order(1, ["2026-11-04"]).body)}::jsonb, now())`;
    await sql`INSERT INTO onsinch_timeline (id, action, creator, created, model, model_id, order_id, data) VALUES
      (900001, 'common_change', 413, '2026-10-28T10:00:00Z', 'Slot', '1000', 1, ${JSON.stringify({ model: "Slot", id: 1000, diffChanges: { Slot: { size: { old: 2, new: 4 } } } })}::jsonb)`;
    await seed(1);
    const r = await markNeeds(sql as any, null, (await liveFeedDeps().v2!()) as any, NOW);
    const marks = (await sql`SELECT item_key, mark, evidence, at FROM feed_marks WHERE mark IN ('done', 'possibly')`) as any[];
    ok(r.done === 1 && marks.length === 1 && marks[0].mark === "done" && /R11001, staff changed the crew/.test(marks[0].evidence.text), "the need is marked done with what staff did", { r, marks });
    ok(new Date(marks[0].at).toISOString() === "2026-10-28T10:00:00.000Z", "dated when staff did it, not when the sync saw it", marks[0].at);
    const tv = await serveFeed({ ...liveFeedDeps(), jobs: undefined, remember: undefined }, NOW);
    ok(tv.status === 200 && (tv.all ?? []).some((c) => c.green), "the TV shows it green from the mark alone", tv.status);

    const count = async () => { let n = 0; fault.when = () => { n++; return false; }; await serveFeed({ ...liveFeedDeps(), jobs: undefined, remember: undefined }, NOW); fault.when = null; return n; };
    const one = await count();
    await seed(20);
    const many = await count();
    ok(one === many && one > 0, `one TV build makes the same number of queries for 1 card and 21 (${one}, ${many})`, { one, many });
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
