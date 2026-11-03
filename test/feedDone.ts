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
import { gradeThread, linkAbsolute, type GradeOrder } from "../app/lib/v2/links";
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
    // 1 Nov: "possibly R11773 or R11785" for 12 days while the reading had matched R11773's place.
    const tie = isDone(need({ readPlaces: [60] }), [], map(a, order(2, ["2026-11-04"], { place: 60 })), rows);
    ok(tie.state === "done" && tie.orders[0] === 2, "two jobs that day, both worked: the one at the place the reading matched", tie);
    const notThere = isDone(need({ readPlaces: [61] }), [], both, rows);
    ok(notThere.state === "possibly", "neither at the reading's place: still possibly", notThere);
    // The reading's place is a tie-break, never a filter: one was the unused duplicate 7083 where staff booked 205.
    const guess = isDone(need({ readPlaces: [61] }), [{ order_id: 2, absolute: false, ref: "" }], both, [crew(2, 2000)]);
    ok(guess.state === "done" && guess.orders[0] === 2, "a guessed link's job is not dropped for being away from the reading's place", guess);
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
    ok(/belongs to another company/.test(String(gradeThread([m("R11001")], [o(1, "11001", { company_id: 9 })], [], [7]).conflict)), "an order of another company than the sender's: a conflict");
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

    const keyOf = async (thread: string) => ((await serveFeed({ ...liveFeedDeps(), jobs: undefined, remember: undefined }, NOW)).all ?? []).find((c) => c.thread_id === thread)!.items[0].item_key;
    await sql`INSERT INTO feed_marks (item_key, thread_id, mark, evidence) VALUES (${await keyOf("t20-0")}, 't20-0', 'agreed', ${JSON.stringify({ text: "Quote sent on 2026-10-28: waiting for the client to confirm" })}::jsonb),
      (${await keyOf("t20-1")}, 't20-1', 'agreed', ${JSON.stringify({ text: "Agreed: the client accepted Spartan's quote" })}::jsonb)`;
    await markNeeds(sql as any, null, (await liveFeedDeps().v2!()) as any, NOW);
    const kept = ((await sql`SELECT thread_id FROM feed_marks WHERE mark = 'agreed' AND thread_id IN ('t20-0', 't20-1')`) as any[]).map((m) => m.thread_id);
    ok(JSON.stringify(kept) === '["t20-1"]', "a quote waiting on the client is read again each minute; an agreement is kept", kept);
  }

  console.log("\n[6] an order OnSinch no longer returns, and the re-plan's reading (1 Nov)");
  {
    // The bot's test order 16797 had no body; read as live, its unknown company was "another company" and the conflict
    // held a need open 102 h after staff did the work.
    await sql`INSERT INTO onsinch_orders (order_id, number, company_id, body, read_at) VALUES (16797, NULL, NULL, NULL, now())`;
    await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan) VALUES ('g1', 'tg', 'ops@north.example', '2026-10-28T09:00:00Z', 'crew', 'add 2 please', false)`;
    await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, executed, code_version, created_at)
      VALUES ('g1', 'tg', 'ops@north.example', '2026-10-28T09:00:00Z', 'write', ${JSON.stringify({ kind: "write", ops: [], why: [] })}::jsonb, ${JSON.stringify([{ status: "verified", detail: { order_id: 16797 } }])}::jsonb, 'abc', '2026-10-28T09:00:00Z')`;
    const la = await linkAbsolute(sql as any, { dry: true });
    ok(!la.conflicts.tg, "the bot's order OnSinch no longer returns is gone: no conflict with the sender's company", la.conflicts);

    // A "Tue 28 Sep" of 12 Oct stored as 2027 before O22; the re-plan reads it as 2026, a passed day, so the card leaves.
    const handoff = { kind: "handoff", reasons: ["a request is for 2026-09-28, before the email was sent"], ops: [] };
    const read = (date: string | null) => ({ intent: "change", requests: [{ action: "change_times", date, start: "10:00", end: "14:00", problems: [] }] });
    for (const [id, replanDate] of [["old", "2026-09-28"], ["keep", null]] as const) {
      await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, interpretation, replan, code_version, created_at)
        VALUES (${id}, ${`t-${id}`}, 'ops@north.example', '2026-10-27T09:00:00Z', 'handoff', ${JSON.stringify(handoff)}::jsonb, ${JSON.stringify({ grounded: read("2027-09-28") })}::jsonb,
          ${JSON.stringify({ ...handoff, grounded: read(replanDate) })}::jsonb, 'abc', '2026-10-27T09:00:00Z')`;
      await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, subject, is_from_spartan) VALUES (${id}, ${`t-${id}`}, 'ops@north.example', '2026-10-27T09:00:00Z', 'crew', false)`;
    }
    const tv = await serveFeed({ ...liveFeedDeps(), jobs: undefined, remember: undefined }, Date.parse("2026-10-28T12:00:00Z"));
    const listed = (((tv.body as any).items ?? []) as any[]).map((c) => c.thread_id);
    ok(!listed.includes("t-old"), "the re-plan's reading names the day: a passed day, off the TV", listed);
    ok(listed.includes("t-keep"), "a re-plan reading with no day leaves the stored day (a card with no day would never leave)", listed);
  }

  console.log("\n[7] agreed: the client accepted Spartan's quote or terms, and OnSinch holds them (the owner, 1 Nov)");
  {
    const MIN = 60_000;
    const a = order(1, ["2026-11-04"]);
    const L = [{ order_id: 1, absolute: true, ref: "R11001" }];
    const msg = (min: number, ours: boolean, text: string, asks = false) => ({ at: AT + min * MIN, ours, text, asks });
    const ask = msg(0, false, "Please may I request for the call time to be 2-hours only instead of 3", true);
    const terms = msg(6, true, "Hi, Due to the location, the call time is subject to a 3-hour minimum.\n*Please note, all quotes sent from this account are valid for 14 days");
    const yes = msg(24, false, "No worries, please can I confirm this. See PO attached.");
    const v = isDone(need(), L, map(a), [], undefined, [ask, terms, yes]);
    ok(v.state === "agreed" && /terms/.test(v.text) && v.at === new Date(AT + 24 * MIN).toISOString(), "a change refused for a minimum, and the client's yes: agreed, as of the yes", v);
    const quote = msg(-60 * 24 * 40, true, "No problem at all, please see quote attached.");
    const own = isDone(need({ asks: ["change"] }), L, map(a), [], undefined, [quote, msg(-60 * 24 * 40 + 20, true, "There's no rush at all as the event is in November."), msg(0, false, "May I confirm this quote with you.")]);
    ok(own.state === "agreed" && /quote/.test(own.text), "the need's own email confirms an earlier quote, a note after the quote changing nothing: agreed", own);
    ok(isDone(need(), L, map(a), [], undefined, [ask, msg(6, true, "Yes, we can do that, all updated."), yes]).state === "open", "Spartan saying it will do it is no offer: the work is still owed");
    ok(isDone(need(), L, map(a), [crew(1, 1000, new Date(AT + 30 * MIN).toISOString())], undefined, [ask, terms, yes]).state !== "agreed", "a shift changed after the offer: the offer is not what OnSinch holds");
    ok(isDone(need(), L, map(a), [], undefined, [ask, terms, msg(24, false, "Please can I confirm this and change the timing to 10-2", true)]).state === "open", "a yes that asks for something too: open");
    ok(isDone(need(), L, map(a), [], undefined, [ask, terms, msg(10, false, "Can we also add a driver?", true), yes]).state === "open", "the client asked for more after the offer: open");
    ok(isDone(need(), L, map(order(1, ["2026-11-04"], {}), ...[]), [], undefined, [ask, terms]).state === "open", "terms and no yes: open");
    const prov = order(1, ["2026-11-04"]); prov.body.provisional = true;
    ok(isDone(need(), L, map(prov), [], undefined, [ask, terms, yes]).state === "open", "a provisional order is staff's to confirm after the yes: open");
    const inQuotes = order(1, ["2026-11-04"]); inQuotes.body.quote = true;
    ok(isDone(need(), L, map(inQuotes), [], undefined, [ask, terms, yes]).state === "open", "an order still in Price Quotes is not raised yet: open");
    ok(isDone(need({ days: ["2026-11-04", "2026-11-05"] }), L, map(a), [], undefined, [ask, terms, yes]).state === "open", "the order lacks a day of the need: open");
    ok(isDone(need({ asks: ["cancel"] }), L, map(a), [], undefined, [ask, terms, yes]).state === "open", "a cancellation is never settled by a yes to terms");

    const cx = need({ asks: ["cancel"], days: ["2026-11-06"], company_id: null, companies: [7, 8] });
    const done = msg(47, true, "Hi, Thank you for getting back to me. We have cancelled the order.");
    const none = isDone(cx, [], map(order(5, ["2026-10-28"], { company_id: 8 })), [], undefined, [msg(0, false, "the client cancelled the event", true), done]);
    ok(none.state === "agreed" && /cancellation/.test(none.text), "Spartan says it cancelled and no company of the sender holds the day: agreed", none);
    ok(isDone(cx, [], map(order(5, ["2026-11-06"], { company_id: 8 })), [], undefined, [done]).state === "open", "one of the sender's companies still holds the day: open");
    ok(isDone({ ...cx, companies: [] }, [], new Map(), [], undefined, [done]).state === "open", "a sender on no contact list: nothing to check the cancellation against, open");

    // The TV shows no agreed need at all, green or not.
    const before = await serveFeed({ ...liveFeedDeps(), jobs: undefined, remember: undefined }, Date.parse("2026-10-28T12:00:00Z"));
    const card = (((before.body as any).items ?? []) as any[]).find((c) => c.thread_id === "t-keep");
    await sql`INSERT INTO feed_marks (item_key, thread_id, mark, evidence) VALUES (${card.items[0].item_key}, 't-keep', 'agreed', ${JSON.stringify({ text: "Agreed" })}::jsonb)`;
    const after = await serveFeed({ ...liveFeedDeps(), jobs: undefined, remember: undefined }, Date.parse("2026-10-28T12:00:00Z"));
    ok(!(((after.body as any).items ?? []) as any[]).some((c) => c.thread_id === "t-keep"), "an agreed need is off the TV");
  }

  console.log("\n[8] withdrawn: the client took its own request back, and OnSinch shows nothing done (the owner, 1 Nov)");
  {
    const MIN = 60_000;
    const a = order(1, ["2026-11-04"]);
    const L = [{ order_id: 1, absolute: true, ref: "R11001" }];
    const msg = (min: number, text: string, asks = false, ours = false) => ({ at: AT + min * MIN, ours, text, asks });
    const ask = msg(0, "Can we change the 4th to 10:00-14:00 please?", true);
    const v = isDone(need(), L, map(a), [], undefined, [ask, msg(60, "Sorry, please ignore my last email, we'll keep it as it is.")]);
    ok(v.state === "agreed" && /^Withdrawn/.test(v.text) && v.at === new Date(AT + 60 * MIN).toISOString(), "\"please ignore my last email\" with nothing done in OnSinch: withdrawn", v);
    ok(isDone(need(), L, map(a), [], undefined, [ask, msg(60, "Actually scrap that, keep it as it was.")]).state === "agreed", "\"scrap that\" and \"keep it as it was\"");
    ok(isDone(need(), L, map(a), [crew(1, 1000, new Date(AT + 30 * MIN).toISOString())], undefined, [ask, msg(60, "Please ignore my last email.")]).state !== "agreed", "staff already made the change: taking it back is a change of its own, never withdrawn");
    // The words measured in real mail that are not withdrawals.
    ok(isDone(need(), L, map(a), [], undefined, [ask, msg(60, "Please ignore this email, sent in error.")]).state === "open", "\"ignore this email\" is about the email it is in");
    ok(isDone(need(), L, map(a), [], undefined, [ask, msg(60, "Ignore where it says 4hr call on the PO, it's meant to say 2.")]).state === "open", "\"ignore where it says\" about a document takes nothing back");
    ok(isDone(need(), L, map(a), [], undefined, [ask, msg(60, "If you can't do 8am, keep the booking as it was.")]).state === "open", "a condition takes nothing back");
    ok(isDone(need(), L, map(a), [], undefined, [ask, msg(30, "Also add a driver on the 4th.", true), msg(60, "Please ignore my last email.")]).state === "open", "a later request between: the words take back that one, not this need");
    ok(isDone(need(), L, map(a), [], undefined, [msg(-60, "Please ignore my last email."), ask]).state === "open", "words before the need take nothing of it back");
    const fresh = need({ asks: ["book"], fresh: true });
    ok(isDone(fresh, [], new Map(), [], undefined, [ask, msg(60, "Please disregard my previous email.")]).state === "agreed", "a new booking taken back with nothing booked that day: withdrawn");
    ok(isDone(fresh, [], map(order(2, ["2026-11-04"])), [row(2, "order_create", { model: "Order", id: "2" }, new Date(AT + 30 * MIN).toISOString())], undefined, [ask, msg(60, "Please disregard my previous email.")]).state !== "agreed", "a new booking staff had already made: not withdrawn");
    ok(isDone({ ...fresh, company_id: null }, [], new Map(), [], undefined, [ask, msg(60, "Please disregard my previous email.")]).state === "open", "an unknown client's orders were never read: not withdrawn");
  }

  console.log("\n[9] the 2-day cards of 1 Nov: what the thread settled, read narrowly");
  {
    const MIN = 60_000;
    const a = order(1, ["2026-11-04"]);
    const L = [{ order_id: 1, absolute: true, ref: "R11001" }];
    const msg = (min: number, ours: boolean, text: string, asks = false, changes = false) => ({ at: AT + min * MIN, ours, text, asks, changes });
    const ask = msg(0, false, "The 4th is now a 1900 start, hopefully this is ok?", true, true);
    const edit = row(1, "common_change", { model: "Slot", id: 1000, diffChanges: { Slot: { beginning: { old: "2026-11-04 09:00:00", new: "2026-11-04 19:00:00" } } } }, new Date(AT + 30 * MIN).toISOString());
    const quote = msg(60, true, "No problem at all, please see updated quote attached.");
    ok(isDone(need(), L, map(a), [edit], undefined, [ask, quote, msg(70, false, "Revised PO attached. Crew just need to ring onsite contact.")]).state !== "open", "a PO sent after the updated quote is the client's yes");
    ok(isDone(need(), L, map(a), [], undefined, [ask, quote, msg(70, false, "Revised PO attached.")]).state === "open", "a change answered with a quote, the order not changed before it: the quote does not hold the change");
    const promised = msg(60, true, "Overtime is noted, and we'll send over an updated quote on Monday.");
    const book = msg(0, false, "4 crew on the 4th please", true);
    ok(isDone(need({ asks: ["book"] }), L, map(a), [], undefined, [book, promised, msg(70, false, "Please can I confirm this.")]).state === "open"
      && isDone(need({ asks: ["book"] }), L, map(a), [], undefined, [book, quote, msg(70, false, "Please can I confirm this.")]).state === "agreed", "a quote promised is no quote; the same yes after a quote handed over settles");
    const paid = msg(600, true, "Hi, Thanks for paying the invoice. I've put your number on the job description.");
    ok(isDone(need({ asks: ["book"] }), L, map(a), [], undefined, [msg(0, false, "2 crew on the 4th please", true), msg(60, true, "We have 2 people booked in. Here is a quote and an invoice for the shift."), paid]).state === "agreed", "Spartan thanking the client for paying stands for the client's yes");
    ok(isDone(need({ asks: ["book"] }), L, map(a), [], undefined, [msg(0, false, "2 crew on the 4th please", true), msg(60, true, "We have 2 people booked in. Here is a quote and an invoice for the shift."), msg(600, true, "When can we expect payment? Once payment has been received we will send the crew list.")]).state === "open", "\"once payment has been received\" is a condition, not a payment received");
    const restated = msg(10, false, "This all looks great and checks out and happy to confirm: the 4th at 11am.", true, false);
    ok(isDone(need({ asks: ["book"], at: AT + 10 * MIN }), L, map(a), [], undefined, [msg(0, true, "Please see the quote attached for this order."), restated]).state === "agreed", "a yes restating the booking the order holds settles it");
    ok(isDone(need({ asks: ["book"], at: AT + 10 * MIN }), L, map(a), [], undefined, [msg(0, true, "Please see the quote attached for this order."), { ...restated, changes: true }]).state === "open", "a yes that asks for a change does not");

    const qn = need({ asks: ["book"], quote: true });
    const qreq = msg(0, false, "Please can I request a quote: 6 crew on the 4th", true);
    const sent = msg(60, true, "Hi, Please see the quote attached for this order.");
    const q = isDone(qn, L, map(a), [], undefined, [qreq, sent]);
    ok(q.state === "agreed" && /^Quote sent/.test(q.text), "a quote request answered with the quote: off the TV until the client replies", q);
    ok(isDone(qn, L, map(a), [], undefined, [qreq, sent, msg(120, false, "Thanks for this - contacts onsite for the in and the out are below.")]).state !== "agreed", "the client back after the quote, in any words, is no longer waiting");
    ok(isDone(qn, L, map(a), [], undefined, [qreq, sent, msg(90, false, "Great, please can I confirm this.")]).state !== "agreed" || /^Agreed/.test(isDone(qn, L, map(a), [], undefined, [qreq, sent, msg(90, false, "Great, please can I confirm this.")]).text), "the client's yes after it is a settlement, not a quote still waiting");
    ok(isDone({ ...qn, quote: false }, L, map(a), [], undefined, [qreq, sent]).state === "open", "a booking (not a quote request) is not left waiting on a quote");
    ok(isDone(qn, L, map(order(1, ["2026-11-05"])), [], undefined, [qreq, sent]).state === "open", "no order holds the day asked: nothing in OnSinch was quoted");

    const fresh = need({ asks: ["book"], fresh: true, days: ["2026-11-02"] });
    const mon = msg(0, false, "Please could we pencil 2 crew on Monday 2nd November", true);
    ok(isDone(fresh, [], new Map(), [], undefined, [mon, msg(240, false, "Could we look at Tuesday 3rd 19:00-23:00 instead of Monday 2nd November?", true)]).state === "agreed", "a later request \"instead of\" the day, nothing booked on it: withdrawn");
    ok(isDone(fresh, [], new Map(), [], undefined, [mon, msg(240, false, "Can I please call the crew today from 16:30 instead of 17:45?", true)]).state === "open", "\"instead of 17:45\" replaces a time, not the request");
    ok(isDone(fresh, [], new Map(), [], undefined, [mon, msg(240, false, "Could the crew arrive at 17:00 instead of 19:00 on Monday 2nd November?", true)]).state === "open", "a time moved on the need's day, \"instead of 19:00 on Monday 2nd\": not withdrawn");

    // A guessed link to an October order on a reused thread is not a November need's job.
    const old = order(9, ["2026-10-09"]);
    ok(isDone(need({ days: [], asks: ["book"], fresh: true }), [{ order_id: 9, absolute: false, ref: "" }], map(old, order(10, ["2026-11-02"])), [row(10, "order_create", { model: "Order", id: "10" }, new Date(AT + 60 * MIN).toISOString())]).state === "done",
      "the old job's link is passed over, and the order made after the email is found");
  }

  console.log("\n[10] a booking on an order still provisional is not done until staff confirm it (the owner, 2 Nov)");
  {
    const MIN = 60_000;
    const at = (min: number) => new Date(AT + min * MIN).toISOString();
    const prov = (x: { quote?: boolean } = {}) => { const o = order(1, ["2026-11-04"]); o.body.provisional = !x.quote; o.body.quote = !!x.quote; return o; };
    const L = [{ order_id: 1, absolute: true, ref: "R11001" }];
    const book = need({ asks: ["book"] });
    const made = row(1, "order_create", { model: "Order", id: "1" }, at(20));
    const v = isDone(book, L, map(prov()), [made]);
    ok(v.state === "possibly" && v.text === "R11001 is still provisional: confirm in OnSinch once the client says yes" && JSON.stringify(v.orders) === "[1]", "staff made the order but it is provisional: the card stays and says so", v);
    ok(isDone(book, L, map(prov({ quote: true })), [made]).state === "possibly", "an order still in Price Quotes: the same");
    const conf = isDone(book, L, map(prov()), [made, row(1, "order_confirm_provisional", { model: "Order", id: "1" }, at(90))]);
    ok(conf.state === "done" && /confirmed the order/.test(conf.text) && conf.at === at(90), "staff confirm it: done, as of the confirm", conf);
    const edit = (old: string, nu: string) => row(1, "common_change", { model: "Order", id: 1, diffChanges: { Order: { provisional: { old, new: nu } } } }, at(90));
    ok(isDone(book, L, map(prov()), [made, edit("1", "0")]).state === "done", "staff untick provisional on the order: that confirms it too");
    ok(isDone(book, L, map(prov()), [made, edit("0", "1")]).state === "possibly", "made provisional is no confirmation");
    ok(isDone(book, L, map(order(1, ["2026-11-04"])), [made]).state === "done", "an order made confirmed is the booking, as before");
    ok(isDone(need({ asks: ["book"], fresh: true }), [], map(prov()), []).state === "possibly", "a new booking a provisional order held before the email: not booked yet");
    ok(isDone(need({ asks: ["change"] }), L, map(prov()), [crew(1, 1000)]).state === "done", "a change staff made on a provisional order is done: a change is not a booking");
    ok(isDone(need({ asks: ["cancel"] }), L, map(prov()), [row(1, "order_cancel", { model: "Order", id: "11001" })]).state === "done", "a cancel of a provisional order is done");

    const ask = { at: AT, ours: false, text: "Can we book 4 crew on the 4th please", asks: true };
    const quote = { at: AT + 30 * MIN, ours: true, text: "Thanks for your email. Please see the quote attached for this order.", asks: false };
    const wait = isDone(book, L, map(prov()), [made], undefined, [ask, quote]);
    ok(wait.state === "agreed" && /^Quote sent/.test(wait.text), "a booking answered with a quote on a provisional order: off the TV, waiting on the client", wait);
    const yes = { at: AT + 120 * MIN, ours: false, text: "Great, please go ahead with this booking, PO to follow.", asks: false };
    const back = isDone(book, L, map(prov()), [made], undefined, [ask, quote, yes]);
    ok(back.state === "possibly" && back.text === "The client said yes on 2026-10-28: confirm R11001 in OnSinch", "the client says yes: the card is back, saying so, until staff confirm", back);
    const hold = { at: AT + 120 * MIN, ours: false, text: "Thanks for this, we are waiting on final sign off and will come back to you asap.", asks: false };
    ok(/^Quote sent/.test(isDone(book, L, map(prov()), [made], undefined, [ask, quote, hold]).text), "a reply that is no yes keeps the quote waiting on the client");
    ok(/^Quote sent/.test(isDone(need({ asks: ["book"], quote: true }), L, map(prov()), [made], undefined, [ask, quote, hold]).text), "and so for a quote request on a provisional order");
    const plural = { ...quote, text: "Lovely to hear from you! Please see your quotes attached." };
    ok(/^Quote sent/.test(isDone(book, L, map(prov()), [made], undefined, [ask, plural]).text), "\"your quotes attached\" hands a quote over");
    ok(/^Quote sent/.test(isDone(need({ asks: ["book"], quote: true, days: ["2026-11-04", "2026-11-08"] }), L, map(prov()), [made], undefined, [ask, quote]).text), "the quote on the provisional order staff made waits, though a day asked moved off it");
    ok(/^Quote sent/.test(isDone(need({ asks: ["book"], quote: true, days: [] }), L, map(prov()), [made], undefined, [ask, quote]).text), "an undated request (\"in February\") quoted on the provisional order waits too");
    ok(isDone(book, L, map(prov()), [made], undefined, [ask, quote, { ...hold, text: "Lovely, the 4th it is then.", books: true }]).text.startsWith("The client said yes"), "the reader's booking after the quote is the yes, where no phrase reads it");
    ok(/^Quote sent/.test(isDone(book, L, map(prov()), [made], undefined, [ask, quote, { ...hold, text: "Lovely, the 4th it is then." }]).text), "the same words not read as a booking: still waiting");
    const before = isDone(book, L, map(prov()), [made], undefined, [ask]);
    ok(before.state === "possibly" && before.text === "R11001 is still provisional: send the quote, or confirm it once the client says yes", "made but no quote sent yet: the quote is Spartan's to send", before);
    ok(isDone(book, L, map(prov()), [made], undefined, [ask, quote, { ...hold, text: "PO attached, thanks." }]).text.startsWith("The client said yes"), "a PO after the quote is the yes");
    ok(isDone(book, L, map(prov()), [made, row(1, "order_confirm_provisional", { model: "Order", id: "1" }, at(150))], undefined, [ask, quote, yes]).state === "done", "and staff confirming it clears it");
    ok(isDone(book, L, map(order(1, ["2026-11-04"])), [], undefined, [ask, quote]).state === "open", "a booking on a confirmed order is not left waiting on a quote, as before");
  }

  console.log("\n[11] each ask is done on its own days (3 Nov: the 24th's shifts on no order, the need done on the 26th's work)");
  {
    const L = [{ order_id: 1, absolute: true, ref: "R11001" }];
    const pairs = [{ ask: "book" as const, days: ["2026-11-24"] }, { ask: "change" as const, days: ["2026-11-26"] }];
    const n = need({ asks: ["book", "change"], days: ["2026-11-24", "2026-11-26"], pairs });
    const only26 = order(1, ["2026-11-26"]);
    const add26 = row(1, "common_create", { model: "Slot", id: 1000 });
    ok(isDone(n, L, map(only26), [crew(1, 1000), add26]).state === "open", "work on the 26th alone leaves the 24th's booking open");
    const both = order(1, ["2026-11-24", "2026-11-26"]);
    ok(isDone(n, L, map(both), [row(1, "common_create", { model: "Slot", id: 1000 }), crew(1, 1001)]).state === "done", "work on each day: done");
    ok(isDone(n, L, map(both), [crew(1, 1001), row(1, "common_create", { model: "Slot", id: 1001 })]).state === "open", "both rows on the 26th: the 24th is still owed");

    const mon = "2026-11-16", wed = "2026-11-18";
    const a4 = need({ asks: ["book", "cancel"], days: [mon, wed], pairs: [{ ask: "book", days: [mon] }, { ask: "cancel", days: [wed] }] });
    const o = order(1, [mon, wed, mon]);
    const cancelMon = row(1, "common_change", { model: "Slot", id: 1002, diffChanges: { Slot: { cancelled: { old: 0, new: 1 } } } });
    ok(isDone(a4, L, map(o), [row(1, "common_create", { model: "Slot", id: 1000 }), cancelMon]).state === "open", "add Monday and cancel Wednesday: a Monday cancel does not cancel Wednesday");
    const cancelWed = row(1, "common_change", { model: "Slot", id: 1001, diffChanges: { Slot: { cancelled: { old: 0, new: 1 } } } });
    ok(isDone(a4, L, map(o), [row(1, "common_create", { model: "Slot", id: 1000 }), cancelWed]).state === "done", "and with Wednesday cancelled: done");
    const gone = need({ asks: ["cancel"], days: [wed], pairs: [{ ask: "cancel", days: [wed] }] });
    ok(isDone(gone, L, map(order(1, [mon])), [row(1, "common_delete", { model: "Slot", id: 1001, data: { model: "Slot" } })]).state === "done", "a cancel made by deleting the shift: done, though the order no longer holds the day");

    const days4 = ["2026-11-04", "2026-11-18", "2026-11-24", "2026-11-26"];
    const four = need({ asks: ["book"], days: days4, pairs: days4.map((d) => ({ ask: "book" as const, days: [d] })) });
    const refs = [{ order_id: 1, absolute: true, ref: "PO1" }, { order_id: 2, absolute: true, ref: "PO2" }, { order_id: 3, absolute: true, ref: "PO3" }];
    const made = (id: number) => row(id, "order_create", { model: "Order", id: String(id) });
    ok(isDone(four, refs, map(order(1, ["2026-11-04"]), order(2, ["2026-11-18"]), order(3, ["2026-11-26"])), [made(1), made(2), made(3)]).state === "open", "an order per venue for three of four days: the fourth is still owed");
    ok(isDone(four, [...refs, { order_id: 4, absolute: true, ref: "PO4" }], map(order(1, ["2026-11-04"]), order(2, ["2026-11-18"]), order(3, ["2026-11-26"]), order(4, ["2026-11-24"])), [made(1), made(2), made(3), made(4)]).state === "done", "and with the fourth made: done");
    ok(isDone(need({ asks: ["book", "change"], days: ["2026-11-04"] }), L, map(order(1, ["2026-11-04"])), [crew(1, 1000), row(1, "common_create", { model: "Slot", id: 1000 })]).state === "done", "a need without pairs: as before, each ask on any of its days");
    // 2 Nov: times changed on the 5th and 7th; the 8th's asked 01:30 start was already the order's.
    const asked = need({ asks: ["change"], days: ["2026-11-05", "2026-11-08"], pairs: [{ ask: "change", days: ["2026-11-05"], start: "09:00", end: null }, { ask: "change", days: ["2026-11-08"], start: "09:00", end: null }] });
    const two = order(1, ["2026-11-05", "2026-11-08"]);
    ok(isDone(asked, L, map(two), [row(1, "common_change", { model: "Slot", id: 1000, diffChanges: { Slot: { beginning: { old: "2026-11-05 08:00:00", new: "2026-11-05 09:00:00" } } } })]).state === "done", "a change the order already holds as asked needs no work");
    const late = need({ ...asked, pairs: [asked.pairs![0], { ask: "change", days: ["2026-11-08"], start: "10:00", end: null }] });
    ok(isDone(late, L, map(two), [row(1, "common_change", { model: "Slot", id: 1000, diffChanges: { Slot: { beginning: { old: "2026-11-05 08:00:00", new: "2026-11-05 09:00:00" } } } })]).state === "open", "one the order does not hold is still owed");
  }

  console.log("\n[12] a done mark is read again while its need has a day ahead; a past one is history");
  {
    const NOW = Date.parse("2026-10-28T12:00:00Z");
    const seedOne = async (id: string, date: string) => {
      await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, interpretation, code_version, created_at)
        VALUES (${id}, ${`t-${id}`}, 'ops@north.example', '2026-10-28T09:00:00Z', 'handoff', ${JSON.stringify({ kind: "handoff", reasons: ["x"] })}::jsonb,
          ${JSON.stringify({ grounded: { intent: "booking", requests: [{ action: "new_shift", date, crew: 2, problems: [] }] } })}::jsonb, 'abc', '2026-10-28T09:00:00Z')`;
      await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, subject, is_from_spartan) VALUES (${id}, ${`t-${id}`}, 'ops@north.example', '2026-10-28T09:00:00Z', 'crew', false)`;
    };
    const prov = order(31, ["2026-11-06"]); prov.body.provisional = true;
    await sql`INSERT INTO onsinch_orders (order_id, number, company_id, body, read_at) VALUES (31, '11031', 7, ${JSON.stringify(prov.body)}::jsonb, now()),
      (32, '11032', 7, ${JSON.stringify(order(32, ["2026-10-20"]).body)}::jsonb, now())`;
    await sql`INSERT INTO onsinch_timeline (id, action, creator, created, model, model_id, order_id, data) VALUES
      (900101, 'order_create', 413, '2026-10-28T10:00:00Z', 'Order', '31', 31, '{}'::jsonb)`;
    await seedOne("m-prov", "2026-11-06");
    await seedOne("m-past", "2026-10-20");
    // The key a new booking's need has (feed/v2.ts v2Source): its kind, thread, order (none) and email.
    const kProv = "needs-created:t-m-prov:0:m-prov", kPast = "needs-created:t-m-past:0:m-past";
    // As the rule before O31 wrote them: done on a provisional order, and done on a day already past.
    await sql`INSERT INTO feed_marks (item_key, thread_id, mark, evidence, at) VALUES
      (${kProv}, 't-m-prov', 'done', ${JSON.stringify({ text: "R11031, staff made the order", orders: [31] })}::jsonb, '2026-10-28T10:00:00Z'),
      (${kPast}, 't-m-past', 'done', ${JSON.stringify({ text: "R11032, staff made the order", orders: [32] })}::jsonb, '2026-10-28T10:00:00Z')`;
    const r = await markNeeds(sql as any, null, (await liveFeedDeps().v2!()) as any, NOW);
    const m = (await sql`SELECT item_key, mark, evidence FROM feed_marks WHERE item_key IN (${kProv}, ${kPast})`) as any[];
    const of = (k: string) => m.filter((x) => x.item_key === k).map((x) => x.mark).sort().join(",");
    ok(of(kProv) === "possibly" && r.reopened === 1, "a booking done under the old rule on a provisional order is reopened, saying it is provisional", { marks: m, r });
    ok(/confirm R11031 in OnSinch|R11031 is still provisional/.test(String(m.find((x) => x.item_key === kProv && x.mark === "possibly")?.evidence?.text ?? "")), "its card says what is left: confirm R11031", m);
    ok(of(kPast) === "done", "a need whose day is past keeps its mark", m);
    await sql`UPDATE onsinch_orders SET read_at = now() WHERE order_id = 31`;
    await sql`INSERT INTO feed_marks (item_key, thread_id, mark, evidence, at) VALUES (${kProv}, 't-m-prov', 'done', ${JSON.stringify({ text: "R11099", orders: [99] })}::jsonb, now()) ON CONFLICT DO NOTHING`;
    await sql`DELETE FROM feed_marks WHERE item_key = ${kProv} AND mark = 'possibly'`;
    const r2 = await markNeeds(sql as any, null, (await liveFeedDeps().v2!()) as any, NOW);
    ok(r2.reopened === 0 && of(kProv) !== "" && ((await sql`SELECT 1 FROM feed_marks WHERE item_key = ${kProv} AND mark = 'done'`) as any[]).length === 1, "a mark naming an order this minute did not read is kept", r2);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
