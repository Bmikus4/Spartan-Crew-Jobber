// An order the planner finds is the thread's order: decideMessage links it, as it links an
// order the bot writes. Until 10-15 "already booked: R11599" was decided and not kept, so the
// TV card showed no R number. Offline: a recorded reading and a fake OnSinch.
//
// npx tsx test/decideLinks.ts
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import type { World } from "../app/lib/v2/interpret/plan";
import type { Extraction } from "../app/lib/v2/interpret/extract";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const slot = { id: 12, beginning: "2026-11-20T09:00:00+00:00", end: "2026-11-20T17:00:00+00:00", size: 4, profession_id: 1, role: 0, SlotLocation: { place_id: 29 } };
const staffOrder = { id: 16655, number: "11599", company_id: 137, creator: 110, created: "2026-10-15T10:00:00Z", Job: [{ SlotTeam: [{ id: 1, name: "Crew", Slot: [slot] }] }] };
const world: World = {
  companies: async () => [{ id: 137, name: "Event Concept", Client: [{ id: 1, email: "crew@eventconcept.com" }] }],
  placesNamed: async (n) => (/business design centre/i.test(n) ? [{ id: 29, name: "Business Design Centre" }] : []),
  companyOrders: async () => [staffOrder],
  orderByNumber: async () => null,
};
const text = "Please book 4 crew on 20/11 09:00-17:00 at Business Design Centre";
const g = <T,>(value: T, quote: string) => ({ value, quote });
const x: Extraction = {
  intent: "booking", po: null as any, note: "",
  requests: [{ action: "new_shift", date: g("2026-11-20", "20/11"), start: g("09:00", "09:00"), end: g("17:00", "17:00"), duration_minutes: null as any, crew: g(4, "4 crew"), crew_add: null as any, venue: g("Business Design Centre", "Business Design Centre"), crew_chief: null as any, trade: null as any, target: null }],
};
const linked: number[] = [];
const deps: DecideDeps = {
  extract: (async () => ({ x, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
  world, threadOrderId: async () => null, run: null,
  link: async (id) => { linked.push(id); },
  record: async () => {}, trace: () => {},
};
(async () => {
const r = await decideMessage({ message_id: "m1", thread_id: "t1", from_address: "crew@eventconcept.com", date_iso: "2026-10-15T09:00:00Z", subject: "Crew", body: text, is_from_spartan: false } as any, deps);
ok(r.decision.kind === "none" && /already booked: R11599/.test((r.decision as any).reason), "staff's order holds the booking: nothing is written", r.decision);
ok(JSON.stringify(linked) === "[16655]", "and the thread is linked to staff's order", linked);
const broken = await decideMessage({ message_id: "m2", thread_id: "t2", from_address: "crew@eventconcept.com", date_iso: "2026-10-15T09:00:00Z", subject: "Crew", body: text, is_from_spartan: false } as any,
  { ...deps, world: { ...world, companyOrders: async () => { throw new Error("OnSinch 500"); } } });
ok(broken.decision.kind === "handoff" && /could not plan this email \(OnSinch 500\)/.test((broken.decision as any).reasons[0]), "a plan that throws is a card for a person, never a lost email", broken.decision);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
})();
