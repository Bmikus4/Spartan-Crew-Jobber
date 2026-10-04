// ============================================================================
// SP-35: a retired-only match and a generic wording both hold at the placeholder.
// ----------------------------------------------------------------------------
// Venue Task 6 (09-29 spec Q3'): a wording that matched only retired rows was booked
// onto the retired row. A hard filter was measured worse (it mints a duplicate from the
// client's words), so the resolver holds at "No Location" instead. Q8: a wording that is
// only a generic name ("client site", "TBC") does the same rather than matching or
// creating a generic row. The matchers themselves are unchanged (test/venueActivePreference.ts).
//
// Offline.  npx tsx test/venueRetiredAndGeneric.ts
// ============================================================================
import { resolvePlace } from "../app/lib/engine/compiler";
import type { ConversationFacts, PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PLACES = [
  { id: 900, name: "No Location", active: true },
  { id: 310, name: "The Brewery", address: "52 Chiswell Street", city: "London", zip: "EC1Y 4SD", active: false },
  { id: 311, name: "The Brewery London", address: "52 Chiswell Street", city: "London", zip: "EC1Y 4SD", active: false },
  { id: 49, name: "ExCel London", alias: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
] as unknown as PlaceCandidate[];
const onsinch = { allPlaces: async () => PLACES } as never;
const go = (location_text: string) => resolvePlace({ requests: [], location_text } as ConversationFacts, undefined, onsinch);

async function main() {
  for (const v3 of ["0", "1"]) {
    process.env.SPARTAN_VENUE_V3 = v3;
    console.log(`\n######## SPARTAN_VENUE_V3=${v3}`);

    console.log("[1] only retired rows match: the placeholder, not the retired row, not a duplicate");
    {
      const r = await go("The Brewery, Chiswell Street EC1Y 4SD");
      ok(r.id === 900 && !r.provision, "held at No Location", `${r.id} ${JSON.stringify(r.provision)}`);
      ok(/matched only retired venue rows/.test(r.note ?? ""), "and the note says why", r.note ?? "");
    }

    console.log("[2] a generic wording: the placeholder, nothing created");
    for (const w of ["client site", "TBC", "Various", "on-site"]) {
      const r = await go(w);
      ok(r.id === 900 && !r.provision && /names no building/.test(r.note ?? ""), `"${w}"`, `${r.id} ${r.note ?? ""}`);
    }

    console.log("[3] control: an active building still books");
    {
      const r = await go("ExCeL London E16 1XL");
      ok(r.id === 49, "ExCeL London -> 49", String(r.id));
    }
  }
  delete process.env.SPARTAN_VENUE_V3;
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main();
