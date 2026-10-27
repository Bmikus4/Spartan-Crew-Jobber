// ============================================================================
// Everyday requests the system refused are planned, without guessing (addendum Prompt 5).
// ----------------------------------------------------------------------------
// F24: "move to 10:00 and make it 8 crew" was a card, because a count beside a time change was only
// ever read as naming the shift. F25: a trade could only be added to, never set or reduced. F8: a
// quote holding the old and the new value ("was 08:00, make it 09:00") let the old one through, and
// a reply's subject could supply a new value. "20-Nov" was not a date. A malformed reading threw.
// Offline: recorded readings and a fake OnSinch.
// npx tsx test/v2EverydayRequests.ts
// ============================================================================
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import { ground } from "../app/lib/v2/interpret/interpret";
import type { World } from "../app/lib/v2/interpret/plan";
import type { Op } from "../app/lib/v2/bot/ops";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
const SENT = "2026-10-15T09:00:00Z";
const FRI = { quote: "Friday 20/11", date: G("2026-11-20", "20/11"), start: null };

const slot = (id: number, start: string, end: string, size: number, prof = 1, role = 0) =>
  ({ id, beginning: `2026-11-20T${start}:00+00:00`, end: `2026-11-20T${end}:00+00:00`, size, profession_id: prof, role, SlotLocation: { place_id: 29 } });
const order = (id: number, number: string, team: number, slots: ReturnType<typeof slot>[]) =>
  ({ id, number, company_id: 137, creator: 110, created: "2026-10-01T10:00:00Z", Job: [{ id: id + 1, SlotTeam: [{ id: team, name: "Crew", Slot: slots }] }] });
