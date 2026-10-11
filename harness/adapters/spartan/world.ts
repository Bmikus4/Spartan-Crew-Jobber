// ============================================================================
// A fake OnSinch: the companies, venues and orders one case needs, behind the same World
// interface the planner reads production through. Each case gets its own world, so cases
// cannot leak into each other and every expected answer is exact.
// ============================================================================
import type { World } from "../../../app/lib/v2/interpret/plan";
import { normName } from "../../../app/lib/engine/resolve";
import { shiftWindow } from "../../../app/lib/v2/bot/ops";

export type Company = { id: number; name: string; domain: string; people: string[] };

export const COMPANIES: Company[] = [
  { id: 9001, name: "Northlight AV", domain: "northlightav.co.uk", people: ["Sam Carter", "Priya Shah"] },
  { id: 9002, name: "Kestrel Events", domain: "kestrelevents.co.uk", people: ["Tom Hughes", "Ella Reid"] },
  { id: 9003, name: "Brightwater Productions", domain: "brightwaterproductions.com", people: ["Jo Patel", "Marcus Lee"] },
  { id: 9004, name: "Halcyon Staging", domain: "halcyonstaging.co.uk", people: ["Dan Price", "Amy Ford"] },
  { id: 9005, name: "Meridian Live", domain: "meridianlive.com", people: ["Chris Wood", "Hannah Bell"] },
  { id: 9006, name: "Copperfield Exhibitions", domain: "copperfieldexpo.co.uk", people: ["Lucy Grant", "Ben Ashby"] },
  { id: 9007, name: "Tidewater Media", domain: "tidewatermedia.co.uk", people: ["Nina Okafor", "Rob Dale"] },
  { id: 9008, name: "Orchard Hire", domain: "orchardhire.co.uk", people: ["Kate Moss", "Ian Short"] },
  { id: 9009, name: "Lumen Theatre Company", domain: "lumentheatre.org.uk", people: ["Zoe Hart", "Will Banks"] },
  { id: 9010, name: "Vantage Scenic", domain: "vantagescenic.com", people: ["Ollie King", "Fay Mills"] },
  // Two companies on one domain: no single client can be named from the address.
  { id: 9011, name: "Atlas Group", domain: "atlasgroup.co.uk", people: ["Rachel Cole"] },
  { id: 9012, name: "Atlas Group Events", domain: "atlasgroup.co.uk", people: ["Mike Stone"] },
];
export const CLIENTS = COMPANIES.filter((c) => c.domain !== "atlasgroup.co.uk");

export type Place = { id: number; name: string };
export const PLACES: Place[] = [
  { id: 31, name: "Olympia London" }, { id: 32, name: "ExCeL London" }, { id: 11, name: "Roundhouse" },
  { id: 40, name: "Tobacco Dock" }, { id: 41, name: "Old Billingsgate" }, { id: 42, name: "Alexandra Palace" },
  { id: 43, name: "The Brewery" }, { id: 44, name: "Printworks" },
  // Two OnSinch records with one name: the planner must not pick one.
  { id: 45, name: "Kings Place" }, { id: 46, name: "Kings Place" },
];
export const UNIQUE_PLACES = PLACES.filter((p) => p.name !== "Kings Place");

/** `extra`: a second trade on the shift (a carpenter, say), which a crew-size change must leave alone. */
export type ShiftSpec = { date: string; start: string; end: string; crew: number; place: Place; name?: string; attending?: number; extra?: { profession_id: number; size: number } };
export type OrderSpec = { id: number; number: number; company_id: number; po?: string; shifts: ShiftSpec[] };

/** The crew shape ops build (plan.positionsFor): 4-9 carry one Crew Chief inside the total. */
function slotsFor(order: OrderSpec, s: ShiftSpec, n: number) {
  const w = shiftWindow(s.date, s.start, s.end);
  const base = { beginning: w.beginning, end: w.end, cancelled: false, slotlocation_id: 70000 + s.place.id, SlotLocation: { place_id: s.place.id } };
  const id = (k: number) => order.id * 100 + n * 10 + k;
  const extra = s.extra ? [{ ...base, id: id(3), size: s.extra.size, role: 0, profession_id: s.extra.profession_id }] : [];
  if (s.crew <= 3) return [{ ...base, id: id(1), size: s.crew, role: 0, profession_id: 1 }, ...extra];
  return [{ ...base, id: id(1), size: 1, role: 1, profession_id: 36 }, { ...base, id: id(2), size: s.crew - 1, role: 0, profession_id: 1 }, ...extra];
}

/** An order in the API's nested read shape (Job > SlotTeam > Slot > SlotLocation). */
export function orderRecord(o: OrderSpec) {
  return {
    id: o.id, number: o.number, company_id: o.company_id, intern_name: o.po ?? "",
    Job: [{ id: o.id + 500000, SlotTeam: o.shifts.map((s, n) => ({ id: o.id * 10 + n, name: s.name ?? "Crew", Slot: slotsFor(o, s, n) })) }],
  };
}

export class FakeWorld implements World {
  readonly fake = true;
  readonly orders: any[];
  constructor(specs: OrderSpec[]) { this.orders = specs.map(orderRecord); }
  async companies() {
    return COMPANIES.map((c) => ({ id: c.id, name: c.name, Client: c.people.map((p, i) => ({ id: c.id * 10 + i, email: `${p.split(" ")[0].toLowerCase()}@${c.domain}` })) }));
  }
  async placesNamed(name: string) { return PLACES.filter((p) => normName(p.name) === normName(name)).map((p) => ({ ...p })); }
  async companyOrders(companyId: number) { return this.orders.filter((o) => o.company_id === companyId); }
  async orderByNumber(n: string) { return this.orders.find((o) => String(o.number) === String(n)) ?? null; }
}
