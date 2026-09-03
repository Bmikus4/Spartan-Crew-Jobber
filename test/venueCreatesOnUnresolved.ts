// ============================================================================
// AN UNRESOLVED VENUE IS CREATED FROM THE CLIENT'S OWN WORDS.
// ----------------------------------------------------------------------------
// Ben, 2026-09-03: "Venues that cannot be resolved this way, should be created.
// When there is no venue at all, it is still a successful job. A successful job
// only means that the system used all of the data it had."
//
// THIS FILE ASSERTED THE EXACT OPPOSITE FOR THREE DAYS, and it was not wrong
// then. It was named venueNeverProvisions.ts and it recorded Ben's 2026-08-31
// ruling, which came out of a replay of every job thread the engine had
// processed:
//
//   126 job threads, 108 named a venue, 105 resolved, 19 provisioned a new row
//   of those 19 -- 7 had a STRONG existing match (>=0.8) and got a duplicate anyway
//                  1 mid, 8 weak, and the weak band was three ExCeL halls and an Ivy
//                  2 were not venues at all ("Various")
//                  1 was genuinely new
//
// Eighteen of nineteen creations duplicated something the tenant already had.
// That is the mechanism which produced 632 ExCeL rows.
//
// WHAT CHANGED IS NOT THE MEASUREMENT, IT IS WHICH FAILURE IS CHEAPER. Parking a
// miss on "No Location" throws the client's address away: the booker opens the
// job and has nothing to work from but a note. Creating a row keeps it, on the
// job, in the field a job sheet prints. A duplicate is a row a person merges; a
// discarded address is a phone call.
//
// THE DUPLICATE RATE IS BOUNDED, and by a mechanism already in the code rather
// than by hope. A created row is named after the client's words, so the NEXT
// enquiry that writes those words matches it exactly (see the shell rules in
// resolvePlace). Drift is therefore proportional to distinct unresolved
// WORDINGS, not to booking volume -- 131 distinct wordings across the whole
// mailbox, against ~3,000 jobs. Holding it near Ben's 1% target is F8 (learned
// aliases) and F11 (dedupe the table, then keep it synced), not this branch.
//
// THE PLACEHOLDER STILL EXISTS and is still the answer for exactly one case: a
// thread that never named a venue at all. There is nothing to create from
// silence, and a job needs a place_id.
//
// Run: npx tsx test/venueCreatesOnUnresolved.ts
// ============================================================================
import { resolvePlace } from "../app/lib/engine/compiler";
import type { ConversationFacts, PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PLACEHOLDER_ID = 900;

const PLACES: PlaceCandidate[] = [
  { id: 49, name: "ExCel London", alias: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 900, name: "No Location", alias: undefined, address: undefined, city: undefined, zip: undefined, active: true },
  // A row whose entire name is a city. Booking crew to it means nothing, so it is refused.
  { id: 2069, name: "London", alias: undefined, address: undefined, city: undefined, zip: undefined, active: true },
];

const go = (location_text?: string, places = PLACES) =>
  resolvePlace(
    { requests: [], ...(location_text ? { location_text } : {}) } as ConversationFacts,
    undefined,
    { allPlaces: async () => places } as never,
  );

async function main() {
  console.log("\n[1] a venue the tenant does not hold is CREATED from what the client wrote");
  {
    const r: any = await go("The Glass House");
    ok(!!r.provision, "a venue is provisioned", JSON.stringify(r.provision ?? null));
    ok(r.provision?.name === "The Glass House", "named exactly what the client wrote", String(r.provision?.name));
    ok(r.id === undefined, "and it is not silently booked to the placeholder", String(r.id));
    ok(/CHECK IT/i.test(String(r.note ?? "")), "the ticket tells a person to check and merge it", String(r.note));
  }

  console.log("\n[2] a postcode in the client's words rides along onto the new row");
  {
    // The whole point of creating rather than holding: the address survives to the job
    // sheet. A row with a postcode is one a driver can use before anyone merges it.
    const r: any = await go("Thornbury Assembly Rooms, 14 Kestrel Way, Thornbury BS35 2QQ");
    // Spaced, as the client wrote it and as Royal Mail formats it — not the
    // squashed key the matcher indexes on. This lands in a `zip` field a person reads.
    ok(r.provision?.zip === "BS35 2QQ", "the postcode is carried onto the row", String(r.provision?.zip));
    ok(/Thornbury/.test(String(r.provision?.name)), "and the name is the client's own words", String(r.provision?.name));
  }

  console.log("\n[3] a venue named only by its city is still refused a MATCH");
  {
    // The city guard has not moved, and it is the half of the 08-31 work that was
    // always right: a row whose entire name is "London" identifies no building, so
    // booking crew to it means nothing. What changes is where the refusal LANDS -- a
    // new row carrying the client's text, not a placeholder carrying nothing.
    //
    // Stated plainly because it is the accepted cost of the ruling: "London" and
    // "Various" DO create rows now. Nothing deterministic separates them from "London
    // Stadium", which this same guard also refuses (defect D1) and which is a real
    // building the tenant holds. A guard strong enough to block the junk blocks the
    // building too, and was tried: see study/venuecompare.ts, net -15 on 106 labelled
    // wordings.
    const r: any = await go("London");
    ok(r.id !== 2069, "the city row never wins", String(r.id));
    ok(!!r.provision, "the refusal creates a row instead of discarding the words");
  }

  console.log("\n[4] a venue that DOES resolve is unaffected");
  {
    const r: any = await go("ExCeL London");
    ok(r.id === 49, "the real building still wins", String(r.id));
    ok(!r.provision, "and nothing is created");
  }

  console.log("\n[5] silence is the ONE case that still books the placeholder");
  {
    // No location_text anywhere in the thread. There is nothing to create a venue
    // from, and the job still has to exist -- a place_id is mandatory. This is Ben's
    // "when there is no venue at all, it is still a successful job".
    const r: any = await go(undefined);
    ok(r.id === PLACEHOLDER_ID, "it resolves to the No Location placeholder", String(r.id));
    ok(!r.provision, "and creates nothing");
  }

  console.log("\n[6] the placeholder itself may still be created, once, and never from client text");
  {
    // Created on the first thread that needs it and matched by name every time after,
    // so it never multiplies. "No Location" as an ADDRESS would print on a job sheet
    // as somewhere to drive to, which is why it carries none.
    const withoutIt = PLACES.filter((p) => p.id !== PLACEHOLDER_ID);
    const r: any = await go(undefined, withoutIt);
    ok(!!r.provision, "with no placeholder in the tenant, one is provisioned");
    ok(
      String(r.provision?.name).toLowerCase() === "no location",
      "and it is called No Location, never the client's words",
      String(r.provision?.name),
    );
    ok(!r.provision?.address, "with no address — it is not a place, it is the absence of one");
  }

  console.log(`\n${fails ? `${fails} FAILED` : "venueCreatesOnUnresolved: ALL PASS"}\n`);
  process.exit(fails ? 1 : 0);
}

main();
