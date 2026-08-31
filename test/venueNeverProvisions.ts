// ============================================================================
// AN UNRESOLVED VENUE NEVER CREATES A VENUE.
// ----------------------------------------------------------------------------
// Ben, 2026-08-31: "no unresolved venues should create venues."
//
// This reverses the venue half of his 2026-08-09 rule ("if company or venue
// location are not found in the system, always create new ones if they can be
// inferred"), and it was reversed by measurement rather than by taste. Every job
// thread the engine had processed was replayed through the live search index:
//
//   126 job threads, 108 named a venue, 105 resolved, 19 provisioned a new row
//
//   of those 19 -- 7 had a STRONG existing match (>=0.8) and got a duplicate anyway
//                  1 mid, 8 weak, and the weak band was three ExCeL halls and an Ivy
//                  2 were not venues at all ("Various")
//                  1 was genuinely new
//
// Eighteen of nineteen creations were duplicates of something already in the
// tenant. "Ashmolean Museum, Oxford" scored 0.93 against the Ashmolean and we made
// a second one. That is the mechanism which produced the 632 ExCeLs, still running.
//
// SO AN UNRESOLVED VENUE GOES TO "No Location" AND THE THREAD IS FLAGGED. The job
// still books -- a place_id is mandatory on a job, and an order at "No Location"
// that a human fixes beats an enquiry nobody sees. It costs no extra human touches:
// provisioning already set the review flag, so all 19 were already going to a
// person. What changes is what they find when they get there -- a venue to pick,
// instead of a duplicate to notice.
//
// THE PLACEHOLDER IS THE ONE VENUE THIS ENGINE MAY STILL CREATE, once, on the first
// enquiry that needs it, and matched by name every time after.
//
// Run: npx tsx test/venueNeverProvisions.ts
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

const onsinch = { allPlaces: async () => PLACES } as never;
const go = (location_text?: string, places = PLACES) =>
  resolvePlace(
    { requests: [], ...(location_text ? { location_text } : {}) } as ConversationFacts,
    undefined,
    { allPlaces: async () => places } as never,
  );

/** The shape that must never come back for a venue a client named. */
const provisionedFromClientText = (r: any, text: string) =>
  !!r?.provision && String(r.provision.name).toLowerCase().includes(text.toLowerCase().slice(0, 8));

async function main() {
  console.log("\n[1] a venue the tenant does not hold is NOT created");
  {
    // The genuinely-new case. Under the old rule this minted a row; under Ben's it books
    // the placeholder and tells a person, because one real new venue is not worth the
    // eighteen duplicates that arrive with it.
    const r: any = await go("The Glass House");
    ok(!r.provision, "no provision is returned", JSON.stringify(r.provision ?? null));
    ok(r.id === PLACEHOLDER_ID, "it resolves to the No Location placeholder", String(r.id));
    ok(/glass house/i.test(String(r.note ?? "")), "and the note names the venue a human has to set", String(r.note));
  }

  console.log("\n[2] a venue named only by its city is NOT created");
  {
    // Previously: "creating a new venue rather than booking crew to whichever row in
    // that city happens to be richest". Refusing the city row was right; creating a
    // second one was the half that made duplicates.
    const r: any = await go("London");
    ok(!provisionedFromClientText(r, "London"), "no row is created from the city name");
    ok(r.id === PLACEHOLDER_ID, "it books the placeholder instead", String(r.id));
  }

  console.log("\n[3] text that is not a venue at all is NOT created");
  {
    // Two of the nineteen were literally "Various". A row called "Various" is not a
    // place anyone can drive to.
    const r: any = await go("Various");
    ok(!provisionedFromClientText(r, "Various"), "nothing called \"Various\" is created");
    ok(r.id === PLACEHOLDER_ID, "the placeholder takes it", String(r.id));
  }

  console.log("\n[4] a venue that DOES resolve is unaffected");
  {
    const r: any = await go("ExCeL London");
    ok(r.id === 49, "the real building still wins", String(r.id));
    ok(!r.provision, "and nothing is created");
  }

  console.log("\n[5] the placeholder itself may still be created, once");
  {
    // The one exception, and the reason it is safe: it is created on the first enquiry
    // that needs it and matched by name every time after, so it never multiplies. A job
    // needs a place_id; without this there is no order at all.
    const withoutIt = PLACES.filter((p) => p.id !== PLACEHOLDER_ID);
    const r: any = await go("Somewhere Nobody Holds", withoutIt);
    ok(!!r.provision, "with no placeholder in the tenant, one is provisioned");
    ok(
      String(r.provision?.name).toLowerCase() === "no location",
      "and it is called No Location, never the client's words",
      String(r.provision?.name),
    );
    ok(!r.provision?.address, "with no address — it is not a place, it is the absence of one");
  }

  console.log(`\n${fails ? `${fails} FAILED` : "venueNeverProvisions: ALL PASS"}\n`);
  process.exit(fails ? 1 : 0);
}

main();
