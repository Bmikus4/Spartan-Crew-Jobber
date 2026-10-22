// ============================================================================
// The planner against the incidents and cases the rebuild exists for, on a fake OnSinch.
//
// Offline.  npx tsx test/v2Plan.ts
// ============================================================================
import { plan, positionsFor, chiefsFor, type World, type Message } from "../app/lib/v2/interpret/plan";
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
  { id: 2, name: "Install", Slot: [slot(21, "2026-10-08", "08:00", "14:00", 4)] },
  { id: 3, name: "Derig", Slot: [slot(31, "2026-10-08", "22:00", "23:30", 2)] },
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
const msg = (from: string, text: string, subject = "", sentIso = "2026-10-07T09:00:00Z"): Message => ({ message_id: "m1", from, subject, sentIso, text });
// The bot creates only orders more than two weeks out (Ben, 10-15), so a test of how a create is
// built sends its email three weeks before the booking.
const EARLY = "2026-09-20T09:00:00Z";
const r = (x: Partial<Request>): Request => ({ action: "new_shift", problems: [], ...x });
const I = (requests: Request[], extra: Partial<Interpretation> = {}): Interpretation => ({ intent: "change", requests, problems: [], ...extra });

console.log("positions by crew size (ops' practice)");
ok(JSON.stringify(positionsFor(3)) === JSON.stringify([{ size: 3, profession_id: "1" }]), "3 crew: plain crew");
ok(positionsFor(4)?.length === 2 && positionsFor(4)![0].role === "crew_chief" && positionsFor(4)![1].size === 3, "4 crew: crew chief + 3");
// Ben, 10-15: 4+ -> 1 chief, 10+ -> 2, 20+ -> 3, one more for every further 10, inside the headcount.
ok(JSON.stringify([1, 3, 4, 9, 10, 19, 20, 29, 30, 41].map((n) => chiefsFor(n))) === JSON.stringify([0, 0, 1, 1, 2, 2, 3, 3, 4, 5]), "chiefs per headcount follow Ben's bands", JSON.stringify([1, 3, 4, 9, 10, 19, 20, 29, 30, 41].map((n) => chiefsFor(n))));
ok(chiefsFor(2, true) === 1 && chiefsFor(1, true) === 1 && chiefsFor(3) === 0, "a chief the client asks for on 3 or fewer is booked, never refused");
ok(JSON.stringify(positionsFor(12)) === JSON.stringify([{ size: 2, profession_id: "36", role: "crew_chief" }, { size: 10, profession_id: "1" }]), "12 crew: 2 chiefs + 10, not refused", JSON.stringify(positionsFor(12)));
ok(JSON.stringify(positionsFor(25)) === JSON.stringify([{ size: 3, profession_id: "36", role: "crew_chief" }, { size: 22, profession_id: "1" }]), "25 crew: 3 chiefs + 22", JSON.stringify(positionsFor(25)));

