// ============================================================================
// The shift an email means, by its venue on an order at several, and the near miss (addendum
// F9's strict half, F10; R8c).
// ----------------------------------------------------------------------------
// bookedAt and targetShift were blind to the venue: on an order standing at Olympia and ExCeL with
// the same window, "the ExCeL call" could change Olympia's shift, and a new ExCeL shift read as
// already booked by Olympia's. A shift staff booked at 07:30 against an asked 08:00 counted as
// fresh, so the bot could book the same job twice. Both are now settled here, or handed to a person.
// Offline.  npx tsx --require ./test/fixtures/pg.ts test/v2Shifts.ts
// ============================================================================
import { plan, type World, type Message } from "../app/lib/v2/interpret/plan";
import type { Interpretation, Request } from "../app/lib/v2/interpret/interpret";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const slot = (id: number, day: string, start: string, end: string, size: number, place: number) =>
  ({ id, beginning: `${day}T${start}:00Z`, end: `${day}T${end}:00Z`, size, profession_id: 1, role: 0, slotlocation_id: 800 + place, SlotLocation: { place_id: place } });
const order = (id: number, number: string, teams: Array<{ id: number; name: string; slots: any[] }>) =>
  ({ id, number, company_id: 340, status: 1, intern_name: "", name: `Two Halls R${number}`, created: "2026-09-01T09:00:00Z", creator: 2850,
    Job: [{ id: id + 1000, SlotTeam: teams.map((t) => ({ id: t.id, name: t.name, Slot: t.slots })) }] });

// R12100 stands at Olympia (31) and ExCeL (49): the same 09:00-17:00 call, 4 crew, at each, Wed 18 Nov (GMT).
const TWO = order(21001, "12100", [
  { id: 1, name: "Crew", slots: [slot(11, "2026-11-18", "09:00", "17:00", 4, 31)] },
  { id: 2, name: "Crew", slots: [slot(21, "2026-11-18", "09:00", "17:00", 4, 49)] },
]);
// R12101 stands at Olympia on the 18th and at ExCeL on the 19th.
const SPLIT = order(21002, "12101", [
  { id: 3, name: "Crew", slots: [slot(31, "2026-11-18", "09:00", "17:00", 4, 31)] },
  { id: 4, name: "Crew", slots: [slot(41, "2026-11-19", "09:00", "17:00", 4, 49)] },
]);
// R12102: staff booked 3 crew 07:30-15:30 at Olympia on Fri 20 Nov.
const EARLY = order(21003, "12102", [{ id: 5, name: "Crew", slots: [slot(51, "2026-11-20", "07:30", "15:30", 3, 31)] }]);

const orders = [TWO, SPLIT, EARLY];
const world: World = {
  companies: async () => [{ id: 340, name: "Two Halls", Client: [{ id: 1, email: "pm@twohalls.co.uk" }] }],
  placesNamed: async (n) => (/^excel$/i.test(n.trim()) ? [{ id: 49, name: "ExCeL" }] : /^olympia$/i.test(n.trim()) ? [{ id: 31, name: "Olympia" }] : []),
  allPlaces: async () => [{ id: 31, name: "Olympia", address: "Hammersmith Rd" }, { id: 49, name: "ExCeL", address: "Royal Victoria Dock" }],
  companyOrders: async () => orders,
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
};
const msg = (text: string, subject = ""): Message => ({ message_id: "m1", from: "pm@twohalls.co.uk", subject, sentIso: "2026-10-27T09:00:00Z", text });
const r = (x: Partial<Request>): Request => ({ action: "new_shift", problems: [], ...x });
const I = (requests: Request[], intent: Interpretation["intent"] = "change"): Interpretation => ({ intent, requests, problems: [] });
const opts = { now: Date.parse("2026-10-27T09:00:00Z") };

(async () => {
  console.log("\n[F10] the venue picks the shift on an order standing at two");
  {
    const d = await plan(msg("make the ExCeL call on the 18th 6 crew", "R12100"), I([r({ action: "change_crew", crew: 6, venue: "ExCeL", target: { date: "2026-11-18", quote: "the ExCeL call" } })]), world, null, opts);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length > 0 && ops.every((o) => o.slot_id === 21 || o.shift_id === 2), "the change goes on ExCeL's shift, never Olympia's", d);
    const blind = await plan(msg("make the call on the 18th 6 crew", "R12100"), I([r({ action: "change_crew", crew: 6, target: { quote: "the call on the 18th", date: "2026-11-18" } })]), world, null, opts);
    ok(blind.kind === "handoff" && /2 shifts on 2026-11-18/.test(blind.reasons.join()), "with no venue written, which of the two is for a person", blind);
  }
  {
    const d = await plan(msg("please add 4 crew at ExCeL on the 18th, 9-5", "R12101"), I([r({ date: "2026-11-18", start: "09:00", end: "17:00", crew: 4, venue: "ExCeL" })], "booking"), world, null, opts);
    const ops = d.kind === "write" ? d.ops.map((o) => o.op as any) : [];
    ok(ops.length === 1 && ops[0].kind === "add_shift" && ops[0].location_id === 849, "a new ExCeL shift is not 'already booked' by Olympia's at the same time; it goes at ExCeL", d);
  }

  console.log("\n[F9] the near miss: staff's 07:30 against an asked 08:00 is for a person, never a second booking");
  {
    const d = await plan(msg("3 crew at Olympia on Friday 20th, 8am-4pm please"), I([r({ date: "2026-11-20", start: "08:00", end: "16:00", crew: 3, venue: "Olympia" })], "booking"), world, null, opts);
    ok(d.kind === "handoff" && /R12102/.test(d.reasons.join()) && /07:30/.test(d.reasons.join()), "the unnamed path hands it over, naming the order and its start", d);
    const named = await plan(msg("add 3 crew on the 20th, 8am-4pm", "R12102"), I([r({ date: "2026-11-20", start: "08:00", end: "16:00", crew: 3 })], "booking"), world, null, opts);
    ok(named.kind === "handoff" && /07:30/.test(named.reasons.join()), "on the named order too: no second shift beside it", named);
    const far = await plan(msg("3 crew at Olympia on Friday 20th, 6pm-11pm please"), I([r({ date: "2026-11-20", start: "18:00", end: "23:00", crew: 3, venue: "Olympia" })], "booking"), world, null, opts);
    ok(far.kind === "write", "an evening call that day is another call: booked as asked", far);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
