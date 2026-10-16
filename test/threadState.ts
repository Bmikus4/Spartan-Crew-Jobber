// A thread's state from the whole thread and OnSinch now (app/lib/v2/threadState.ts). Cases
// are the open cards the simulator left on 10-16 (harness/sim/onepass.mts).
//
// Offline.  npx tsx test/threadState.ts
import { threadState, type ThreadIn, type StateWorld } from "../app/lib/v2/threadState";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const T0 = Date.parse("2026-10-15T12:00:00Z");
const slot = (day: string, startUtc: string, size: number, place = 7060) => ({ beginning: `${day}T${startUtc}:00+00:00`, end: `${day}T23:00:00+00:00`, size, SlotLocation: { place_id: place } });
const order = (id: number, number: string, company: number, slots: any[], extra: Record<string, unknown> = {}) =>
  ({ id, number, company_id: company, creator: 110, status: 0, created: "2026-10-01T09:00:00Z", Job: [{ id: id + 100, SlotTeam: [{ Slot: slots }] }], ...extra });
const companies = [{ id: 48, name: "Bearded Kitten", Client: [{ id: 1, email: "cat@beardedkitten.com" }] }, { id: 77, name: "Halo", Client: [{ id: 2, email: "james@halo.co.uk" }] }] as any[];
const client = (body: string, at = T0, from = "cat@beardedkitten.com") => ({ message_id: `c${at}`, from, to: ["bookings@spartancrew.co.uk"], at, subject: "Re: crew", body, ours: false });
const ours = (body: string, at = T0 + 3600_000) => ({ message_id: `o${at}`, from: "bookings@spartancrew.co.uk", to: ["cat@beardedkitten.com"], at, subject: "Re: crew", body, ours: true });
const thread = (messages: any[], over: Partial<ThreadIn> = {}): ThreadIn => ({ thread_id: "t", messages, requests: [], link: null, need: { kind: "needs-updated", at: messages.find((m) => !m.ours)?.at ?? T0 }, ...over });
const R11507 = order(16561, "11507", 48, [slot("2026-10-16", "09:00", 3)], { intern_name: "10000733", name: "Bearded Kitten - 250430 TikTok Logistics & Storage" });
const world = (orders: any[], staffEdits: StateWorld["staffEdits"] = []): StateWorld => ({ orders, companies, staffEdits });

let s = threadState(thread([client("change the timing to 10-2 please")], { link: { order_id: 16561 } }), world([R11507]));
ok(s.state === "needs-updated" && s.order?.r === "R11507" && s.order?.j === "J16661", "a linked order is the thread's order, shown with its R and J", s);

s = threadState(thread([client("can we move the start?"), ours("Hi Cat, R11507 is confirmed for Friday.")]), world([R11507]));
ok(s.order?.r === "R11507" && s.order.by === "its number in the thread", "an R number in OUR reply names the order", s);

s = threadState(thread([client("please make sure the reference corresponds to project 250430 TikTok Logistics")]), world([R11507]));
ok(s.order?.r === "R11507" && /PO or project/.test(s.order.by), "the client's project reference in the order's name names the order", s);

s = threadState(thread([client("3 crew Friday from 10am")], { requests: [{ date: "2026-10-16", start: "10:00", crew: 3 }] }), world([R11507]));
ok(s.order?.r === "R11507" && /^the day and/.test(s.order.by), "the day and one more fact (start, crew) names the order", s);

s = threadState(thread([client("6 crew Friday from 6am")], { requests: [{ date: "2026-10-16", start: "06:00", crew: 6 }] }), world([order(16562, "11508", 48, [slot("2026-10-16", "17:00", 2, 999)])]));
ok(s.order === null, "the day alone names no order (Ben, 10-15)", s);

s = threadState(thread([client("another 3 crew next Friday please")], { link: { order_id: 16561 }, requests: [{ date: "2026-10-23", crew: 3 }], need: { kind: "needs-created", at: T0 } }), world([R11507]));
ok(s.state === "needs-updated" && /no shift on 2026-10-23/.test(s.why), "a new day in a linked thread is an update to that order, not 'already booked'", s);

s = threadState(thread([client("6 crew 21 Nov 6am")], { requests: [{ date: "2026-11-21", start: "06:00", crew: 6 }], need: { kind: "needs-created", at: T0 } }),
  world([order(16900, "11698", 48, [slot("2026-11-21", "06:00", 6)], { created: "2026-10-15T12:10:00Z" })]));
ok(s.state === "done" && s.order?.r === "R11698", "an order staff keyed after the email holds the booking", s);

s = threadState(thread([client("finish at 4pm on the 21st")], { link: { order_id: 16561 } }), world([R11507], [{ order_id: 16561, at: T0 + 600_000 }]));
ok(s.state === "done" && /staff changed R11507/.test(s.why), "staff editing the order after the email settles the update", s);

s = threadState(thread([client("rates for NYE?", T0, "james@halo.co.uk"), ours("We charge double rates on New Year's Eve")], { need: { kind: "needs-created", at: T0 } }), world([]));
ok(s.state === "answered" && s.order === null, "no order and our reply after the client's last email: a person has it", s);

s = threadState(thread([ours("Do you have 6 crew for Sunday?", T0 - 3600_000), client("Here's your crew list: Anan")], { need: { kind: "needs-created", at: T0 } }), world([]));
ok(s.state === "not-a-job", "a thread we started (crew asked of a supplier) is not a client's job", s);

s = threadState(thread([client("Crew request Monday 26th, 4 crew 12-4")], { need: { kind: "needs-created", at: T0 } }), world([]));
ok(s.state === "needs-created", "a booking nobody has answered and no order holds still needs creating", s);

s = threadState(thread([client("R11507 please add one")], { link: null }), world([{ ...R11507, status: -1 }]));
ok(s.order === null, "a cancelled order is never the thread's order", s);

// Harbour Scenic: the thread names its September job and its October one; the days decide.
const R10950 = order(15900, "10950", 48, [slot("2026-09-18", "17:30", 2)], { status: -2 });
const R11508 = order(16560, "11508", 48, [slot("2026-10-13", "17:30", 2), slot("2026-10-15", "19:00", 4)]);
s = threadState(thread([client("Further to R10950 last month, and R11508: change the 15th to 19:00-01:00")], { requests: [{ date: "2026-10-15", start: "19:00" }] }), world([R10950, R11508]));
ok(s.order?.r === "R11508", "of two numbers named, the order holding the day asked is the one", s);

// Creative Technology, 10-14: the link pointed at R11500 (another job); staff had R11555 at Cytiva.
const R11500 = order(16553, "11500", 48, [slot("2026-10-16", "08:00", 6, 111)], { name: "Creative Technology - Technicians @ Barclays" });
const R11555 = order(16610, "11555", 48, [slot("2026-10-15", "13:30", 2, 6358)], { name: "Creative Technology @ Cytiva, Amersham Place" });
s = threadState(thread([client("2 crew at Cytiva on the 15th, 14:30-18:30")], { link: { order_id: 16553 }, requests: [{ date: "2026-10-15", start: "14:30", crew: 2, venue: "Cytiva" }] }), world([R11500, R11555]));
ok(s.order?.r === "R11555" && /venue name/.test(s.order.by), "a link holding none of the days asked loses to the order that holds the day, the crew and the venue", s);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
