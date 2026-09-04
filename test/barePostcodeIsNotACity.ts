// ============================================================================
// A BARE POSTCODE IS THE STRONGEST KEY THERE IS, AND IT WAS BEING READ AS A CITY.
// ----------------------------------------------------------------------------
// `matchedOnCityAlone` is the guard that stops a bare "Birmingham" being adjudicated
// between six real Birmingham venues, one of which would win. It asks two questions and
// it asked them in the wrong order:
//
//     if (!q.strong.length) return true;      // nothing identifying was written
//     if (q.postcodes.length) return false;   // a postcode is never a city name
//
// A postcode is not a word, so it produces NO strong tokens. "GU8 4AR" therefore
// returned true on the first line and never reached the second — the line written
// specifically to exempt it.
//
// The cost is not a near miss. Searching "GU8 4AR" against all 3,045 buildings returns
// exactly one hit, #1760 Munstead Wood, on `postcode_exact` — full agreement on the one
// key a client copies rather than remembers. The guard discarded it and sent the job to
// the "No Location" placeholder, and under the create-on-unresolved policy it would have
// created a second Munstead Wood beside the one the tenant already holds.
//
// Measured on the 106 labelled wordings in study/venuecompare.ts: 92.5% -> 93.4%, and
// the duplicate rate 2.8% -> 1.9%. It is the whole of that gain.
//
// THE GUARD ITSELF IS NOT THE PROBLEM AND MUST NOT BE WEAKENED. "London" alone still
// identifies nothing and must still be refused. Only the ordering changes.
//
// Run: npx tsx test/barePostcodeIsNotACity.ts
// ============================================================================
import { matchedOnCityAlone } from "../app/lib/engine/venueMatch";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const MUNSTEAD = { id: 1760, name: "Munstead Wood", address: "Heath Lane", city: "Godalming", zip: "GU8 4AR" } as PlaceCandidate;
const NHM = { id: 36, name: "Natural History Museum (NHM)", address: "Cromwell Road", city: "London", zip: "SW7 5BD" } as PlaceCandidate;

console.log("\n[1] a wording that is nothing but a postcode is not a city");
ok(!matchedOnCityAlone("GU8 4AR", MUNSTEAD), "the exact case that lost Munstead Wood");
ok(!matchedOnCityAlone("SW7 5BD", NHM), "and any other bare postcode");
ok(!matchedOnCityAlone("  gu8 4ar  ", MUNSTEAD), "however it is spaced and cased");

console.log("\n[2] a postcode carried ALONGSIDE words was already exempt — still is");
ok(!matchedOnCityAlone("Kempton park racecourse TW16 5AQ", MUNSTEAD), "words plus a postcode");

console.log("\n[3] THE GUARD STILL GUARDS — this is what it exists for");
ok(matchedOnCityAlone("London", NHM), '"London" alone identifies no building');
ok(matchedOnCityAlone("Birmingham", NHM), '"Birmingham" alone identifies no building');
ok(matchedOnCityAlone("", NHM), "an empty wording");
ok(matchedOnCityAlone("   ", NHM), "a blank wording");
ok(matchedOnCityAlone(undefined, NHM), "no wording at all");

console.log("\n[4] a real name still resolves normally, and a wrong one still does not");
ok(!matchedOnCityAlone("Munstead Wood", MUNSTEAD), "the building's own name");
ok(matchedOnCityAlone("Tate Modern", MUNSTEAD), "a name that is nowhere in this row");

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
