// ============================================================================
// One answer to "which order is this about" (addendum 5.3, R8): the cases the addendum names.
// ----------------------------------------------------------------------------
// Competing same-day jobs, the same crew at two venues, a referenced order far down the client's
// list, and an R number passing in quoted text (F11). The 07:30 booked against an asked 08:00 is
// the shift-level near miss (R8c).
// Offline.  npx tsx --require ./test/fixtures/pg.ts test/identity.ts
// ============================================================================
import { identify, covered, refsIn, type Facts } from "../app/lib/v2/identity";
import type { ThreadMsg, Grounded } from "../app/lib/v2/threadState";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const STAFF = 2850;
const pos = (id: number, b: string, e: string, size: number, place: number) => ({ id, beginning: b, end: e, size, role: 0, profession_id: 1, slotlocation_id: 700 + place, cancelled: false, SlotLocation: { place_id: place } });
const order = (id: number, number: string, company_id: number, name: string, created: string, slots: any[]) =>
  ({ id, number, company_id, status: 1, intern_name: "", name, created, creator: STAFF, Job: [{ id: id + 1000, SlotTeam: [{ id: id + 2000, name: "Crew", Slot: slots }] }] });
const facts = (x: Partial<Facts>): Facts => ({ refs: [], requests: [], link: null, text: "", ...x });
const tm = (body: string, ours = false, subject = ""): ThreadMsg => ({ message_id: body.slice(0, 8), from: ours ? "ops@spartancrew.co.uk" : "pm@twojobs.co.uk", to: [], at: 0, subject, body, ours });
const C = { companyIds: [330] };

// Two Jobs (330) on Wed 28 Oct: 4 crew 09:00-17:00 at Olympia (31) and 4 crew 09:00-17:00 at ExCeL (49).
const OLY = order(20001, "12001", 330, "Two Jobs @ Olympia", "2026-10-01T09:00:00Z", [pos(1, "2026-10-28T09:00:00Z", "2026-10-28T17:00:00Z", 4, 31)]);
const EXC = order(20002, "12002", 330, "Two Jobs @ ExCeL", "2026-10-02T09:00:00Z", [pos(2, "2026-10-28T09:00:00Z", "2026-10-28T17:00:00Z", 4, 49)]);
const same: Grounded = { date: "2026-10-28", start: "09:00", crew: 4 };

console.log("\n[1] competing same-day jobs: equal evidence is no answer, and both are named");
{
  const id = identify(facts({ requests: [same] }), [OLY, EXC], C);
  ok(id.kind === "several" && id.orders.map((o) => o.r).sort().join() === "R12001,R12002", "two orders with the same day, start and crew: several, both listed", id);
  const day = identify(facts({ requests: [{ date: "2026-10-28" }] }), [OLY, EXC], C);
  ok(day.kind === "none", "the day alone names nothing (Ben, 10-03 and 10-15)", day);
  const gone = identify(facts({ requests: [same] }), [OLY, { ...EXC, status: -1 }], C);
  ok(gone.kind === "one" && gone.order.r === "R12001", "a cancelled order never holds a booking, so the other is the one", gone);
}

console.log("\n[2] the same crew at two venues: the venue decides, and without it nothing is 'already booked'");
{
  const id = identify(facts({ requests: [{ ...same, place_id: 49 }] }), [OLY, EXC], C);
  ok(id.kind === "one" && id.order.r === "R12002" && /venue/.test(id.order.by), "the venue the email names singles out the ExCeL job", id);
  ok(covered([same], [OLY, EXC], C) === null, "4 crew at 09:00 with no venue is not covered by two jobs that each have it (F9)");
  ok(covered([{ ...same, place_id: 49 }], [OLY, EXC], C)?.map((o) => o.r).join() === "R12002", "with the venue, the ExCeL job covers it");
  const generic = identify(facts({ requests: [{ ...same, place_id: 49 }], generic: new Set([49]) }), [OLY, EXC], C);
  ok(generic.kind === "several", "a generic place ('No Location') is never the deciding venue", generic);
  const after = Date.parse("2026-09-30T00:00:00Z");
  ok(covered([same], [OLY, EXC], { ...C, after })?.length === 2, "two orders both made after the email are staff's own split of it (a quote's options)");
}