// GMT on 20 Nov, so the London times are the UTC ones.
const R100 = order(16100, "11100", 501, [slot(61, "08:00", "16:00", 4)]);
const R300 = order(16300, "11300", 503, [slot(71, "08:00", "16:00", 4), slot(72, "08:00", "16:00", 1, 36, 1), slot(73, "08:00", "16:00", 2, 22)]);
const world = (orders: any[]): World => ({
  companies: async () => [{ id: 137, name: "Event Concept", Client: [{ id: 1, email: "crew@eventconcept.com" }] }],
  placesNamed: async () => [{ id: 29, name: "Business Design Centre" }],
  allPlaces: async () => [{ id: 29, name: "Business Design Centre" }],
  companyOrders: async () => orders,
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
});
const recorded: any[] = [];
const decide = (text: string, subject: string, requests: unknown, orders: any[]) => decideMessage(
  { message_id: "m1", thread_id: "t1", from_address: "crew@eventconcept.com", date_iso: SENT, subject, body: text, is_from_spartan: false },
  { extract: (async () => ({ x: { intent: "change", po: null, note: "", requests }, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
    world: world(orders), threadOrderId: async () => null, run: null, record: async (r: unknown) => { recorded.push(r); }, trace: () => {} } as DecideDeps);
const opsOf = (d: any): Op[] => (d.kind === "write" ? d.ops.map((o: any) => o.op) : []);
const brief = (ops: Op[]) => ops.map((o: any) => [o.kind, o.slot_id ?? o.position?.role ?? "", o.size ?? o.position?.size ?? "", o.start ?? "", o.end ?? ""].join(":")).sort().join(" ");

(async () => {
  console.log("\n[F24] a time change and a new crew total, one target state");
  {
    const text = "Hi, for R11100 on Friday 20/11 can you move them to 10:00 and make it 8 crew please";
    const one = [{ ...base, action: "change_times", order: "R11100", target: FRI, start: G("10:00", "move them to 10:00"), crew: G(8, "make it 8 crew") }];
    const d = await decide(text, "R11100", one, [R100]);
    const want = "add_position:crew_chief:1:10:00:18:00 set_position_size:61:7:: set_position_times:61::10:00:18:00";
    ok(brief(opsOf(d.decision)) === want, "one request: times to 10:00-18:00, 8 in all with a chief added at the new times", { got: brief(opsOf(d.decision)), d: d.decision });
    const two = [{ ...base, action: "change_times", order: "R11100", target: FRI, start: G("10:00", "move them to 10:00") }, { ...base, action: "change_crew", order: "R11100", target: FRI, crew: G(8, "make it 8 crew") }];
    const d2 = await decide(text, "R11100", two, [R100]);
    ok(brief(opsOf(d2.decision)) === want, "read as two requests: the same plan", { got: brief(opsOf(d2.decision)) });
    const id = [{ ...base, action: "change_times", order: "R11100", target: FRI, start: G("10:00", "10:00"), crew: G(6, "6 crew") }];
    const d3 = await decide("Hi, R11100: the 6 crew on Friday 20/11, can they start at 10:00", "R11100", id, [R100]);
    ok(d3.decision.kind === "handoff", "control: a bare count beside a time still names the shift, and 6 is not this shift's 4", d3.decision);
  }

  console.log("\n[F25] a trade's total or reduction on its one position");
  {
    const three = [{ ...base, action: "change_crew", order: "R11300", target: FRI, trade: G("forklift", "forkies"), crew: G(3, "make it 3 forkies") }];
    const d = await decide("For R11300 on Friday 20/11 can you make it 3 forkies", "R11300", three, [R300]);
    ok(brief(opsOf(d.decision)) === "set_position_size:73:3::", "make it 3 forkies: the forklift position to 3", { got: brief(opsOf(d.decision)), d: d.decision });
    const drop = [{ ...base, action: "change_crew", order: "R11300", target: FRI, trade: G("forklift", "forklift"), crew_remove: G(1, "drop one forklift") }];
    const d2 = await decide("For R11300 on Friday 20/11 please drop one forklift", "R11300", drop, [R300]);
    ok(brief(opsOf(d2.decision)) === "set_position_size:73:1::", "drop one forklift: 2 to 1", { got: brief(opsOf(d2.decision)), d: d2.decision });
    const both = [{ ...base, action: "change_crew", order: "R11300", target: FRI, trade: G("forklift", "forklifts"), crew_remove: G(2, "remove the 2 forklifts") }];
    const d3 = await decide("For R11300 on Friday 20/11 please remove the 2 forklifts", "R11300", both, [R300]);
    ok(brief(opsOf(d3.decision)) === "cancel_position:73:::", "down to none: the position is cancelled", { got: brief(opsOf(d3.decision)), d: d3.decision });
    const none = [{ ...base, action: "change_crew", order: "R11100", target: FRI, trade: G("forklift", "forkies"), crew: G(3, "make it 3 forkies") }];
    const d4 = await decide("For R11100 on Friday 20/11 can you make it 3 forkies", "R11100", none, [R100]);
    ok(brief(opsOf(d4.decision)) === "add_position::3:08:00:16:00", "no forklift position yet: a total of 3 is an addition of 3", { got: brief(opsOf(d4.decision)), d: d4.decision });
    const tooFew = [{ ...base, action: "change_crew", order: "R11300", target: FRI, trade: G("forklift", "forklifts"), crew_remove: G(3, "drop 3 forklifts") }];
    const d5 = await decide("For R11300 on Friday 20/11 please drop 3 forklifts", "R11300", tooFew, [R300]);
    ok(d5.decision.kind === "handoff", "3 fewer than 2 booked: a card, never a guess", d5.decision);
  }

  console.log("\n[F8] the old value of a change never passes for the new one");
  {
    const text = "Hi, R11100 on Friday 20/11: the start was 08:00, make it 09:00 please";
    const req = (v: string) => [{ ...base, action: "change_times", order: "R11100", target: FRI, start: G(v, "was 08:00, make it 09:00") }];
    const old = ground({ intent: "change", po: null, note: "", requests: req("08:00") } as any, text, SENT, { subject: "R11100" }).requests[0];
    ok(old.start === undefined && old.problems.length > 0, "was 08:00, make it 09:00: 08:00 is refused", old);
    const fresh = ground({ intent: "change", po: null, note: "", requests: req("09:00") } as any, text, SENT, { subject: "R11100" }).requests[0];
    ok(fresh.start === "09:00" && !fresh.problems.length, "and 09:00 stands", fresh);
    const d = await decide(text, "R11100", req("09:00"), [R100]);
    ok(brief(opsOf(d.decision)) === "set_position_times:61::09:00:17:00", "planned 09:00-17:00", { got: brief(opsOf(d.decision)) });
    const sub = "Re: 4 crew 08:00-16:00 Friday 20/11 R11100";
    const fromSubject = ground({ intent: "change", po: null, note: "", requests: [{ ...base, action: "change_times", order: "R11100", target: FRI, start: G("08:00", "08:00") }] } as any,
      `${sub}\nCan they start at 09:00 instead?`, SENT, { subject: sub }).requests[0];
    ok(fromSubject.start === undefined, "a reply's subject does not supply a new value", fromSubject);
    const inTable = ground({ intent: "change", po: null, note: "", requests: [{ ...base, action: "change_times", order: "R11100", target: FRI, start: G("10:00", "from 10:00"), crew: G(4, "4 crew") }] } as any,
      "Hi, R11100: the 4 crew on Friday 20/11, from 10:00 instead of 08:00 please", SENT, { subject: "R11100" }).requests[0];
    ok(inTable.start === "10:00" && inTable.crew === 4, "control: values outside the direction words still ground", inTable);
  }

  console.log("\n[dates] narrow shapes clients write");
  {
    const x: any = { intent: "booking", po: null, note: "", requests: [{ ...base, action: "new_shift", date: G("2026-11-20", "20-Nov"), start: G("08:00", "08:00"), end: G("16:00", "16:00"), crew: G(4, "4 crew") }] };
    const q = ground(x, "Please book 4 crew on 20-Nov, 08:00 to 16:00 at Business Design Centre", SENT, { subject: "Booking" }).requests[0];
    ok(q.date === "2026-11-20" && !q.problems.length, "20-Nov is 20 November", q);
  }

  console.log("\n[schema] a malformed reading is one recorded card, never a throw");
  for (const [what, requests] of [["requests not a list", "4 crew"], ["a request with no action", [{ ...base, action: undefined }]], ["a request that is not an object", [null]]] as const) {
    recorded.length = 0;
    const d = await decide("Can we have 4 crew on Friday 20/11", "Crew", requests, [R100]).then((r) => r, (e) => ({ threw: String(e) }));
    ok(!("threw" in d) && recorded.length === 1 && recorded[0].kind === "handoff" && /could not read this email \(malformed reading/.test(recorded[0].decision.reasons?.[0] ?? ""), `${what}: one handoff recorded`, { d, recorded: recorded.map((r) => r.decision) });
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
