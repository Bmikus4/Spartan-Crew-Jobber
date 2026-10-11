// ============================================================================
// The planner against the incidents and cases the rebuild exists for, on a fake OnSinch.
//
// Offline.  npx tsx test/v2Plan.ts
// ============================================================================
import { plan, positionsFor, type World, type Message } from "../app/lib/v2/interpret/plan";
import type { Interpretation, Request } from "../app/lib/v2/interpret/interpret";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const slot = (id: number, day: string, start: string, end: string, size: number, chief = false, loc = 900) =>
  ({ id, beginning: `${day}T${start}:00+01:00`, end: `${day}T${end}:00+01:00`, size, profession_id: chief ? 36 : 1, role: chief ? 1 : 0, slotlocation_id: loc });
// Event Concept (137): R11352 has Steve's 4 on Fri 9 Oct (CC1 + Crew3); R11199 has two shifts on 6 Oct.
const atBDC = <T,>(s: T) => ({ ...s, SlotLocation: { place_id: 29 } });
const R11352 = { id: 16388, number: "11352", company_id: 137, intern_name: "", Job: [{ SlotTeam: [{ id: 1, name: "Crew", Slot: [atBDC(slot(11, "2026-10-09", "09:00", "17:00", 1, true)), atBDC(slot(12, "2026-10-09", "09:00", "17:00", 3))] }] }] };
const R11199 = { id: 16220, number: "11199", company_id: 137, intern_name: "", Job: [{ SlotTeam: [
  { id: 2, name: "Install", Slot: [slot(21, "2026-10-06", "08:00", "14:00", 4)] },
  { id: 3, name: "Derig", Slot: [slot(31, "2026-10-06", "22:00", "23:30", 2)] },
] }] };
// Legal Geek (#13709): one Install on the 12th.
const LG = { id: 13709, number: "9001", company_id: 400, intern_name: "4672", Job: [{ SlotTeam: [{ id: 4, name: "Install", Slot: [slot(41, "2026-10-12", "08:00", "12:00", 2, false, 777)] }] }] };

const world: World = {
  companies: async () => [
    { id: 137, name: "Event Concept", Client: [{ id: 1, email: "crew@eventconcept.com" }] },
    { id: 400, name: "Legal Geek", Client: [{ id: 2, email: "ops@legalgeek.co" }] },
  ],
  placesNamed: async (n) => (/business design centre/i.test(n) ? [{ id: 29, name: "Business Design Centre" }] : []),
  companyOrders: async (c) => (c === 137 ? [R11352, R11199] : c === 400 ? [LG] : []),
  orderByNumber: async (n) => [R11352, R11199, LG].find((o) => o.number === n) ?? null,
};
const msg = (from: string, text: string, subject = ""): Message => ({ message_id: "m1", from, subject, sentIso: "2026-10-07T09:00:00Z", text });
const r = (x: Partial<Request>): Request => ({ action: "new_shift", problems: [], ...x });
const I = (requests: Request[], extra: Partial<Interpretation> = {}): Interpretation => ({ intent: "change", requests, problems: [], ...extra });

console.log("positions by crew size (ops' practice)");
ok(JSON.stringify(positionsFor(3)) === JSON.stringify([{ size: 3, profession_id: "1" }]), "3 crew: plain crew");
ok(positionsFor(4)?.length === 2 && positionsFor(4)![0].role === "crew_chief" && positionsFor(4)![1].size === 3, "4 crew: crew chief + 3");
ok(positionsFor(12) === null, "12 crew: not decided here");

