// ============================================================================
// Every venue in the tenant, ranked — and the two ways ranking goes wrong.
//
// Ben, 2026-08-25: venue matching must not come only from the alias store. Pull
// every location and rank them with edit distance and a properly designed matcher.
//
// Two things this file exists to pin, both learned the hard way:
//
//  1. THE "2,000 VENUES" IS NOT THE ROW COUNT. 6,859 rows collapse to ~3,000
//     buildings, and ranking raw rows means ranking 800 ExCeL shells against each
//     other and returning whichever scored highest.
//
//  2. A SHELL MATCHES THE CLIENT'S WORDING EXACTLY, because the client's wording is
//     what created it. Paying an exact-match bonus for that puts every shell above
//     the real record it duplicates — a bare "Excel" row beat ExCeL London 1.26 to
//     0.87 until the bonus was withheld from buildings that cannot locate a job.
//
// Run: npx tsx test/venueSearch.ts
// ============================================================================
import {
  buildIndex, searchVenues, scoreBuilding, levenshtein, similarity, jaroWinkler,
} from "../app/lib/engine/venueSearch";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

type Row = PlaceCandidate & { lat?: number; lng?: number };
const p = (id: number, name: string, alias?: string, address?: string, city?: string, zip?: string, active = true): Row =>
  ({ id, name, alias, address, city, zip, active } as Row);

const PLACES: Row[] = [
  // -- real records
  p(49, "ExCel London", "ExCel London", "1 Western Gateway", "London", "E16 1XL"),
  p(7, "The O2", "O2", "Peninsula Square", "London", "SE10 0DX"),
  p(2, "Royal Albert Hall", "RAH", "Kensington Gore", "London", "SW7 2AP"),
  p(57, "Olympia London", "Olympia", "Hammersmith Road", "London", "W14 8UX"),
  p(791, "National Exhibition Centre", "NEC", "Pendigo Way", "Birmingham", "B40 1NT"),
  p(23, "Victoria and Albert Museum (V&A)", "V&A", "Cromwell Road", "London", "SW7 2RL"),
  p(826, "V&A East Storehouse", undefined, "V&A East Storehouse", undefined, "E20 3BS"),
  // -- different buildings on the same dock. Must never merge with 49.
  p(1241, "Novotel London Excel", undefined, "7 Western Gateway", "London", "E16 1AA"),
  p(6356, "The Fox, Excel", undefined, "Warehouse K 2 Western Gateway", "London", "E16 1DR"),
  // -- a same-name venue in another city. The postcode veto's job.
  p(1693, "Albert Hall, Manchester", undefined, "27 Peter Street", "Manchester", "M2 5QR"),
  // -- shells whose text CONTAINS the postcode: these must join their building.
  p(2324, "Excel London, One Western Gateway, Royal Victoria Dock, London E16 1XL", undefined, "Excel London, One Western Gateway, Royal Victoria Dock, London E16 1XL"),
  p(2326, "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL", undefined, "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL"),
  p(2327, "Olympia London, Hammersmith Rd, London W14 8UX", undefined, "Olympia London, Hammersmith Rd, London W14 8UX"),
  // -- shells with NO postcode anywhere: they stand alone, and must not outrank.
  p(2075, "Excel"),
  p(6172, "Olympia"),
  p(2069, "London"),
];

const index = buildIndex(PLACES);
const find = (id: number) => index.find((b) => b.place_id === id);
const top = (text: string) => searchVenues(text, index, 5).hits;

console.log("\n[1] rows collapse into buildings, on the postcode");
{
  ok(index.length < PLACES.length, `${PLACES.length} rows -> ${index.length} buildings`);
  const excel = find(49);
  ok(!!excel, "ExCeL is one building");
  ok(excel!.members.length === 3, "its two address-shaped shells joined it", JSON.stringify(excel!.members));
  ok(excel!.postcode === "E16 1XL", "carrying the postcode from the real row", String(excel!.postcode));
  ok(excel!.spellings.length === 3, "and keeping every spelling the tenant holds", String(excel!.spellings.length));
  // The neighbours share a street and a district and are NOT the same building.
  ok(!excel!.members.includes(1241) && !excel!.members.includes(6356),
     "Novotel and The Fox stay separate — same street, different postcode");
}

