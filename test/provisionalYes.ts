// ============================================================================
// A client's yes on an order still provisional or in Price Quotes is staff's to confirm, never "already booked"
// (DECISIONS O31). 10 of 30 such yeses, 9 Oct-2 Nov, were decided none with no need open on their thread.
// Offline: recorded readings and a fake OnSinch.
// npx tsx --require ./test/fixtures/pg.ts test/provisionalYes.ts
// ============================================================================
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import type { World } from "../app/lib/v2/interpret/plan";
import { codeOfReason, isReplyReason } from "../app/lib/v2/reasons";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
const SENT = "2026-10-15T09:00:00Z";
const slot = (id: number, start: string, end: string, size: number) => ({ id, beginning: `2026-11-20T${start}:00+00:00`, end: `2026-11-20T${end}:00+00:00`, size, profession_id: 1, role: 0, SlotLocation: { place_id: 29 } });
const order = (x: Record<string, unknown> = {}) => ({ id: 16100, number: "11100", company_id: 137, creator: 110, created: "2026-10-01T10:00:00Z", ...x, Job: [{ id: 16101, SlotTeam: [{ id: 501, name: "Crew", Slot: [slot(61, "08:00", "16:00", 4)] }] }] });
const world = (orders: any[]): World => ({
  companies: async () => [{ id: 137, name: "Event Concept", Client: [{ id: 1, email: "crew@eventconcept.com" }] }],
  placesNamed: async () => [{ id: 29, name: "Business Design Centre" }],
  allPlaces: async () => [{ id: 29, name: "Business Design Centre" }],
  companyOrders: async () => orders,
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
} as World);
const yes = [{ ...base, action: "new_shift", date: G("2026-11-20", "Friday 20/11"), start: G("08:00", "08:00"), end: G("16:00", "16:00"), crew: G(4, "4 crew") }];
const decide = (orders: any[]) => decideMessage(
  { message_id: "m1", thread_id: "t1", from_address: "crew@eventconcept.com", date_iso: SENT, subject: "Re: Quote R11100", body: "Thanks, please go ahead and book this in for Friday 20/11, 4 crew 08:00-16:00", is_from_spartan: false },
  { extract: (async () => ({ x: { intent: "booking", po: null, note: "", requests: yes }, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
    world: world(orders), threadOrderId: async () => null, run: null, record: async () => {}, trace: () => {} } as DecideDeps);

(async () => {
  console.log("\n[1] a yes on a provisional order is a card to confirm it");
  {
    const d = (await decide([order({ provisional: 1 })])).decision as any;
    ok(d.kind === "handoff" && /R11100 holds what the client asked but is still provisional: confirm it in OnSinch/.test(d.reasons?.[0] ?? "") && d.order_id === 16100, "handed to staff to confirm R11100", d);
    ok(d.code === "policy_provisional" && !isReplyReason(d.reasons[0]), "coded, and a need on the TV, not a reply", d);
    const q = (await decide([order({ quote: true })])).decision as any;
    ok(q.kind === "handoff" && q.code === "policy_provisional", "an order still in Price Quotes: the same", q);
  }
  console.log("\n[2] a yes on a confirmed order is already booked, as before");
  {
    const d = (await decide([order()])).decision as any;
    ok(d.kind === "none" && /already booked: R11100/.test(d.reason), "none: already booked", d);
    ok(codeOfReason("R11100 holds what the client asked but is still provisional: confirm it in OnSinch once the client has said yes") === "policy_provisional", "the wording carries its code");
  }
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
