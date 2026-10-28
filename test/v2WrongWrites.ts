// ============================================================================
// The dev-2 replay's wrong writes the planner can fix, fixed (ADDENDUM R17).
// ----------------------------------------------------------------------------
// Of 9 wrong writes, 4 faults were the planner's: a chief the client counted on its own was folded into the
// crew; "set builders" were booked as Crew where staff booked Carpenters; a venue written as initials that
// include "London" made a new place where staff used the client's own; and 1-hour calls were booked where
// staff never book under 2 hours. Each has a control that keeps the old answer where it was right.
// Offline: recorded readings and a fake OnSinch with a made-up client.
// npx tsx --require ./test/fixtures/pg.ts test/v2WrongWrites.ts
// ============================================================================
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import type { World } from "../app/lib/v2/interpret/plan";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
const SENT = "2026-10-15T09:00:00Z";
const CLIENT = "ops@northwind.example";

// Northwind (900) has booked the Royal Hall London Theatre (852) before; the Rose Hotel Leeds Tower (901)
// shares its initials and was never booked by this client.
const past = { id: 15000, number: "10000", company_id: 900, status: 1, creator: 110, created: "2026-06-01T10:00:00Z",
  Job: [{ id: 15001, SlotTeam: [{ id: 15002, name: "Crew", Slot: [{ id: 1, beginning: "2026-06-10T08:00:00+00:00", end: "2026-06-10T16:00:00+00:00", size: 4, profession_id: 1, role: 0, SlotLocation: { place_id: 852 } }] }] }] };
const PLACES = [
  { id: 852, name: "Royal Hall London Theatre", address: "1 Example Road" },
  { id: 901, name: "Rose Hotel Leeds Tower", address: "2 Example Road" },
  { id: 77, name: "Hall One", address: "3 Example Road" },
];
const world = (orders: any[] = [past]): World => ({
  companies: async () => [{ id: 900, name: "Northwind Events", Client: [{ id: 1, email: CLIENT }] }],
  placesNamed: async (n) => PLACES.filter((p) => p.name.toLowerCase() === n.trim().toLowerCase()),
  allPlaces: async () => PLACES,
  companyOrders: async () => orders,
  orderByNumber: async () => null,
  orderById: async () => null,
});
const decide = async (text: string, requests: any[], orders?: any[]) => {
  let rec: any = null;
  await decideMessage({ message_id: "m1", thread_id: "t1", from_address: CLIENT, date_iso: SENT, subject: "Crew", body: text, is_from_spartan: false },
    { extract: (async () => ({ x: { intent: "booking", po: null, note: "", requests }, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
      world: world(orders), threadOrderId: async () => null, run: null, record: async (r: any) => { rec = r; }, trace: () => {} } as DecideDeps);
  return rec.decision;
};
const create = (d: any) => (d.kind === "write" ? d.ops.find((o: any) => o.op.kind === "create_order")?.op : null);
const seats = (op: any, i = 0) => (op?.shifts?.[i]?.positions ?? []).map((p: any) => `${p.profession_id}${p.role === "crew_chief" ? "/chief" : ""}x${p.size}`).sort().join(",");
const NEW = (q: Record<string, unknown>) => ({ ...base, action: "new_shift", date: G("2026-11-20", "20/11"), start: G("08:00", "08:00"), end: G("16:00", "16:00"), venue: G("Hall One", "Hall One"), ...q });

(async () => {
  console.log("\n[chief] a chief counted on its own is one more on the call");
  {
    const d = await decide("Hi, on 20/11 from 08:00 to 16:00 at Hall One we need 2x Crew and 1x Crew Chief", [NEW({ crew: G(2, "2x Crew"), crew_chief: G(true, "1x Crew Chief") })]);
    ok(seats(create(d)) === "1x2,36/chiefx1", "2x Crew and 1x Crew Chief: 2 crew and a chief, as staff booked", { seats: seats(create(d)), d });
    const inside = await decide("Hi, on 20/11 from 08:00 to 16:00 at Hall One we need 4 crew including a chief", [NEW({ crew: G(4, "4 crew including a chief"), crew_chief: G(true, "including a chief") })]);
    ok(seats(create(inside)) === "1x3,36/chiefx1", "control: 4 crew including a chief stays 4 people", seats(create(inside)));
    const bracket = await decide("Hi, on 20/11 from 08:00 to 16:00 at Hall One we need 4 crew (1 chief)", [NEW({ crew: G(4, "4 crew"), crew_chief: G(true, "1 chief") })]);
    ok(seats(create(bracket)) === "1x3,36/chiefx1", "control: a chief in brackets after the crew is one of them", seats(create(bracket)));
  }

  console.log("\n[trade] set builders are carpenters");
  {
    const d = await decide("Hi, on 20/11 from 08:00 to 16:00 at Hall One we need 2x Set Builders", [NEW({ crew: G(2, "2x Set Builders"), trade: G("set builder", "2x Set Builders") })]);
    ok(seats(create(d)) === "3x2", "booked as 2 Carpenters", { seats: seats(create(d)), d });
  }

  console.log("\n[venue] initials that spell \"London\" find the client's own place");
  {
    const d = await decide("Hi, on 20/11 from 08:00 to 16:00 at RHLT we need 4 crew", [NEW({ crew: G(4, "4 crew"), venue: G("RHLT", "RHLT") })]);
    ok(create(d)?.shifts?.[0]?.place_id === "852", "the one of the two that this client booked", { place: create(d)?.shifts?.[0]?.place_id, d });
    const stranger = await decide("Hi, on 20/11 from 08:00 to 16:00 at RHLT we need 4 crew", [NEW({ crew: G(4, "4 crew"), venue: G("RHLT", "RHLT") })], []);
    ok(String(create(stranger)?.shifts?.[0]?.place_id ?? "").startsWith("new:"), "control: with no booking to choose by, never a guess between two", create(stranger)?.shifts?.[0]?.place_id);
  }

  console.log("\n[short] a call under 2 hours is a person's");
  {
    const d = await decide("Hi, on 20/11 we need 2 crew 07:30-08:30 at Hall One", [NEW({ start: G("07:30", "07:30"), end: G("08:30", "08:30"), crew: G(2, "2 crew") })]);
    ok(d.kind === "handoff" && d.code === "policy_short_call", "a 1-hour call is handed to a person, with its code", d);
    const two = await decide("Hi, on 20/11 we need 2 crew 07:30-09:30 at Hall One", [NEW({ start: G("07:30", "07:30"), end: G("09:30", "09:30"), crew: G(2, "2 crew") })]);
    ok(two.kind === "write", "control: a 2-hour call is booked", two);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