console.log("\n[2] a row with no postcode anywhere stands alone");
{
  // Guessing a group for a row that says neither where it is nor what it is called
  // is how a real venue gets deleted for being a duplicate of something else.
  ok(find(2075)?.members.length === 1, "bare 'Excel' is its own building");
  ok(find(2075)?.unlocatable === true, "and is marked as unable to locate a job");
  ok(find(49)?.unlocatable === false, "while ExCeL London can");
  // A postcode is enough even when the address is a copy of the name.
  ok(find(826)?.unlocatable === false,
     "V&A East Storehouse repeats its name as its address AND has E20 3BS — that locates a job");
}

console.log("\n[3] the two distances, and why both are needed");
{
  ok(levenshtein("excel", "excel") === 0, "identical strings are 0 apart");
  ok(levenshtein("excel london", "exel london") === 1, "one dropped letter is 1");
  ok(levenshtein("abc", "xyz", 2) === 3, "the bound returns max+1 rather than the true distance");
  // Edit distance is length-sensitive in exactly the way client shorthand is not.
  ok(similarity("rah", "royal albert hall") < 0.25, "edit distance calls RAH a poor match", similarity("rah", "royal albert hall").toFixed(2));
  ok(jaroWinkler("rah", "royal albert hall") > 0.6, "Jaro-Winkler does not", jaroWinkler("rah", "royal albert hall").toFixed(2));
  // And the reverse: a typo is what edit distance is for.
  ok(similarity("olympa london", "olympia london") > 0.9, "a single typo stays close on edit distance");
}

console.log("\n[4] the client's own wordings resolve to the real building");
{
  for (const [text, want] of [
    ["ExCeL London", 49], ["Excel", 49], ["excel docklands", 49],
    ["The O2", 7], ["O2 arena", 7], ["the o2", 7],
    ["RAH", 2], ["Royal Albert Hall", 2],
    ["Olympia", 57], ["Olympia London", 57],
    ["the NEC", 791], ["NEC Birmingham", 791],
    ["V&A East Storehouse", 826],
  ] as const) {
    const t = top(text)[0];
    ok(t?.building.place_id === want, `${JSON.stringify(text)} -> ${want}`,
       t ? `${t.building.place_id} ${t.building.name} @${t.score.toFixed(2)}` : "(nothing)");
  }
}

console.log("\n[5] A SHELL NEVER OUTRANKS THE RECORD IT DUPLICATES");
{
  // The failure this file exists for. "Excel" is the literal name of shell 2075, so
  // an exact-match bonus paid on that put it above ExCeL London.
  const hits = top("Excel");
  ok(hits[0]?.building.place_id === 49, "'Excel' -> 49, not the bare shell", `${hits[0]?.building.place_id}`);
  const shell = hits.find((h) => h.building.place_id === 2075);
  ok(!shell || shell.score < hits[0].score, "the shell still ranks, but below", shell ? shell.score.toFixed(2) : "(absent)");
  ok(top("Olympia")[0]?.building.place_id === 57, "'Olympia' -> 57, not shell 6172");
  // It is withheld, not inverted: word and character agreement still count.
  ok(!!scoreBuilding("Excel", find(2075)!), "an unlocatable building is still a candidate");
}

console.log("\n[6] a postcode in another district is a VETO, not a penalty");
{
  ok(scoreBuilding("Royal Albert Hall SW7 2AP", find(1693)!) === null,
     "Manchester's Albert Hall is not a candidate for an SW7 query");
  ok(scoreBuilding("Royal Albert Hall SW7 2AP", find(2)!) !== null, "Kensington's is");
  ok(scoreBuilding("V&A, Cromwell Road SW7 2RL", find(826)!) === null,
     "the E20 Storehouse is not a candidate for a SW7 query");
  // With no postcode written, both Albert Halls are legitimate candidates.
  const both = top("the albert hall").map((h) => h.building.place_id);
  ok(both.includes(2) && both.includes(1693), "and with no city written, both are offered", JSON.stringify(both));
}

console.log("\n[7] nothing identifying in common is not a match");
{
  ok(top("the venue").length === 0, "'the venue' says nothing");
  ok(top("Conference Centre").length === 0, "a building-type word alone matches nobody");
  ok(top("Thornbury Assembly Rooms, BS35 2QQ").length === 0, "a venue the tenant does not hold");
  // A bare city still ranks here — the CALLER applies the city rule, because search
  // must not decide policy. See matchedOnCityAlone in venueMatch.ts.
  ok(top("London").length > 0, "a bare city still returns candidates — the caller refuses them, not search");
}

console.log("\n[8] every building is searched, and the count is reported");
{
  const r = searchVenues("ExCeL London", index, 3);
  ok(r.searched === index.length, `all ${index.length} buildings considered`, String(r.searched));
  ok(r.hits.length <= 3, "and the caller's limit is honoured");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
