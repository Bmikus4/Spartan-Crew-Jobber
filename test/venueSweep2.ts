// ============================================================================
// The venue sweep v2 ruling, against fixtures.
//
// The three failures this file exists to stop, in order of what they would cost:
//   1. A group key that CHAINS. August's transitive similarity join put the Royal
//      Albert Hall, the British Museum and 3,406 others in one cluster; run as a
//      deletion it would have destroyed 3,408 real venues.
//   2. A richer row winning an election it contradicts. "Most information" is not
//      "right" — a row disagreeing with its peers is a question, not an answer.
//   3. `allFabricated` firing on a group holding any data at all.
//
// Run: npx tsx test/venueSweep2.ts
// ============================================================================
import {
  lead, norm, isBare, richness, addressShaped, postcodes, venuesFromBody,
  provenanceHits, outliers, elect, plan, upperBound, hyperCdf, fabricationEvidence,
  type N8nVenue,
} from "../scripts/venue-sweep2";

let fails = 0;
const ok = (c: boolean, label: string) => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`);
};

// ---------------------------------------------------------------- primitives
console.log("primitives");
ok(lead("The Grand Hall, 50 Crown Street, London, WC1A 2AB") === "the grand hall", "lead() cuts at the first comma");
ok(lead("ExCeL London") === "excel london", "lead() of a bare name is the whole name");
ok(postcodes("London, WC1A 2AB")[0] === "WC1A2AB", "postcode parsed without the space");
ok(postcodes("nothing here").length === 0, "no postcode, no match");
ok(addressShaped("The Grand Hall, 50 Crown Street, London, WC1A 2AB"), "comma + postcode is address-shaped");
ok(addressShaped("Some Hall, 25 Kingsway, London"), "comma + street number is address-shaped");
ok(!addressShaped("ExCel London"), "a plain venue name is NOT address-shaped");
ok(!addressShaped("Smith, Jones and Partners"), "a comma alone is not an address");

ok(isBare({ name: "X" }), "no fields at all is bare");
ok(isBare({ name: "X", address: "x" }), "an address echoing the name is not data");
ok(!isBare({ name: "X", zip: "E16 1XL" }), "a postcode is data");
ok(richness({ address: "a", city: "b", zip: "c" }) === 3, "richness counts populated fields");

ok(venuesFromBody("Full Venue Address: The Shard, London SE1 9SG\nCrew: 4")[0]
  === "The Shard, London SE1 9SG", "venue line parsed off a body");
ok(venuesFromBody("**Full Venue Address:** ** The Shard, London")[0] === "The Shard, London",
  "leading markdown asterisks stripped");
ok(venuesFromBody("no venue here").length === 0, "a body with no venue line yields none");

// ---------------------------------------------------------------- provenance
console.log("\nprovenance");
const VENUES: N8nVenue[] = [
  { raw: "The Grand Hall, 101 Exhibition Road, Kensington, London, SW7 2AZ", lead: "the grand hall", execs: ["9001"], dates: ["2026-08-28T00:00:00Z"] },
  { raw: "ExCeL London, One Western Gateway, Royal Victoria Dock, London E16 1XL", lead: "excel london", execs: ["9002"], dates: ["2026-08-29T00:00:00Z"] },
  { raw: "Venue: London", lead: "venue", execs: ["9003"], dates: ["2026-08-30T00:00:00Z"] },
];
const PLACES = [
  { id: 49, name: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 2033, name: "The Grand Hall, 50 Crown Street, London, WC1A 2AB", active: true },
  { id: 2034, name: "The Grand Hall, 50 Crown Street, London, WC1A 2AB", active: true },
  { id: 6120, name: "The Grand Hall, 101 Exhibition Road, Kensington, London, SW7 2AZ", active: true },
  { id: 5001, name: "ExCeL London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL", active: true },
  { id: 3, name: "Royal Albert Hall", zip: "SW7 2AP", city: "London", active: true },
  { id: 6922, name: "No Location", active: true },
];
const hits = provenanceHits(PLACES, VENUES);
const kindOf = (id: number) => hits.find((h) => h.placeId === id)?.kind;
ok(kindOf(6120) === "n8n-exact", "a verbatim generator string is n8n-exact");
ok(kindOf(2033) === "n8n-family", "same lead + address-shaped is n8n-family");
ok(kindOf(49) === undefined, "the REAL ExCel London is not address-shaped, so not a hit");
ok(kindOf(5001) === "n8n-family", "the address-as-name ExCeL clone IS a hit");
ok(kindOf(3) === undefined, "an unrelated real venue is untouched");
ok(kindOf(6922) === undefined, "the sentinel is never a provenance hit");

// ---------------------------------------------------------------- outliers
console.log("\noutliers and election");
const G = [
  { id: 10, name: "Kings Hall", zip: "N1 1AA", city: "London" },
  { id: 11, name: "Kings Hall", zip: "N1 1AA" },
  { id: 12, name: "Kings Hall", zip: "N1 1AA" },
  { id: 13, name: "Kings Hall", zip: "ZZ9 9ZZ", city: "Aberdeen", address: "1 Far Road", note: "n", alias: "a" },
];
const out = outliers(G);
ok(out.has(13), "the richest row contradicting a 3-row postcode consensus is an outlier");
ok(!out.has(10), "a row agreeing with the consensus is not an outlier");
ok(elect(G, out) === 10, "the outlier does not win the election despite being richest");
ok(elect(G, new Set<number>()) === 13, "without the outlier rule the richest WOULD have won");

const NO_CONSENSUS = [
  { id: 20, name: "Odd Hall", zip: "A1 1AA" },
  { id: 21, name: "Odd Hall", zip: "B2 2BB" },
];
ok(outliers(NO_CONSENSUS).size === 0, "a consensus of one is not a consensus");

const ALL_BARE = [{ id: 99, name: "Bare Hall" }, { id: 7, name: "Bare Hall" }];
ok(elect(ALL_BARE, new Set()) === 7, "all-bare elects the lowest id, the oldest row");

// ---------------------------------------------------------------- plan
console.log("\nplan");
const decisions = plan({ places: PLACES, hits, referenced: new Set<number>() });
const byKey = (k: string) => decisions.find((d) => d.key === k)!;

const grand = byKey("the grand hall");
ok(!!grand, "the three Grand Hall rows form one group");
ok(grand.survivor === null, "an all-bare all-fabricated group elects nobody");
ok(grand.stratum === "proven", "...and is stratum 'proven'");
ok(grand.members.every((m) => m.action === "delete"), "...and every member is deleted");
ok(grand.members.length === 3, "...covering all three rows");

const excel = byKey("excel london");
ok(excel.survivor === 49, "the real ExCel London survives its address-as-name clone");
ok(excel.stratum !== "proven", "a group holding a real row is never 'all fabricated'");
ok(excel.members.find((m) => m.id === 5001)!.action === "delete", "the clone is deleted");

ok(!decisions.some((d) => d.members.some((m) => m.id === 6922)), "the sentinel appears in NO decision");
ok(!decisions.some((d) => d.key === "royal albert hall"), "a lone unduplicated real venue is not a decision");

// the key cannot chain
const CHAIN = [
  { id: 1, name: "Royal Albert Hall", zip: "SW7 2AP" },
  { id: 2, name: "Royal Albert Hall, Kensington Gore", zip: "SW7 2AP" },
  { id: 3, name: "British Museum", zip: "WC1B 3DG" },
];
const chained = plan({ places: CHAIN, hits: [], referenced: new Set() });
ok(!chained.some((d) => d.members.some((m) => m.id === 3) && d.members.some((m) => m.id === 1)),
  "the British Museum NEVER joins a Royal Albert Hall group");
ok(chained.every((d) => d.members.length <= 1 || new Set(d.members.map((m) => lead(
  CHAIN.find((c) => c.id === m.id)!.name))).size === 1),
  "every group shares one exact lead — equality, not similarity");

// the keep-guard
const REF = plan({
  places: [{ id: 40, name: "Hall X" }, { id: 41, name: "Hall X" }],
  hits: [], referenced: new Set([41]),
});
ok(REF[0].members.find((m) => m.id === 41)!.action === "deactivate",
  "a referenced loser is deactivated, never deleted");
ok(REF[0].members.find((m) => m.id === 40)!.action === "keep", "the unreferenced oldest survives");

// homogeneity
ok(grand.homogeneous === false, "Grand Hall losers differ in name, so not homogeneous");
const HOMO = plan({
  places: [{ id: 50, name: "Twin Hall" }, { id: 51, name: "Twin Hall" }, { id: 52, name: "Twin Hall" }],
  hits: [], referenced: new Set(),
});
ok(HOMO[0].homogeneous === true, "identical losers are homogeneous — one audit discharges them");

// ------------------------------------------------- structural fabrication
console.log("\nfabricated addresses (the n8n log is only nine days deep)");
ok(fabricationEvidence("Grand Exhibition Hall, 45 Innovation Avenue, Tech City, TX12 4RT")
  ?.includes("TX12"), "TX12 is not a real postcode area");
ok(fabricationEvidence("The Grand Plaza, 123 Business Road, London, EC1A 1BB")
  ?.includes("documentation"), "EC1A 1BB is a documentation postcode");
ok(fabricationEvidence("Westbridge Manor Hall, 32 High Street, Westbridge, AB12 3CD")
  ?.includes("documentation"), "AB12 3CD is a documentation postcode");
ok(fabricationEvidence("Riverside Conference Hall, 123 River Street, London, LN5 3RT") !== null,
  "the 150-row Riverside family is convicted (by the river-street rule, before 123 is reached)");
ok(fabricationEvidence("The Grand Pavilion, 123 City Road, Manchester, M1 2AB")
  ?.includes("123"), "house number 123 convicts where no other rule fires — real area, real street");
ok(fabricationEvidence("Grand City Hall, 123 Innovation Road")?.includes("123"),
  "...with no postcode present at all");
ok(fabricationEvidence("LinkedIn") === null,
  "LinkedIn is NOT convicted — its real 123 Farringdon Road lives in the address column, not the name");
ok(fabricationEvidence("Studio 123 Gallery") === null,
  "a 123 that is not a house number does not convict");
ok(fabricationEvidence("Royal Albert Hall") === null, "a real venue name is not convicted");
ok(fabricationEvidence("Tobacco Dock Ltd, 50 Porters Walk, London, E1W 2SF") === null,
  "a real address with a real area is not convicted");
ok(fabricationEvidence("ExCeL London, One Western Gateway, London E16 1XL") === null,
  "E16 is a real area — the generator's REAL venues are not convicted by this test");

const FAB = [
  { id: 300, name: "The Grand Plaza, 123 Business Road, London, EC1A 1BB", active: true },
  { id: 301, name: "The Grand Plaza, 123 Business Road, London, EC1A 1BB", active: true },
];
const fabHits = provenanceHits(FAB, []);
ok(fabHits.length === 2 && fabHits[0].kind === "fabricated-address",
  "structural fabrication is a provenance source with no n8n evidence at all");
const fabPlan = plan({ places: FAB, hits: fabHits, referenced: new Set() });
ok(fabPlan[0].survivor === null && fabPlan[0].members.every((m) => m.action === "delete"),
  "a wholly fabricated family elects nobody — no surviving fake venue");

// one convicted member condemns an all-bare family
const MIXED = [
  { id: 2038, name: "Tech Convention Center, 123 Innovation Way, London, WC2N 5DU", active: true },
  { id: 5988, name: "Tech Convention Center, London", active: true },
  { id: 5989, name: "Tech Convention Center, London", active: true },
];
const mixedPlan = plan({ places: MIXED, hits: provenanceHits(MIXED, []), referenced: new Set() });
ok(mixedPlan[0].survivor === null,
  "one convicted row condemns the whole all-bare family — a barer sibling is the same fiction");
ok(mixedPlan[0].members.every((m) => m.action === "delete"),
  "...so the convicted row cannot be elected as the survivor");

const MIXED_REAL = [
  { id: 300, name: "Tech Convention Center, 123 Innovation Way, London, WC2N 5DU", active: true },
  { id: 301, name: "Tech Convention Center", zip: "WC2N 5DU", city: "London", active: true },
];
const mixedReal = plan({ places: MIXED_REAL, hits: provenanceHits(MIXED_REAL, []), referenced: new Set() });
ok(mixedReal[0].survivor === 301,
  "one member carrying real data takes the group OUT of the fabricated branch");
ok(mixedReal[0].members.find((m) => m.id === 300)!.action === "delete",
  "...and the fabricated row is the one that goes");

// generic and bare
console.log("\ngeneric placeholder words");
const GEN = plan({
  places: [{ id: 1809, name: "Placeholder" }, { id: 1810, name: "Placeholder" }],
  hits: [], referenced: new Set(),
});
ok(GEN[0].survivor === null, "Placeholder elects nobody — it is not a venue");
ok(GEN[0].members.every((m) => m.action === "delete"), "...every Placeholder row goes");
const GEN_DATA = plan({
  places: [{ id: 60, name: "Private Residence", zip: "N10 1NT" },
           { id: 61, name: "Private Residence", zip: "N10 1NT" }],
  hits: [], referenced: new Set(),
});
ok(GEN_DATA[0].survivor === 60,
  "generic WITH data still elects — nine 'Private Residence' rows are nine real homes");
const GEN_REF = plan({
  places: [{ id: 1809, name: "Placeholder" }, { id: 1810, name: "Placeholder" }],
  hits: [], referenced: new Set([1810]),
});
ok(GEN_REF[0].members.find((m) => m.id === 1810)!.action === "deactivate",
  "a referenced placeholder is deactivated, never deleted");

// evidence is deduplicated
ok(new Set(grand.evidence).size === grand.evidence.length,
  "evidence carries each distinct fact once, not once per member");

// ---------------------------------------------------------------- the bound
console.log("\nconfidence bound");
ok(hyperCdf(100, 0, 10, 0) === 1, "zero defects in the population is certain to show none");
ok(upperBound(1000, 0, 0) === 1000, "auditing nothing bounds nothing");
ok(upperBound(1000, 1000, 0) === 0, "auditing everything with no defects bounds at zero");
const b = upperBound(3000, 1000, 0);
ok(b < 9 && b > 0, `1000 clean audits of 3000 rows bounds defects under 9 (got ${b})`);
ok(upperBound(3000, 1000, 2) > b, "finding defects raises the bound");
ok(upperBound(1000, 100, 0) > upperBound(1000, 500, 0), "more audits, tighter bound");
// the classic rule of three: 3/n for large N
const rot = upperBound(1e5, 1000, 0) / 1e5;
ok(rot > 0.0025 && rot < 0.0035, `large-N bound tracks the rule of three, 3/n (got ${rot.toFixed(5)})`);

console.log(`\n${fails ? `FAIL ${fails}` : "ALL PASS"}`);
process.exit(fails ? 1 : 0);
