// ============================================================================
// A crew change with hours of its own, or two changes to one position, goes to a person.
// ----------------------------------------------------------------------------
// eval/next-block.md N2, from three dev writes judged wrong (eval/write-breakdown.md):
//   1a13fea576aeda13: 4 crew "from 17:00 for 4 hours" on a 17:00-23:00 shift booked all 4 to 23:00;
//   1a154d69fc48ba38: "2 more, 22:00-01:00" on a 22:00-03:00 shift kept the 2 to 03:00;
//   1a121640a61d9b46: 4 crew for 2 h and 2 crew for 4 h on one 07:00 call sized one position 3, then 2.
// Staff split such shifts by hours, which the planner cannot yet do, so it hands them off. The shapes
// are the cases'; no email text.
// npx tsx test/planCrewHours.ts
// ============================================================================
import { plan, type World, type Message } from "../app/lib/v2/interpret/plan";
import type { Interpretation, Request } from "../app/lib/v2/interpret/interpret";
import { coded } from "../app/lib/v2/reasons";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const pos = (id: number, b: string, e: string, size: number, chief = false) =>
  ({ id, beginning: b, end: e, size, profession_id: chief ? 36 : 1, role: chief ? 1 : 0, SlotLocation: { place_id: 29 } });
// R11613: 3 crew 17:00-23:00 London on 19 Oct. R11349: 3 crew 22:00-03:00 on 22 Oct.
const R11613 = { id: 16670, number: "11613", company_id: 310, intern_name: "", Job: [{ SlotTeam: [{ id: 42596, name: "Crew", Slot: [pos(59905, "2026-10-19T17:00:00+01:00", "2026-10-19T23:00:00+01:00", 3)] }] }] };
const R11349 = { id: 16385, number: "11349", company_id: 310, intern_name: "", Job: [{ SlotTeam: [{ id: 41899, name: "Crew", Slot: [pos(58866, "2026-10-22T22:00:00+01:00", "2026-10-23T03:00:00+01:00", 3)] }] }] };
const world: World = {
  companies: async () => [{ id: 310, name: "Client", Client: [{ id: 1, email: "ops@client.example" }] }],
  placesNamed: async () => [],
  companyOrders: async (c) => (c === 310 ? [R11613, R11349] : []),
  orderByNumber: async (n) => [R11613, R11349].find((o) => o.number === n) ?? null,
};
const msg: Message = { message_id: "m1", from: "ops@client.example", subject: "crew", sentIso: "2026-10-15T13:14:00Z", text: "(the email)" };
const r = (x: Partial<Request>): Request => ({ action: "change_crew", problems: [], ...x } as Request);
const I = (requests: Request[]): Interpretation => ({ intent: "change", requests, problems: [] });
const handedOff = (d: any, re: RegExp) => d.kind === "handoff" && d.reasons.some((x: string) => re.test(x));

(async () => {
  console.log("\na crew change with its own hours");
  const four = await plan(msg, I([r({ crew: 4, start: "17:00", duration: 240, date: "2026-10-19", target: { quote: "17:00", date: "2026-10-19", start: "17:00" } })]), world, 16670);
  ok(handedOff(four, /a crew change for 17:00-21:00, the shift is 17:00-23:00/), "4 crew from 17:00 for 4 hours on a 17:00-23:00 shift is handed off", four);
  ok(coded(four as any).code === "request_unsupported", "and coded request_unsupported", coded(four as any).code);
  const two = await plan(msg, I([r({ crew_add: 2, start: "22:00", end: "01:00", date: "2026-10-22" })]), world, 16385);
  ok(handedOff(two, /a crew change for 22:00-01:00, the shift is 22:00-03:00/), "2 more 22:00-01:00 on a 22:00-03:00 shift is handed off", two);

  console.log("\nthe same changes with the shift's own hours, or none, still write");
  const same = await plan(msg, I([r({ crew_add: 2, start: "22:00", end: "03:00", date: "2026-10-22" })]), world, 16385);
  ok(same.kind === "write", "2 more 22:00-03:00 on that shift writes", same);
  const none = await plan(msg, I([r({ crew_add: 2, date: "2026-10-22" })]), world, 16385);
  ok(none.kind === "write", "2 more with no hours writes", none);

  console.log("\ntwo changes to one position in one email");
  const both = await plan(msg, I([r({ crew: 4, date: "2026-10-22" }), r({ crew: 2, date: "2026-10-22" })]), world, 16385);
  ok(handedOff(both, /changes in one email/), "two counts for one shift are handed off, not applied one after the other", both);
  ok(coded(both as any).code === "request_inconsistent", "and coded request_inconsistent", coded(both as any).code);

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})();