(async () => {
  console.log("R11425: 'add 2 crew to Steve's 4 on Friday 9th' is a change to R11352, not a new order");
  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 crew to Steve's 4 on Friday 9th"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2 })]), world);
    const op = d.kind === "write" ? d.ops[0].op : null;
    ok(d.kind === "write" && d.ops.length === 1 && op?.kind === "set_position_size" && (op as any).slot_id === 12 && (op as any).size === 5, "crew position 12 goes to 5 (6 in all with the chief)", JSON.stringify(d));
  }

  console.log("Legal Geek #13709: adding a derig on the 13th never moves the install");
  {
    const d = await plan(msg("ops@legalgeek.co", "please add a derig on the 13th, 2 crew 18:00-22:00", "RE: R9001"), I([r({ date: "2026-10-13", start: "18:00", end: "22:00", crew: 2 })], { intent: "booking" }), world);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op) : [];
    ok(ops.length === 1 && ops[0].kind === "add_shift" && (ops[0] as any).location_id === 777 && (ops[0] as any).date === "2026-10-13", "one add_shift on the named order, at its location", JSON.stringify(d));
    ok(!ops.some((o) => o.kind === "set_position_times"), "no write touches the install");
  }
  {
    const d = await plan(msg("ops@legalgeek.co", "Thanks, the PO is Legal Geek", "RE: R9001"), I([], { intent: "info_only" }), world);
    ok(d.kind === "none", "an info-only email with no grounded PO writes nothing", JSON.stringify(d));
  }

  console.log("which shift a change means");
  {
    const d = await plan(msg("crew@eventconcept.com", "move the derig to 22:30-01:00 on the 6th"), I([r({ action: "change_times", start: "22:30", end: "01:00", target: { quote: "the derig", date: "2026-10-06" } })]), world);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 1 && ops[0].slot_id === 31 && ops[0].start === "22:30" && ops[0].end === "01:00", "the derig, not the install, on a two-shift day", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "change the shift on the 6th to 09:00"), I([r({ action: "change_times", start: "09:00", target: { quote: "the shift", date: "2026-10-06" } })]), world);
    ok(d.kind === "handoff", "two shifts that day and nothing saying which: ops", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "crew to arrive 08:30 on Friday 9th"), I([r({ action: "change_times", start: "08:30", date: "2026-10-09" })]), world);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 2 && ops.every((o) => o.start === "08:30" && o.end === "17:00"), "a new start moves every position on the shift and leaves the end as booked", JSON.stringify(ops));
  }

  console.log("a new length (Wonder London 10-09: 'increase hours to 8 (currently 6)')");
  {
    const d = await plan(msg("crew@eventconcept.com", "increase the hours to 10 on Friday 9th"), I([r({ action: "change_times", date: "2026-10-09", duration: 600 })]), world);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 2 && ops.every((o) => o.start === "09:00" && o.end === "19:00"), "the start stays and the end moves to start + length", JSON.stringify(ops));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "make the derig on the 6th 3 hours"), I([r({ action: "change_times", duration: 180, target: { quote: "the derig", date: "2026-10-06" } })]), world);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 1 && ops[0].start === "22:00" && ops[0].end === "01:00", "a length past midnight ends the next morning", JSON.stringify(ops));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "the 3 crew on the derig on the 6th, 3 hours"), I([r({ action: "change_times", crew: 3, duration: 180, target: { quote: "the derig", date: "2026-10-06" } })]), world);
    ok(d.kind === "handoff" && /says 3 crew, the shift has 2/.test(JSON.stringify(d)), "a crew count beside a time change that is not the shift's: ops", JSON.stringify(d));
  }

  console.log("a total and an increase together (Legal Geek 10-09: 'add 2 more, making it 4')");
  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 more on Friday 9th, making it 6"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2, crew: 6 })]), world);
    const op = d.kind === "write" ? (d.ops[0].op as any) : null;
    ok(op?.kind === "set_position_size" && op.size === 5, "they agree with the shift (4 + 2 = 6): crew position to 5 with the chief", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 more on Friday 9th, making it 5"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2, crew: 5 })]), world);
    ok(d.kind === "handoff" && /makes 6, not the 5 written/.test(JSON.stringify(d)), "they disagree with the shift: ops", JSON.stringify(d));
  }

  console.log("what goes to ops");
  {
    const d = await plan(msg("crew@eventconcept.com", "bump it up a couple"), I([r({ action: "change_crew", problems: ["request 1: no crew count the client wrote"] })]), world);
    ok(d.kind === "handoff", "'bump it up a couple' writes nothing (Ben, 10-06)");
  }
  {
    const d = await plan(msg("someone@unknown.example", "4 crew on the 9th"), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Business Design Centre" })], { intent: "booking" }), world);
    ok(d.kind === "handoff", "an unknown sender's company: ops");
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "quote for 4 crew"), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4 })], { intent: "quote_request" }), world);
    ok(d.kind === "handoff", "a quote request: ops (R11434)");
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew at the Old Vic on the 14th 18:45-20:45"), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4, venue: "the Old Vic" })], { intent: "booking" }), world);
    ok(d.kind === "handoff", "a venue OnSinch does not hold: ops");
  }

  console.log("a new booking");
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45"), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4, venue: "Business Design Centre" })], { intent: "booking", po: "E15626" }), world);
    const op = d.kind === "write" ? (d.ops[0].op as any) : null;
    ok(op?.kind === "create_order" && op.company_id === "137" && op.client_email === "crew@eventconcept.com" && op.po === "E15626" && op.shifts[0].place_id === "29" && op.shifts[0].positions.length === 2, "a new order: Event Concept, the sender as client, the PO, crew chief + 3", JSON.stringify(op));
  }

  console.log("already booked by hand (every engine order in To Confirm on 10-07)");
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew Friday 9th 09:00-17:00 at Business Design Centre"), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Business Design Centre" })], { intent: "booking" }), world);
    ok(d.kind === "none" && /R11352/.test((d as any).reason), "a shift ops already built is not booked again", JSON.stringify(d));
  }
  {
    // EMS 10-09: the Mandarin Oriental install had the Roundhouse derig's day and hours.
    const venues: World = { ...world, placesNamed: async (n) => (/business design centre/i.test(n) ? [{ id: 29, name: "Business Design Centre" }] : /olympia/i.test(n) ? [{ id: 31, name: "Olympia" }] : []) };
    const d = await plan(msg("crew@eventconcept.com", "4 crew Friday 9th 09:00-17:00 at Olympia"), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Olympia" })], { intent: "booking" }), venues);
    ok(d.kind === "write" && (d.ops[0].op as any).shifts[0].place_id === "31", "the same hours at another venue are not that booking", JSON.stringify(d).slice(0, 200));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre, 32 Upper St, London on 14/10 18:45-20:45"), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4, venue: "Business Design Centre, 32 Upper St, London" })], { intent: "booking" }), world);
    ok(d.kind === "write" && (d.ops[0].op as any).shifts[0].place_id === "29", "a venue written with its address matches on the name before the comma", JSON.stringify(d).slice(0, 200));
  }

  console.log("a thread already linked to an order never books a second one");
  {
    const booking = I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4, venue: "Business Design Centre" })], { intent: "booking" });
    // Linked to an order the read window cannot see (an old order, or the verifier's find).
    const unseen = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45"), booking, world, 99999);
    ok(unseen.kind === "handoff" && /linked to order 99999/.test(unseen.reasons[0]), "linked order not readable: left for a person, no create_order", JSON.stringify(unseen));
    // Linked to a readable order: the new shift goes onto it.
    const seen = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45"), booking, world, 16388);
    ok(seen.kind === "write" && seen.ops.every((o) => o.op.kind === "add_shift" && (o.op as any).order_id === 16388), "linked order readable: add_shift onto it", JSON.stringify(seen).slice(0, 200));
    // Not linked: a fresh order, as before.
    const fresh = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45"), booking, world, null);
    ok(fresh.kind === "write" && fresh.ops[0].op.kind === "create_order", "no link: create_order", JSON.stringify(fresh).slice(0, 160));
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})();