console.log("\n[3] a referenced order far down the client's list is found by its number");
{
  const many = Array.from({ length: 25 }, (_, k) => order(30000 + k, String(13000 + k), 330, `Job ${k}`, "2026-09-01T09:00:00Z", [pos(100 + k, `2026-11-${String(1 + k).padStart(2, "0")}T09:00:00Z`, `2026-11-${String(1 + k).padStart(2, "0")}T17:00:00Z`, 3, 31)]));
  const refs = refsIn([], { subject: "Re: crew", text: "can we add a chief to R13024 please" });
  const id = identify(facts({ refs, requests: [{ date: "2026-11-25" }] }), many, C);
  ok(id.kind === "one" && id.order.r === "R13024", "R13024, the 25th of the client's orders, is the one", id);
}

console.log("\n[4] an R number in quoted text decides only when its order holds a day asked (F11)");
{
  const thread = [tm("Thanks!\n\nOn Mon, 26 Oct 2026, ops wrote:\n> R12001 is your Olympia job")];
  const refs = refsIn(thread);
  ok(refs.some((r) => r.value === "12001" && r.where === "quoted"), "the number under 'On ... wrote:' is quoted", refs);
  const thanks = identify(facts({ refs, requests: [] }), [OLY, EXC], C);
  ok(thanks.kind === "none", "with no day asked, a quoted number links nothing ('thanks' under another job's number)", thanks);
  const elsewhere = identify(facts({ refs, requests: [{ date: "2026-10-30" }] }), [OLY, EXC], C);
  ok(elsewhere.kind === "none", "with a day its order does not hold, it names nothing", elsewhere);
  const held = identify(facts({ refs, requests: [same] }), [OLY, EXC], C);
  ok(held.kind === "one" && held.order.r === "R12001", "with a day its order holds, it decides: our confirmation quoted under the client's reply (Harbour Scenic R11508)", held);
  const ours = refsIn([tm("can we move the start?"), tm("Hi, R12001 is confirmed for Wednesday.", true)]);
  const fromUs = identify(facts({ refs: ours, requests: [{ date: "2026-10-28" }] }), [OLY, EXC], C);
  ok(fromUs.kind === "one" && fromUs.order.r === "R12001", "in our own reply's words it names the order", fromUs);
  const repeat = refsIn([], { subject: "", text: "Same again please, a repeat of R12001 on the 4th" });
  ok(!repeat.length, "'repeat of R12001' names the job being copied, not this one", repeat);
}

console.log("\n[5] the ladder: the newest email's number, then the link, then the thread's numbers");
{
  const LATER = order(20003, "12003", 330, "Two Jobs @ Olympia", "2026-10-03T09:00:00Z", [pos(3, "2026-10-28T18:00:00Z", "2026-10-28T23:00:00Z", 2, 31)]);
  const newest = refsIn([tm("R12001 was great")], { subject: "Re: crew", text: "please add 2 crew to R12003 on Wednesday" });
  const id = identify(facts({ refs: newest, requests: [{ date: "2026-10-28" }], link: 20001 }), [OLY, EXC, LATER], C);
  ok(id.kind === "one" && id.order.r === "R12003", "a number in the newest words beats the link and older numbers", id);
  const two = identify(facts({ refs: refsIn([], { subject: "", text: "For R12001 and R12003, could Wednesday's call be 8-4?" }), requests: [{ date: "2026-10-28" }] }), [OLY, EXC, LATER], C);
  ok(two.kind === "several" && two.orders.length === 2 && !two.lead, "two orders in the email itself are for a person, both holding the day: no lead", two);
  const lead = identify(facts({ refs: refsIn([], { subject: "", text: "Further to R12001, and R12003" }), requests: [{ date: "2026-10-28" }] }), [OLY, { ...LATER, Job: [{ id: 1, SlotTeam: [{ id: 9, Slot: [pos(9, "2026-11-28T18:00:00Z", "2026-11-28T23:00:00Z", 2, 31)] }] }] }], C);
  ok(lead.kind === "several" && lead.lead?.r === "R12001", "of two named, the one holding the day is the lead a card may name", lead);
  const linked = identify(facts({ requests: [{ date: "2026-10-28" }], link: 20002 }), [OLY, EXC], C);
  ok(linked.kind === "one" && linked.order.r === "R12002" && linked.order.by === "link", "the link, holding the day asked", linked);
  const add = identify(facts({ requests: [same] }), [OLY, EXC], { ...C, add: true });
  ok(add.kind === "none", "new shifts go onto an order only by its number or the link, never by resemblance", add);
  const other = identify(facts({ refs: refsIn([], { subject: "", text: "R12001" }), requests: [] }), [OLY], { companyIds: [999] });
  ok(other.kind === "none", "another client's order is never this client's", other);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
