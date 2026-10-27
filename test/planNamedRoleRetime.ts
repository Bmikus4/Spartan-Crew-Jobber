// ============================================================================
// A time change for a named role or trade moves only those positions.
// ----------------------------------------------------------------------------
// 1a13585d743572a8 (eval/next-block.md N2): the reading asked for the forklift driver and the crew chief
// from 07:00 on a shift of 6 crew, a chief and a forklift. The planner moved all three positions, so the
// 6 crew would have come an hour early; staff moved the chief and the forklift alone. The shape here is
// that case's, on a fake OnSinch; no email text.
// npx tsx test/planNamedRoleRetime.ts
// ============================================================================
import { plan, type World, type Message } from "../app/lib/v2/interpret/plan";
import type { Interpretation, Request } from "../app/lib/v2/interpret/interpret";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const slot = (id: number, prof: number, role: number, size: number) =>
  ({ id, beginning: "2026-10-18T08:00:00+01:00", end: "2026-10-18T13:00:00+01:00", size, profession_id: prof, role, SlotLocation: { place_id: 29 } });
const R10522 = { id: 13597, number: "10522", company_id: 210, intern_name: "", Job: [{ SlotTeam: [{ id: 35069, name: "Build", Slot: [slot(51207, 36, 1, 1), slot(51208, 1, 0, 6), slot(51215, 22, 0, 1)] }] }] };
const world: World = {
  companies: async () => [{ id: 210, name: "Client", Client: [{ id: 1, email: "ops@client.example" }] }],
  placesNamed: async () => [],
  companyOrders: async (c) => (c === 210 ? [R10522] : []),
  orderByNumber: async (n) => (n === "10522" ? R10522 : null),
};
const msg: Message = { message_id: "m1", from: "ops@client.example", subject: "R10522", sentIso: "2026-10-13T12:48:00Z", text: "(the email)" };
const r = (x: Partial<Request>): Request => ({ action: "change_times", problems: [], date: "2026-10-18", start: "07:00", end: "12:00", target: { date: "2026-10-18" }, ...x } as Request);
const I = (requests: Request[]): Interpretation => ({ intent: "change", requests, problems: [] });
const slotsOf = (d: any): number[] => d.kind === "write" ? d.ops.map((o: any) => o.op.slot_id).sort() : [];

(async () => {
  console.log("\nthe forklift driver and the chief, 07:00-12:00");
  const both = await plan(msg, I([r({ trade: "forklift driver", crew_chief: true })]), world, 13597);
  ok(both.kind === "write" && JSON.stringify(slotsOf(both)) === JSON.stringify([51207, 51215]), "moves the chief and the forklift, not the 6 crew", both);

  console.log("\nthe forklift driver alone");
  const fork = await plan(msg, I([r({ trade: "forklift driver" })]), world, 13597);
  ok(fork.kind === "write" && JSON.stringify(slotsOf(fork)) === JSON.stringify([51215]), "moves the forklift only", fork);

  console.log("\nthe crew chief alone");
  const chief = await plan(msg, I([r({ crew_chief: true })]), world, 13597);
  ok(chief.kind === "write" && JSON.stringify(slotsOf(chief)) === JSON.stringify([51207]), "moves the chief only", chief);

  console.log("\na trade OnSinch books as plain crew");
  const rig = await plan(msg, I([r({ trade: "riggers" })]), world, 13597);
  ok(rig.kind === "handoff" && rig.reasons.some((x) => /which positions are theirs/.test(x)), "hands off: the shift cannot say which crew are the riggers", rig);

  console.log("\na trade the shift does not hold");
  const tele = await plan(msg, I([r({ trade: "telehandler" })]), world, 13597);
  ok(tele.kind === "handoff" && tele.reasons.some((x) => /no Telehandler position/.test(x)), "hands off: no telehandler position to re-time", tele);

  console.log("\nno role or trade named");
  const all = await plan(msg, I([r({})]), world, 13597);
  ok(all.kind === "write" && JSON.stringify(slotsOf(all)) === JSON.stringify([51207, 51208, 51215]), "the whole shift moves, as before", all);

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})();