(async () => {
  console.log("a change is never linked to an order by its day alone (Ben, 10-03)");
  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 crew to Steve's 4 on Friday 9th"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2 })]), world);
    ok(d.kind === "handoff" && /no order is named/.test(d.reasons.join()), "the client's only booking on the 9th is not enough: a person picks the order", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "Thanks, PO is 7781", "13/10 crew"), I([], { intent: "info_only", po: "7781" }), world);
    ok(d.kind === "none" && /left off: no order is named/.test(d.reason), "nor is a PO put on an order found by the subject's day", JSON.stringify(d));
  }

  console.log("R11425: 'add 2 crew to Steve's 4 on Friday 9th' is a change to R11352, not a new order");
  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 crew to Steve's 4 on Friday 9th"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2 })]), world, 16388);
    const op = d.kind === "write" ? d.ops[0].op : null;
    ok(d.kind === "write" && d.ops.length === 1 && op?.kind === "set_position_size" && (op as any).slot_id === 12 && (op as any).size === 5, "crew position 12 goes to 5 (6 in all with the chief)", JSON.stringify(d));
  }

  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 riggers to Steve's 4 on Friday 9th"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2, trade: "riggers" })]), world, 16388);
    const op = d.kind === "write" ? (d.ops[0].op as any) : null;
    ok(d.kind === "write" && d.ops.length === 1 && op?.kind === "set_position_size" && op.slot_id === 12 && op.size === 5 && d.why.some((w) => /booked as Crew/.test(w)), "a trade with no verified profession is added as standard crew (Ben, 10-11)", JSON.stringify(d));
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
    const d = await plan(msg("crew@eventconcept.com", "move the derig to 22:30-01:00 on the 8th"), I([r({ action: "change_times", start: "22:30", end: "01:00", target: { quote: "the derig", date: "2026-10-08" } })]), world, 16220);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 1 && ops[0].slot_id === 31 && ops[0].start === "22:30" && ops[0].end === "01:00", "the derig, not the install, on a two-shift day", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "change the shift on the 8th to 09:00"), I([r({ action: "change_times", start: "09:00", target: { quote: "the shift", date: "2026-10-08" } })]), world, 16220);
    ok(d.kind === "handoff", "two shifts that day and nothing saying which: ops", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "crew to arrive 08:30 on Friday 9th"), I([r({ action: "change_times", start: "08:30", date: "2026-10-09" })]), world, 16388);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    // Measured 10-15 on staff's own edits: an earlier start kept the shift's length 10 times in
    // 10 and never kept the end; a later start split 9 and 9, and keeping the end can leave no
    // shift at all (R11029, 14:00-17:00 asked for 17:00).
    ok(ops.length === 2 && ops.every((o) => o.start === "08:30" && o.end === "16:30"), "a new start moves every position on the shift and keeps its length", JSON.stringify(ops));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "Can the crew arrive for 17:00 instead of 09:00 on Friday 9th"), I([r({ action: "change_times", start: "17:00", date: "2026-10-09" })]), world, 16388);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 2 && ops.every((o) => o.start === "17:00" && o.end === "01:00"), "a start moved to the old end keeps the 8 hours: never a shift from 17:00 to 17:00", JSON.stringify(d));
  }

  console.log("a new length (Wonder London 10-09: 'increase hours to 8 (currently 6)')");
  {
    const d = await plan(msg("crew@eventconcept.com", "increase the hours to 10 on Friday 9th"), I([r({ action: "change_times", date: "2026-10-09", duration: 600 })]), world, 16388);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 2 && ops.every((o) => o.start === "09:00" && o.end === "19:00"), "the start stays and the end moves to start + length", JSON.stringify(ops));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "make the derig on the 8th 3 hours"), I([r({ action: "change_times", duration: 180, target: { quote: "the derig", date: "2026-10-08" } })]), world, 16220);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 1 && ops[0].start === "22:00" && ops[0].end === "01:00", "a length past midnight ends the next morning", JSON.stringify(ops));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "the 3 crew on the derig on the 8th, 3 hours"), I([r({ action: "change_times", crew: 3, duration: 180, target: { quote: "the derig", date: "2026-10-08" } })]), world, 16220);
    ok(d.kind === "handoff" && /says 3 crew, the shift has 2/.test(JSON.stringify(d)), "a crew count beside a time change that is not the shift's: ops", JSON.stringify(d));
  }

  console.log("a total and an increase together (Legal Geek 10-09: 'add 2 more, making it 4')");
  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 more on Friday 9th, making it 6"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2, crew: 6 })]), world, 16388);
    const op = d.kind === "write" ? (d.ops[0].op as any) : null;
    ok(op?.kind === "set_position_size" && op.size === 5, "they agree with the shift (4 + 2 = 6): crew position to 5 with the chief", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "add 2 more on Friday 9th, making it 5"), I([r({ action: "change_crew", date: "2026-10-09", crew_add: 2, crew: 5 })]), world, 16388);
    ok(d.kind === "handoff" && /makes 6, not the 5 written/.test(JSON.stringify(d)), "they disagree with the shift: ops", JSON.stringify(d));
  }

  console.log("what goes to ops");
  {
    const d = await plan(msg("crew@eventconcept.com", "bump it up a couple"), I([r({ action: "change_crew", problems: ["request 1: no crew count the client wrote"] })]), world);
    ok(d.kind === "handoff", "'bump it up a couple' writes nothing (Ben, 10-06)");
  }
  {
    const d = await plan(msg("someone@unknown.example", "4 crew on the 9th"), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Business Design Centre" })], { intent: "booking" }), world);
    ok(d.kind === "handoff", "an unknown sender with no company name written: ops");
    const n = await plan(msg("jo@atcomms.example", "4 crew on the 9th", "", EARLY), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Business Design Centre" })], { intent: "booking", company_name: "AT Comms" }), world);
    const op = n.kind === "write" ? (n.ops[0].op as any) : null;
    ok(op?.kind === "create_order" && op.company_id === "new:AT Comms" && /^AT Comms @ /.test(op.job_name), "a new client's first booking creates the client from its written name, then the order", JSON.stringify(n));
    // The company made for that booking has no contact (the API cannot add one) and carries the
    // sender as its invoice email. The sender's next booking, in a new thread, is that client's.
    const after: World = { ...world, companies: async () => [...(await world.companies()), { id: 900, name: "AT Comms", email_invoice: "jo@atcomms.example", Client: [] }] };
    const again = await plan(msg("jo@atcomms.example", "4 crew on the 9th", "", EARLY), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Business Design Centre" })], { intent: "booking", company_name: "AT Comms" }), after);
    const op2 = again.kind === "write" ? (again.ops[0].op as any) : null;
    ok(op2?.kind === "create_order" && op2.company_id === "900", "the new client's next booking from the same sender is booked to that client, not a card", JSON.stringify(again));
    const colleague = await plan(msg("sam@atcomms.example", "4 crew on the 9th", "", EARLY), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Business Design Centre" })], { intent: "booking", company_name: "AT Comms" }), after);
    ok(colleague.kind === "handoff", "a colleague at the same domain is still a card until staff add a contact", JSON.stringify(colleague));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "quote for 4 crew"), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4 })], { intent: "quote_request" }), world);
    ok(d.kind === "handoff", "a quote request: ops (R11434)");
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew at the Old Vic on the 14th 18:45-20:45", "", EARLY), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4, venue: "the Old Vic" })], { intent: "booking" }), world);
    const s0 = d.kind === "write" && d.ops[0].op.kind === "create_order" ? d.ops[0].op.shifts[0] : null;
    ok(!!s0 && s0.place_id === "new:the Old Vic" && d.kind === "write" && d.why.some((w) => /new to OnSinch/.test(w)), "a venue OnSinch does not hold is added as written, as ops add one", JSON.stringify(d));
  }

  console.log("a new booking");
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45", "", EARLY), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4, venue: "Business Design Centre" })], { intent: "booking", po: "E15626" }), world);
    const op = d.kind === "write" ? (d.ops[0].op as any) : null;
    ok(op?.kind === "create_order" && op.company_id === "137" && op.client_email === "crew@eventconcept.com" && op.po === "E15626" && op.shifts[0].place_id === "29" && op.shifts[0].positions.length === 2, "a new order: Event Concept, the sender as client, the PO, crew chief + 3", JSON.stringify(op));
  }

  console.log("the crew chief rule at every size (Ben, 10-15)");
  {
    const d = await plan(msg("crew@eventconcept.com", "12 crew at Business Design Centre on 14/10 08:00-16:00", "", EARLY), I([r({ date: "2026-10-14", start: "08:00", end: "16:00", crew: 12, venue: "Business Design Centre" })], { intent: "booking" }), world);
    const p0 = d.kind === "write" && d.ops[0].op.kind === "create_order" ? d.ops[0].op.shifts[0].positions : null;
    ok(JSON.stringify(p0) === JSON.stringify([{ size: 2, profession_id: "36", role: "crew_chief" }, { size: 10, profession_id: "1" }]), "12 crew is booked, not refused: 2 chiefs + 10", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "2 crew and a crew chief at Business Design Centre on 14/10 08:00-16:00", "", EARLY), I([r({ date: "2026-10-14", start: "08:00", end: "16:00", crew: 3, crew_chief: true, venue: "Business Design Centre" })], { intent: "booking" }), world);
    const p0 = d.kind === "write" && d.ops[0].op.kind === "create_order" ? d.ops[0].op.shifts[0].positions : null;
    ok(JSON.stringify(p0) === JSON.stringify([{ size: 1, profession_id: "36", role: "crew_chief" }, { size: 2, profession_id: "1" }]), "a chief asked for on a crew of 3 is booked, not refused", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "make Friday 9th 12 crew"), I([r({ action: "change_crew", date: "2026-10-09", crew: 12 })]), world, 16388);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 2 && ops.some((o) => o.kind === "set_position_size" && o.slot_id === 11 && o.size === 2) && ops.some((o) => o.kind === "set_position_size" && o.slot_id === 12 && o.size === 10), "4 to 12 on R11352: the chief position goes to 2, crew to 10", JSON.stringify(d));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "drop Friday 9th to 3 crew"), I([r({ action: "change_crew", date: "2026-10-09", crew: 3 })]), world, 16388);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 1 && ops[0].kind === "cancel_position" && ops[0].slot_id === 11, "4 to 3 (chief + 3): the chief is cancelled, the 3 crew stay as they are", JSON.stringify(d));
  }

  console.log("what the client did not write is assumed and said (Ben, 10-15)");
  {
    const loose: World = { ...world, placesNamed: async (n) => (/^no location$/i.test(n) ? [{ id: 6922, name: "No Location" }] : /olympia/i.test(n) ? [{ id: 31, name: "Olympia" }, { id: 7001, name: "Olympia" }] : []),
      allPlaces: async () => [{ id: 6922, name: "No Location" }, { id: 31, name: "Olympia", address: "Hammersmith Rd, London W14 8UX" }, { id: 7001, name: "Olympia" }] };
    const d = await plan(msg("crew@eventconcept.com", "4 crew please on 20/11", "", EARLY), I([r({ date: "2026-11-20", crew: 4 })], { intent: "booking" }), loose);
    const op = d.kind === "write" && d.ops[0].op.kind === "create_order" ? d.ops[0].op : null;
    ok(!!op && op.shifts[0].place_id === "6922" && op.shifts[0].start === "08:00" && op.shifts[0].end === "12:00", "no venue, no times: booked at No Location, 08:00-12:00", JSON.stringify(d).slice(0, 300));
    ok(!!op && /CHECK, assumed: .*no start time written/.test(op.specification ?? "") && /CHECK, assumed: no venue written/.test(op.specification ?? ""), "the order itself tells staff what was assumed", op?.specification);
    const v = await plan(msg("crew@eventconcept.com", "4 crew at Olympia 20/11 09:00-17:00", "", EARLY), I([r({ date: "2026-11-20", start: "09:00", end: "17:00", crew: 4, venue: "Olympia" })], { intent: "booking" }), loose);
    const vo = v.kind === "write" && v.ops[0].op.kind === "create_order" ? v.ops[0].op : null;
    ok(!!vo && vo.shifts[0].place_id === "31" && v.kind === "write" && v.why.some((w) => /2 OnSinch venues are named "Olympia"; booked at Olympia \(place 31\)/.test(w)), "two places named Olympia, none booked before: the one with an address, flagged", JSON.stringify(v).slice(0, 300));
  }

  {
    // R11349 (10-15): a shift added to an order at two venues, the email naming neither.
    const two = { id: 16500, number: "11349", company_id: 137, intern_name: "", Job: [{ SlotTeam: [
      { id: 7, name: "Crew", Slot: [{ ...slot(71, "2026-11-10", "08:00", "16:00", 4, false, 501), SlotLocation: { place_id: 61 } }, { ...slot(72, "2026-11-10", "08:00", "16:00", 1, true, 501), SlotLocation: { place_id: 61 } }] },
      { id: 8, name: "Crew", Slot: [{ ...slot(81, "2026-11-11", "08:00", "16:00", 4, false, 502), SlotLocation: { place_id: 62 } }] },
    ] }] };
    const w2: World = { ...world, companyOrders: async () => [two] };
    const d = await plan(msg("crew@eventconcept.com", "please add 4 crew on 12/11 08:00-16:00 too"), I([r({ date: "2026-11-12", start: "08:00", end: "16:00", crew: 4 })]), w2, 16500);
    const op = d.kind === "write" ? (d.ops[0].op as any) : null;
    ok(op?.kind === "add_shift" && op.location_id === 501 && d.kind === "write" && d.why.some((x) => /2 locations and the email names none/.test(x)), "two venues, none named: the one most of its shifts use, flagged", JSON.stringify(d).slice(0, 300));
  }

  console.log("already booked by hand (every engine order in To Confirm on 10-07)");
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew Friday 9th 09:00-17:00 at Business Design Centre"), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Business Design Centre" })], { intent: "booking" }), world);
    ok(d.kind === "none" && /R11352/.test((d as any).reason), "a shift ops already built is not booked again", JSON.stringify(d));
    ok(d.kind === "none" && JSON.stringify(d.found) === "[16388]", "and the order found is named, so the thread is linked to it", JSON.stringify(d));
  }
  {
    // EMS 10-09: the Mandarin Oriental install had the Roundhouse derig's day and hours.
    const venues: World = { ...world, placesNamed: async (n) => (/business design centre/i.test(n) ? [{ id: 29, name: "Business Design Centre" }] : /olympia/i.test(n) ? [{ id: 31, name: "Olympia" }] : []) };
    const d = await plan(msg("crew@eventconcept.com", "4 crew Friday 9th 09:00-17:00 at Olympia", "", EARLY), I([r({ date: "2026-10-09", start: "09:00", end: "17:00", crew: 4, venue: "Olympia" })], { intent: "booking" }), venues);
    ok(d.kind === "write" && (d.ops[0].op as any).shifts[0].place_id === "31", "the same hours at another venue are not that booking", JSON.stringify(d).slice(0, 200));
  }
  {
    const d = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre, 32 Upper St, London on 14/10 18:45-20:45", "", EARLY), I([r({ date: "2026-10-14", start: "18:45", end: "20:45", crew: 4, venue: "Business Design Centre, 32 Upper St, London" })], { intent: "booking" }), world);
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

    // Ben, 10-15: new orders only when more than two weeks out; every update stays on.
    const at = (sent: string) => plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45", "", sent), booking, world, null);
    const d14 = await at("2026-09-30T09:00:00Z");
    ok(d14.kind === "handoff" && /within 14 days of the email, is for staff to create/.test(d14.reasons[0]), "a new order 14 days out is staff's to create", JSON.stringify(d14));
    const d15 = await at("2026-09-29T09:00:00Z");
    ok(d15.kind === "write" && d15.ops[0].op.kind === "create_order", "a new order 15 days out is created", JSON.stringify(d15).slice(0, 160));
    ok(seen.kind === "write", "a shift added to an existing order a week out is still written: updates are not held to two weeks");
    // The days are a setting (Ben: "make it a setting in the settings screen").
    const d7 = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45", "", "2026-10-06T09:00:00Z"), booking, world, null, { leadDays: 7 });
    ok(d7.kind === "write" && d7.ops[0].op.kind === "create_order", "with the setting at 7, a new order 8 days out is created", JSON.stringify(d7).slice(0, 160));
    // Ben, 10-16: "keep the two week rule on, but allow it to be disabled in settings".
    const off = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45", "", "2026-10-12T09:00:00Z"), booking, world, null, { leadDays: null });
    ok(off.kind === "write" && off.ops[0].op.kind === "create_order", "with the rule switched off, a new order 2 days out is created", JSON.stringify(off).slice(0, 160));
    const dflt = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45", "", "2026-10-12T09:00:00Z"), booking, world, null, {});
    ok(dflt.kind === "handoff", "with no setting given, the rule is on");
    // Not linked: a fresh order, as before.
    const fresh = await plan(msg("crew@eventconcept.com", "4 crew at Business Design Centre on 14/10 18:45-20:45", "", EARLY), booking, world, null);
    ok(fresh.kind === "write" && fresh.ops[0].op.kind === "create_order", "no link: create_order", JSON.stringify(fresh).slice(0, 160));
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})();
