// ============================================================================
// Release 1 (Ben approved 10-20): the planner never books the thread's history again, finds a
// booking by its day and start, and never writes a day already over. Every case is a bot write
// staff had to delete since 9 Oct (4 of the 6 shifts the bot added), on its real email.
//
// Offline.  npx tsx test/v2History.ts
// ============================================================================
import { ground } from "../app/lib/v2/interpret/interpret";
import type { Extraction, RawRequest } from "../app/lib/v2/interpret/extract";
import { plan, type World, type Message } from "../app/lib/v2/interpret/plan";
import { checkOf } from "../app/lib/feed/cardNote";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const q = <T,>(value: T, quote: string) => ({ value, quote });
const raw = (x: Partial<RawRequest>): RawRequest => ({ action: "new_shift", date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, venue: null, crew_chief: null, trade: null, target: null, ...x });
const X = (requests: RawRequest[], intent: Extraction["intent"] = "booking"): Extraction => ({ intent, po: null, requests, note: "" });
const thread = (text: string) => ({ thread: [{ who: "client" as const, at: "2026-10-12T10:00:00Z", text }], bookings: [], venues: [] });

// OnSinch as staff left it: a SlotTeam carries who made it and when; its slots are the positions.
const team = (id: number, name: string, creator: number, created: string, slots: any[]) => ({ id, name, creator, created, modifier: creator, modified: created, Slot: slots });
const pos = (id: number, b: string, e: string, size: number, chief = false) => ({ id, beginning: b, end: e, size, role: chief ? 1 : 0, profession_id: chief ? 36 : 1, slotlocation_id: 700, created: "", modified: "", cancelled: false, SlotLocation: { place_id: 88 } });
const order = (id: number, number: string, company_id: number, teams: any[]) => ({ id, number, company_id, status: 1, intern_name: "", name: "", created: "2026-10-01T00:00:00Z", Job: [{ id: id + 100000, SlotTeam: teams }] });

const STAFF = 2826, BOT = 2257;
// Premier PR R11531: staff's 4 crew 06:00-10:00 on Wed 14 Oct (London), built 10-13 10:27 UTC.
const R11531 = order(16648, "11531", 600, [team(1, "Crew", STAFF, "2026-10-13T10:27:00Z", [pos(11, "2026-10-14T05:00:00Z", "2026-10-14T09:00:00Z", 1, true), pos(12, "2026-10-14T05:00:00Z", "2026-10-14T09:00:00Z", 3)])]);
// The Roof Gardens R11766: Install 14:00-16:00 Thu 22 Oct and Derig 07:00-09:00 Fri 23 Oct, built by staff at 09:10 UTC on 10-20.
const R11766 = order(16894, "11766", 582, [
  team(42835, "Install", STAFF, "2026-10-20T09:10:42Z", [pos(60321, "2026-10-22T13:00:00Z", "2026-10-22T15:00:00Z", 2)]),
  team(42836, "Derig", STAFF, "2026-10-20T09:10:42Z", [pos(60322, "2026-10-23T06:00:00Z", "2026-10-23T08:00:00Z", 2)]),
]);
// A shift that existed before the client's email, made by the bot: a later change to it is the client's.
const R20001 = order(20001, "20001", 582, [
  team(9, "Crew", BOT, "2026-10-01T09:00:00Z", [pos(91, "2026-11-12T09:00:00Z", "2026-11-12T17:00:00Z", 2)]),
  team(10, "Crew", STAFF, "2026-10-20T09:30:00Z", [pos(101, "2026-11-13T09:00:00Z", "2026-11-13T17:00:00Z", 2)]),
]);

const orders = [R11531, R11766, R20001];
const world: World = {
  companies: async () => [
    { id: 600, name: "Premier PR", Client: [{ id: 1, email: "georgia.parkhill@premiercomms.com" }] },
    { id: 582, name: "The Roof Gardens", Client: [{ id: 2, email: "charlie.simmons@theroofgardens.com" }] },
  ],
  placesNamed: async () => [],
  companyOrders: async (c) => orders.filter((o) => o.company_id === c),
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
};
const msg = (from: string, subject: string, text: string, sentIso: string, id = "m1"): Message => ({ message_id: id, from, subject, sentIso, text });
const NOW_1020 = Date.parse("2026-10-20T10:00:00Z");

