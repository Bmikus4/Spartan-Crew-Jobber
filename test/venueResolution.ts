// ============================================================================
// The four branches resolvePlace has, and the one that had no test at all.
//
// A venue miss USED TO PROVISION A ROW. That is how the tenant came to hold 632
// ExCeLs, and since 2026-08-31 it does not happen at all — a miss books the
// "No Location" placeholder and tells a person. See test/venueNeverProvisions.ts
// for the measurement that settled it.
//
//   1. matchPlace answers            -> book it
//   2. it answers with a SHELL       -> hold it back, let the second pass look
//   3. it answers with a CITY        -> refuse; a city cannot identify a building
//   4. no venue was named at all     -> the "No Location" placeholder, reused
//   5. a miss                        -> the same placeholder, never a new row
//
// (4) is why this file exists. The city-only guard added for (3) read "No
// Location" as a city name — it has no identifying words, by construction — so it
// refused the placeholder it had just found and provisioned a SECOND one carrying
// "No Location" as its address, which is exactly the string that must never reach
// a job sheet as somewhere to drive to. Sixty-eight test files passed either way,
// because not one of them called this function.
//
// Run: npx tsx test/venueResolution.ts
// ============================================================================
import { resolvePlace } from "../app/lib/engine/compiler";
import type { ConversationFacts, PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PLACES: PlaceCandidate[] = [
  { id: 49, name: "ExCel London", alias: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 57, name: "Olympia London", alias: "Olympia", address: "Hammersmith Road", city: "London", zip: "W14 8UX", active: true },
  { id: 791, name: "National Exhibition Centre", alias: "NEC", address: "Pendigo Way", city: "Birmingham", zip: "B40 1NT", active: true },
  // The placeholder, created once and reused. NO address, deliberately.
  { id: 900, name: "No Location", alias: undefined, address: undefined, city: undefined, zip: undefined, active: true },
  // A shell the engine made out of a client's own words on some earlier enquiry.
  { id: 6894, name: "ExCeL Docklands", alias: undefined, address: "ExCeL Docklands", city: undefined, zip: undefined, active: true },
  // A row whose entire name is a city. Booking crew to it means nothing.
  { id: 2069, name: "London", alias: undefined, address: undefined, city: undefined, zip: undefined, active: true },
];

const onsinch = { allPlaces: async () => PLACES } as never;
const go = (location_text?: string) =>
  resolvePlace({ requests: [], ...(location_text ? { location_text } : {}) } as ConversationFacts, undefined, onsinch);

async function main() {
  console.log("\n[1] matchPlace answers — book it, say nothing");
  {
    const r = await go("ExCeL London");
    ok(r.id === 49, "ExCeL London -> 49", String(r.id));
    ok(!r.provision, "nothing provisioned");
  }

  console.log("\n[2] a SHELL is held back so the second pass can find the real row");
  {
    const r = await go("ExCeL Docklands");
    ok(r.id === 49, "matchPlace matches shell 6894 exactly; 49 is the building", String(r.id));
    ok(!r.provision, "and no duplicate is created");
    ok(!!r.note && /token agreement/.test(r.note), "the ticket says how it was matched", r.note ?? "(none)");
  }

  console.log("\n[3] a CITY cannot identify a building");
  {
    // A city is refused exactly as before. What CHANGED on 2026-08-31 is what happens
    // next: refusing the city row was always right, creating a second row was the half
    // that made duplicates. See test/venueNeverProvisions.ts.
    const r = await go("London");
    ok(r.id === 900, "it books the placeholder, not the city row", String(r.id));
    ok(!r.provision, "and creates nothing");
    ok(!!r.note && /names only a city/.test(r.note), "and the ticket says why", r.note ?? "(none)");
    const b = await go("Birmingham");
    ok(b.id === 900, "Birmingham does not book the NEC either", String(b.id));
  }

  console.log("\n[4] NO VENUE NAMED — the placeholder, found and REUSED");
  {
    const r = await go(undefined);
    ok(r.id === 900, "the existing 'No Location' row is used", String(r.id));
    ok(!r.provision, "a SECOND placeholder is not created");
    ok(!!r.note && /No Location/.test(r.note) && /set the real venue/.test(r.note),
       "and the ticket says a real venue is still needed", r.note ?? "(none)");
  }

  console.log("\n[5] and when the placeholder does not exist yet, it is created WITHOUT an address");
  {
    const bare = { allPlaces: async () => PLACES.filter((p) => p.id !== 900) } as never;
    const r = await resolvePlace({ requests: [] } as ConversationFacts, undefined, bare);
    ok(r.provision?.name === "No Location", "created by name", JSON.stringify(r.provision));
    // "No Location" as an address would print on a job sheet as somewhere to drive to.
    ok(!(r.provision as { address?: string })?.address, "and with NO address");
  }

  console.log("\n[6] a venue the tenant genuinely does not hold is NOT created any more");
  {
    // This asserted the opposite until 2026-08-31. Ben: "no unresolved venues should
    // create venues." Measured across every job the engine had processed, 18 of the 19
    // venues it created were duplicates of rows already in the tenant and 1 was genuinely
    // new — so the genuinely-new case is not worth the eighteen that arrive with it. The
    // job still books, at the placeholder, flagged for a person to set the real venue.
    const r = await go("Thornbury Assembly Rooms, 14 Kestrel Way, Thornbury BS35 2QQ");
    ok(r.id === 900 && !r.provision, "it books the placeholder instead", String(r.id));
    ok(!!r.note && /Thornbury/.test(r.note), "and the ticket names the venue to set", r.note ?? "(none)");
  }

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
}

main();

