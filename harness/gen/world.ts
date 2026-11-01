// ============================================================================
// The generated world behind the fake OnSinch (harness/sim/onsinch.ts): clients with named contacts, venues,
// OnSinch's professions, and orders in the nested shape the API reads (Order > Job > SlotTeam > Slot >
// SlotLocation) with the create rows OnSinch writes for them. Every case has its own client, so no case can
// clear or claim another's order. The names are made up; no real client, venue or person appears.
// ============================================================================
import { shiftWindow } from "../../app/lib/v2/bot/ops";
import { positionsFor } from "../../app/lib/v2/interpret/plan";
import { PROFESSION_NAME } from "../../app/lib/v2/interpret/professions";
import { pick, type Call, type Place, type Rng } from "./grammar";

const FIRST = ["Sam", "Priya", "Tom", "Ella", "Jo", "Marcus", "Dan", "Amy", "Chris", "Hannah", "Lucy", "Ben", "Nina", "Rob", "Kate", "Ian", "Zoe", "Will", "Ollie", "Fay", "Rachel", "Mike", "Aisha", "Callum", "Freya", "Kwame", "Lena", "Mateo", "Niamh", "Raj"];
const LAST = ["Carter", "Shah", "Hughes", "Reid", "Patel", "Lee", "Price", "Ford", "Wood", "Bell", "Grant", "Ashby", "Okafor", "Dale", "Moss", "Short", "Hart", "Banks", "King", "Mills", "Cole", "Stone", "Begum", "Fraser", "Lindqvist", "Mensah", "Novak", "Ortiz", "Quinn", "Varma"];
const BRAND = ["Northlight", "Kestrel", "Brightwater", "Halcyon", "Meridian", "Copperfield", "Tidewater", "Orchard", "Lumen", "Vantage", "Saltmarsh", "Ironbridge", "Bluebell", "Granite", "Foxglove", "Harbour", "Larkspur", "Quarry", "Redwood", "Silverline", "Thistle", "Umbra", "Wren", "Yarrow", "Zephyr"];
const KIND = ["AV", "Events", "Productions", "Staging", "Live", "Exhibitions", "Media", "Hire", "Theatre Company", "Scenic", "Experiential", "Rigging"];
const SUFFIX = ["Ltd", "", "Group", "UK"];

/** Venues: made-up names in the shapes real ones take (a hall, an address, a district). */
export const PLACES: Place[] = [
  "Olympus Hall", "Riverside Exhibition Centre", "The Old Mint", "Canal Basin Studios", "Harrow Road Depot", "Kingsgate Arena", "The Glasshouse",
  "St Brides Crypt", "Wharf 7", "Northfield Conference Centre", "The Ropeworks", "Bishopsgate Pavilion", "Tannery Yard", "Victoria Warehouse",
  "The Boiler House", "Lantern Theatre", "Greenwich Drill Hall", "Unit 12 Park Royal", "Marlowe Rooms", "The Foundry", "Southbank Undercroft",
  "Clerkenwell Assembly", "Albion Ballroom", "Hackney Gasworks", "Pier 3 Terminal",
].map((name, k) => ({ id: 7100 + k, name, address: `${10 + k} ${["High Street", "Wharf Road", "Market Lane", "Station Approach"][k % 4]}, London` }));

export const PROFESSIONS = Object.entries(PROFESSION_NAME).map(([id, name]) => ({ id: Number(id), name, deleted: false }));

export type Client = { id: number; name: string; domain: string; contacts: Array<{ id: number; name: string; surname: string; email: string }> };

export function makeClient(r: Rng, n: number): Client {
  const brand = pick(r, BRAND), kind = pick(r, KIND), suffix = pick(r, SUFFIX);
  const name = [brand, kind, suffix].filter(Boolean).join(" ");
  const domain = `${brand.toLowerCase()}${kind.toLowerCase().replace(/[^a-z]/g, "")}${n}.co.uk`;
  const contacts = [0, 1].map((k) => {
    const first = pick(r, FIRST), last = pick(r, LAST);
    return { id: 50000 + n * 10 + k, name: first, surname: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}` };
  });
  return { id: 60000 + n, name, domain, contacts };
}

/** The client as /companies?with=Client lists it. */
export const companyRow = (c: Client) => ({ id: c.id, name: c.name, Client: c.contacts.map((p) => ({ id: p.id, email: p.email, name: p.name, surname: p.surname, status: 1 })) });

/** The positions staff give a call: plain crew by the 3/4 chief rule (plan.positionsFor), a trade as itself. */
export function positionsOf(call: Call): Array<{ size: number; profession_id: number; role: number }> {
  if (call.trade.profession) return [{ size: call.crew, profession_id: Number(call.trade.profession), role: 0 }];
  return (positionsFor(call.crew) ?? []).map((p) => ({ size: p.size, profession_id: Number(p.profession_id), role: p.role === "crew_chief" ? 1 : 0 }));
}

export type Ids = { order: number; number: number; job: number; team: number; slot: number; location: number };
export const ids: Ids = { order: 880000, number: 88000, job: 880000, team: 880000, slot: 8800000, location: 8800000 };

/** An order as OnSinch holds it, made by `creator` at `created`, with one call per Call. */
export function orderOf(client: Client, calls: Call[], opts: { created: string; creator: number; po?: string | null; title?: string; number?: string }): any {
  const id = ++ids.order;
  return {
    id, number: opts.number ?? String(++ids.number), company_id: client.id, creator: opts.creator, created: opts.created, status: 0, quote: false, provisional: false,
    name: opts.title ?? `${client.name} @ ${calls[0]?.place.name ?? "TBC"}`, intern_name: opts.po ?? "",
    Job: [{ id: ++ids.job, name: opts.title ?? client.name, created: opts.created, creator: opts.creator, SlotTeam: calls.map((c) => {
      const w = shiftWindow(c.date, c.start, c.end);
      return { id: ++ids.team, name: c.trade.profession ? c.trade.label : "Crew", created: opts.created, creator: opts.creator, cancelled: false,
        Slot: positionsOf(c).map((p) => ({ id: ++ids.slot, ...p, beginning: w.beginning, end: w.end, cancelled: false, created: opts.created, creator: opts.creator, SlotLocation: { id: ++ids.location, place_id: c.place.id } })) };
    }) }],
  };
}