(async () => {
  console.log("Premier PR #1 (10-13 12:00): \"when you can confirm the quote amount\" asks US to confirm");
  {
    const subject = "Re: 4 x crew for 6am - 10am Wednesday 14th";
    const newest = "Hi Tracy,\nContact is Ned on 07512 196031\nPO will be raised when you can confirm the quote amount? But yes we will need to do a PO however it won't clear with our accounts team by tomorrow, is that ok?";
    const prior = [{ action: "new_shift" as const, date: "2026-10-14", start: "06:00", end: "10:00", crew: 4, venue: "Roundhouse, london", problems: [] }];
    const g = ground(X([], "info_only"), `${subject}\n${newest}`, "2026-10-13T12:00:30Z", { subject, prior });
    ok(g.requests.length === 0 && g.intent === "info_only", "the earlier booking is not revived", JSON.stringify(g));
    const yes = ground(X([], "info_only"), `${subject}\nThanks, please book this in`, "2026-10-13T12:00:30Z", { subject, prior });
    ok(yes.requests.length === 1 && yes.requests[0].history === true, "the client's own \"please book this\" still revives it, as history", JSON.stringify(yes.requests));
  }

  console.log("Premier PR #2 (10-13 12:14): every value is in the reply's subject, none in Georgia's words");
  {
    const subject = "Re: 4 x crew for 6am - 10am Wednesday 14th";
    const newest = "Hi Tracy,\nSorry on my phone so the attachment wasn't showing!\nPO is 92776 PR. We will need that referenced on your invoice and accounts can process.";
    const x = X([raw({ date: q("2026-10-14", "Wednesday 14th"), start: q("06:00", "6am"), end: q("10:00", "10am"), crew: q(4, "4 x crew"), trade: q("crew", "4 x crew") })]);
    const g = ground(x, `${subject}\n${newest}`, "2026-10-13T12:14:13Z", { subject, read: thread("") });
    ok(g.requests.length === 1 && g.requests[0].history === true, "the request is the thread's history", JSON.stringify(g.requests));
    const d = await plan(msg("georgia.parkhill@premiercomms.com", subject, newest, "2026-10-13T12:14:13Z"), g, world, null, { now: Date.parse("2026-10-13T12:14:13Z") });
    ok(d.kind === "none" && /already booked: R11531/.test(d.reason) && JSON.stringify(d.found) === "[16648]", "staff's R11531 holds it: nothing is written, and the thread is linked to R11531", JSON.stringify(d));
    const fresh = ground(x, `4 x crew for 6am - 10am Wednesday 14th\n${newest}`, "2026-10-13T12:14:13Z", { subject: "4 x crew for 6am - 10am Wednesday 14th" });
    ok(fresh.requests[0]?.history !== true, "a first email's own subject is the client's words, not history", JSON.stringify(fresh.requests));
  }

  console.log("RG Jones (10-19): \"I'll not be needing this call now\" names its call only in the quoted email");
  {
    const subject = "Re: 30th October";
    const newest = "Hi Jake\nHope you are well, I'll not be needing this call now thank you.";
    const earlier = "30th October: x3 Crew Load in 4 hour call 09:30 - 13:30";
    const x = X([raw({ action: "cancel_shift", date: q("2026-10-30", "30th October"), start: q("09:30", "09:30"), crew: q(3, "x3 Crew"), target: { quote: "x3 Crew Load in 4 hour call 09:30 - 13:30", date: null, start: null } })], "cancellation");
    const g = ground(x, `${subject}\n${newest}`, "2026-10-19T08:15:00Z", { subject, read: thread(earlier) });
    ok(g.requests.length === 1 && g.requests[0].history !== true, "a cancellation is the client's own words even when its day is quoted: never history", JSON.stringify(g.requests));
  }

  console.log("The Roof Gardens (10-20 09:52): \"All confirmed on my side\" after staff built R11766 at 09:10");
  {
    const subject = "Re: Crew Booking - Thursday 22nd October";
    const newest = "Hey,\nAll confirmed on my side, thank you!\nWarmest,\nCharlie";
    const earlier = "Hi, could we book 2 people on Thursday 22nd October from 2pm to 3pm, and x2 crew on Friday 23rd October from 7am?";
    const x = X([
      raw({ date: q("2026-10-22", "Thursday 22nd October"), start: q("14:00", "2pm"), end: q("15:00", "3pm"), crew: q(2, "2 people") }),
      raw({ date: q("2026-10-23", "Friday 23rd October"), start: q("07:00", "7am"), crew: q(2, "x2 crew") }),
    ]);
    const g = ground(x, `${subject}\n${newest}`, "2026-10-20T09:52:27Z", { subject, read: thread(earlier) });
    ok(g.requests.length === 2 && g.requests.every((r) => r.history === true), "both requests are history", JSON.stringify(g.requests.map((r) => r.history)));
    const d = await plan(msg("charlie.simmons@theroofgardens.com", subject, newest, "2026-10-20T09:52:27Z"), g, world, null, { now: NOW_1020 });
    ok(d.kind === "none" && /R11766/.test(d.reason), "no 14:00-15:00 shift is added beside staff's 14:00-16:00", JSON.stringify(d));
  }

  console.log("Fix 2: already booked by the day and the start, and who has the last word");
  {
    // Plum's own booking email at 08:54, before staff built R11766: staff's later 14:00-16:00 stands.
    const g = { intent: "booking" as const, requests: [{ action: "new_shift" as const, date: "2026-10-22", start: "14:00", end: "15:00", crew: 2, problems: [] }], problems: [] };
    const d = await plan(msg("charlie.simmons@theroofgardens.com", "Crew Booking - Thursday 22nd October", "2 crew 2pm-3pm Thursday", "2026-10-20T08:54:00Z"), g, world, 16894, { now: NOW_1020 });
    ok(d.kind === "none" && /already booked: R11766/.test(d.reason), "staff built the shift after the email: their 14:00-16:00 is not shortened to 15:00", JSON.stringify(d));
    // A shift that was there before the email: the client's new count is a change to it.
    const three = { intent: "change" as const, requests: [{ action: "new_shift" as const, date: "2026-11-12", start: "09:00", end: "17:00", crew: 3, problems: [] }], problems: [] };
    const u = await plan(msg("charlie.simmons@theroofgardens.com", "Re: 12 Nov", "can we make it 3 crew at 9am on the 12th", "2026-10-20T08:54:00Z"), three, world, 20001, { now: NOW_1020 });
    const op = u.kind === "write" ? (u.ops[0].op as any) : null;
    ok(u.kind === "write" && u.ops.length === 1 && op.kind === "set_position_size" && op.slot_id === 91 && op.size === 3, "a later \"make it 3 crew\" on a shift that was already there still updates it", JSON.stringify(u));
    const longer = { intent: "change" as const, requests: [{ action: "new_shift" as const, date: "2026-11-12", start: "09:00", end: "18:00", crew: 2, problems: [] }], problems: [] };
    const t = await plan(msg("charlie.simmons@theroofgardens.com", "Re: 12 Nov", "2 crew 9am-6pm on the 12th please", "2026-10-20T08:54:00Z"), longer, world, 20001, { now: NOW_1020 });
    const top = t.kind === "write" ? (t.ops[0].op as any) : null;
    ok(t.kind === "write" && top.kind === "set_position_times" && top.end === "18:00" && top.slot_id === 91, "a different finish on that shift is a time move, not a second shift", JSON.stringify(t));
    const same = { intent: "booking" as const, requests: [{ action: "new_shift" as const, date: "2026-11-12", start: "09:00", end: "17:00", crew: 2, problems: [] }], problems: [] };
    const s = await plan(msg("charlie.simmons@theroofgardens.com", "Re: 12 Nov", "2 crew 9-5 on the 12th", "2026-10-20T08:54:00Z"), same, world, 20001, { now: NOW_1020 });
    ok(s.kind === "none" && /already booked: R20001/.test(s.reason), "the same shape restated is already booked", JSON.stringify(s));
    // We Are Family R11349 (replay 10-21): "change both days to 10pm-2am, and add 2 crew on Monday".
    const both = { intent: "change" as const, requests: [
      { action: "change_times" as const, date: "2026-11-12", start: "10:00", end: "18:00", target: { quote: "the 12th", date: "2026-11-12" }, problems: [] },
      { action: "new_shift" as const, date: "2026-11-13", start: "09:00", end: "17:00", crew: 2, problems: [] },
    ], problems: [] };
    const w = await plan(msg("charlie.simmons@theroofgardens.com", "Re: 12 Nov", "move the 12th to 10am-6pm, and 2 crew 9-5 on the 13th", "2026-10-20T08:54:00Z"), both, world, 20001, { now: NOW_1020 });
    ok(w.kind === "write" && w.ops.some((o) => o.op.kind === "set_position_times" && (o.op as any).slot_id === 91) && !w.ops.some((o) => o.op.kind === "add_shift"), "the 13th already booked by staff never costs the 12th's time change", JSON.stringify(w).slice(0, 260));
  }

  console.log("Fix 3: a day already over is never written (COG's 27 July email, decided 19 Oct, wrote 18 Oct)");
  {
    const g = { intent: "booking" as const, requests: [{ action: "new_shift" as const, date: "2026-11-12", start: "07:00", end: "08:00", crew: 2, problems: [] }, { action: "new_shift" as const, date: "2026-10-18", start: "08:00", end: "18:00", crew: 8, problems: [] }], problems: [] };
    const d = await plan(msg("charlie.simmons@theroofgardens.com", "Re: crew", "2 crew 7-8am on the 12th Nov and 8 on 18 Oct", "2026-07-27T17:27:36Z"), g, world, 20001, { now: Date.parse("2026-10-19T13:16:00Z") });
    ok(d.kind === "handoff" && /2026-10-18 is already over: a person adjusts it/.test(d.reasons.join()), "a request for yesterday raises a card and writes nothing", JSON.stringify(d));
    ok(checkOf(d.kind === "handoff" ? d.reasons[0] : "") === "Day already over, adjust by hand", "and the card says so in plain words");
  }

  console.log("A history request no order holds stays a card");
  {
    const g = { intent: "booking" as const, requests: [{ action: "new_shift" as const, date: "2026-11-20", start: "08:00", end: "12:00", crew: 4, problems: [], history: true }], problems: [] };
    const d = await plan(msg("charlie.simmons@theroofgardens.com", "Re: quote", "Yes please, go ahead", "2026-10-20T08:54:00Z"), g, world, null, { now: NOW_1020 });
    ok(d.kind === "handoff" && /the client confirmed 2026-11-20, and no order holds it yet/.test(d.reasons.join()), "\"client confirmed, no order holds it yet\": nothing is booked from history", JSON.stringify(d));
    ok(checkOf(d.kind === "handoff" ? d.reasons[0] : "") === "Client confirmed, not booked yet", "and the card says so");
  }

  console.log("Light Motif R11662 (10-20): \"Can we confirm this?\" under our offer of three more crew");
  {
    const g = { intent: "change" as const, requests: [{ action: "change_crew" as const, date: "2026-11-12", crew_add: 3, history: true, problems: [] }], problems: [] };
    const yes = await plan(msg("charlie.simmons@theroofgardens.com", "Re: Booking Enquiry", "Hi Tracy, Perfect. Thank you. Can we confirm this? I will get a PO sent out shortly", "2026-10-20T08:54:00Z"), g, world, 20001, { now: NOW_1020 });
    ok(yes.kind === "handoff" && /the client confirmed a change from the thread/.test(yes.reasons.join()), "their yes to a change from the thread is a card for a person, never dropped and never written", JSON.stringify(yes));
    const thanks = await plan(msg("charlie.simmons@theroofgardens.com", "Re: Booking Enquiry", "Thanks, see you there", "2026-10-20T08:54:00Z"), g, world, 20001, { now: NOW_1020 });
    ok(thanks.kind === "none", "the quoted change read again under a \"thanks\" asks for nothing", JSON.stringify(thanks));
  }

  console.log("A stand-down with nothing booked that day changes nothing (Cells4Life, 10-19)");
  {
    const g = { intent: "cancellation" as const, requests: [{ action: "cancel_shift" as const, date: "2026-10-25", problems: ["request 1: no words cancelling the whole shift"] }], problems: [] };
    const d = await plan(msg("charlie.simmons@theroofgardens.com", "Re: Quote request", "we're going with a different crew company for this job", "2026-10-19T09:30:11Z"), g, world, null, { now: Date.parse("2026-10-19T09:30:11Z") });
    ok(d.kind === "none" && /nothing is booked on 2026-10-25/.test(d.reason), "nothing for the client on the 25th: no card, nothing to cancel", JSON.stringify(d));
    const booked = { intent: "cancellation" as const, requests: [{ action: "cancel_shift" as const, date: "2026-10-22", problems: ["request 1: no words cancelling the whole shift"] }], problems: [] };
    const b = await plan(msg("charlie.simmons@theroofgardens.com", "Re: Thursday", "please stand down on this request for now", "2026-10-20T09:30:11Z"), booked, world, null, { now: NOW_1020 });
    ok(b.kind === "handoff" && /no words cancelling the whole shift/.test(b.reasons.join()), "a booked day still goes to a person: the words do not cancel the whole shift", JSON.stringify(b));
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})();
