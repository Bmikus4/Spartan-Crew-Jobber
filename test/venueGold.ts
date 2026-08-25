// ============================================================================
// The venue second pass, measured against a hand-labelled gold set.
//
// A venue miss is not a null — it PROVISIONS A NEW ROW. 26 of the study's 100
// cases missed, and that is how the tenant came to hold 632 rows for ExCeL, 221
// for Olympia and 221 for the NEC. So the metric that matters here is not
// accuracy: it is precision on accept (a wrong accept sends crew to the wrong
// building) reported separately from duplicate creation (a miss that quietly grows
// the tenant a row).
//
// THE LABELS ARE HAND-WRITTEN AND THE FIXTURE IS FROZEN. Generating labels with a
// model would put the venue text and the answer through the same source, which is
// the self-match illusion that once produced 98.7% on a matcher study here that
// scored 45.9% on real queries.
//
// The fixture is a small extract of the live place list committed as test data —
// the real rows for the venues the corpus uses, plus the shells and near-misses
// that make them hard. Frozen deliberately: a harness that reads a live pull is a
// harness whose result changes when somebody edits OnSinch.
//
// Run: npx tsx test/venueGold.ts
// ============================================================================
import { matchPlace } from "../app/lib/engine/resolve";
import { matchPlaceV2, matchedOnCityAlone, isAShell } from "../app/lib/engine/venueMatch";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

type Row = PlaceCandidate & { lat?: number; lng?: number };
const p = (
  id: number, name: string, alias?: string | null, address?: string | null,
  city?: string | null, zip?: string | null, active = true
): Row => ({ id, name, alias: alias ?? null, address: address ?? null, city: city ?? null, zip: zip ?? null, active } as Row);

/**
 * The extract. Every row here is a real shape from the live tenant: the rich
 * canonical rows, the context-free shells the old matcher created, the same-name
 * different-city traps, and the near-misses that must NOT be matched.
 */
const PLACES: Row[] = [
  // -- the canonical rows
  p(2, "Royal Albert Hall", "RAH", "Kensington Gore", "London", "SW7 2AP"),
  p(7, "The O2", "O2", "Peninsula Square", "London", "SE10 0DX"),
  p(49, "ExCel London", "ExCel London", "1 Western Gateway", "London", "E16 1XL"),
  p(57, "Olympia London", "Olympia", "Hammersmith Road", "London", "W14 8UX"),
  p(791, "National Exhibition Centre", "NEC", "Pendigo Way", "Birmingham", "B40 1NT"),
  p(826, "V&A East Storehouse", null, "Parkes Street", "London", "E20 3BS"),
  p(1002, "Olympia West", null, "Hammersmith Road", "London", "W14 8UX"),

  // -- the shells: what the old matcher created, matching the client's words
  //    exactly BECAUSE the client's words are what made them.
  p(2075, "Excel"),
  p(6062, "Excel, Maritime Hall"),
  p(1425, "Olympia", null, "Hammersmith Road", "London", "W14 8UX"),
  p(6177, "Royal Albert Hall"),
  p(3001, "The O2"),
  /**
   * The study's own residue: five rows it left in the live tenant on 2026-08-24,
   * each carrying its own name as its address. matchPlace matches them EXACTLY, so
   * they intercept the venues they are duplicates of and the matcher never reaches
   * the real row. This is the mechanism that makes a venue score rise as the tenant
   * gets worse — a miss creates the row that makes the next miss look like a hit.
   */
  p(6892, "The Albert Hall", null, "The Albert Hall"),
  p(6893, "O2 Arena", null, "O2 Arena"),
  p(6894, "ExCeL Docklands", null, "ExCeL Docklands"),

  // -- the traps
  p(823, "O2 Academy Brixton", null, "211 Stockwell Road", "London", "SW9 9SL"),
  p(765, "InterContinental London - the O2", null, "1 Waterview Drive", "London", "SE10 0TW", false),
  p(1693, "Albert Hall, Manchester", null, "27 Peter Street", "Manchester", "M2 5QR"),
  p(23, "Victoria and Albert Museum (V&A)", "V&A", "Cromwell Road", "London", "SW7 2RL"),
  p(6267, "V&A East Museum", null, "Stratford", "London", "E20 1AA"),
  p(2069, "London"),
  p(2266, "Westbridge Manor Hall", null, "32 High Street", "Westbridge", "AB12 3CD"),
  p(1341, "Walthamstow Library", null, "High Street", "London", "E17 7JN"),
  p(92, "Novotel London West", null, "1 Shortlands", "London", "W6 8DR"),
];

/**
 * `id` is the row a competent human would book. `null` means NO row is right and
 * provisioning is the correct answer — 25 of the study's 100 cases were genuinely
 * new venues and matching them would be the worse error.
 */
interface Gold {
  text: string;
  id: number | null;
  /** A second row that is the SAME BUILDING and equally correct to book. */
  also?: number;
  why: string;
}

const GOLD: Gold[] = [
  // ---- the three the study named. All three provisioned a duplicate.
  { text: "O2 arena", id: 7, why: "a leading article and a building-type word, nothing else" },
  { text: "excel docklands", id: 49, why: "a district the row does not name" },
  /**
   * THE ONE THE DETERMINISTIC SPINE CANNOT SETTLE, and the honest answer is to say
   * so rather than to tune a weight until it comes out right.
   *
   * "the albert hall" agrees with the Royal Albert Hall in Kensington and with the
   * Albert Hall in Manchester to exactly the same degree. Both are real venues,
   * both are named that, and the client wrote no city. The only thing separating
   * them is that this is a London crew supplier — a fact about the business, not
   * about the text, and not one a matcher can read.
   *
   * What settles it is not the text. It is that the tenant already holds a row
   * called "The Albert Hall" with no postcode — one of the engine's own shells,
   * created from a London booking — and having no postcode it cannot contradict
   * Kensington, so it clusters with the Royal Albert Hall and lends its agreement
   * to that building. Manchester's row names its city and stays separate.
   *
   * That is the tenant's own history acting as evidence, which is the right thing
   * for it to do, but it is worth saying out loud that this case turns on a row
   * rather than on the words. Take the shell away and the two are level, the
   * resolution is `ambiguous`, and the ticket names both — which is also correct,
   * and is the short identified class an escalation step would be pointed at if one
   * is ever built.
   */
  { text: "the albert hall", id: 2, why: "the tenant's own 'The Albert Hall' row clusters with the RAH and settles it" },

  // ---- the wordings that already worked, which must keep working
  { text: "The O2", id: 7, why: "exact name" },
  { text: "the O2", id: 7, why: "case" },
  { text: "RAH", id: 2, why: "exact alias, below the four-character floor" },
  { text: "Royal Albert Hall", id: 2, why: "exact name" },
  { text: "ExCeL London", id: 49, why: "exact name, different case" },
  { text: "Excel", id: 49, why: "the RICH row, not the shell that says only this" },
  { text: "Olympia", id: 57, why: "the rich row; two shells say the same thing" },
  { text: "Olympia London", id: 57, why: "exact name" },
  { text: "NEC Birmingham", id: 791, why: "alias plus city" },
  { text: "the NEC", id: 791, why: "a leading article on a three-letter alias" },
  { text: "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL", id: 49, why: "the full address the corpus uses" },
  { text: "ExCeL, 1 Western Gateway, E16 1XL", id: 49, why: "postcode agreement" },

  // ---- the halls. Same address, same postcode, and the client named one of them.
  // 57 and 1002 carry the SAME address and the SAME postcode — Olympia West is a
  // hall inside Olympia London, so either row sends crew to Hammersmith Road. The
  // second pass prefers the row the client actually named; matchPlace answers first
  // and says 57, which is not a wrong booking. Both are accepted here because
  // labelling one of them wrong would be labelling a preference as a defect.
  { text: "Olympia West", id: 57, also: 1002, why: "same site, same postcode; the hall is inside the venue" },

  // ---- THE SHELLS THE ENGINE MADE. A row that says only what the client said is
  //      set aside so the second pass can find the row that knows where it is.
  { text: "ExCeL Docklands", id: 49, why: "matchPlace matches shell 6894 exactly; 49 is the building" },
  { text: "O2 Arena", id: 7, why: "matchPlace matches shell 6893 exactly; 7 is the building" },

  // ---- ADVERSARIAL. Each of these has already bitten this codebase.
  { text: "V&A East Storehouse", id: 826, why: "NOT the South Kensington museum" },
  { text: "Westbridge Manor Hall, High Street", id: 2266, why: "a street with no number; Walthamstow Library's address is the two words 'High Street'" },

  // ---- NOTHING IS RIGHT. Provisioning is the correct answer.
  { text: "Thornbury Assembly Rooms, 14 Kestrel Way, Thornbury BS35 2QQ", id: null, why: "a venue the tenant does not hold" },
  { text: "London", id: null, why: "a bare city name; a row literally called London exists and must not be booked" },
  { text: "the venue", id: null, why: "says nothing" },
  { text: "Birmingham", id: null, why: "a bare city, and the NEC is in it" },
  { text: "Hall B Loading Bay", id: null, why: "building-type words only" },
];

// ---------------------------------------------------------------- measure
/** What the engine actually does: matchPlace first, the second pass only on null. */
function resolve(text: string): { id: number | null; from: "v1" | "v2" | "none"; ambiguous?: boolean } {
  // The compiler's own path: matchPlace, minus a city-only answer, minus a shell
  // (which is set aside so the second pass can look, and used if nothing is better).
  const raw = matchPlace(text, PLACES);
  const rawRow = raw ? PLACES.find((q) => q.id === raw)! : undefined;
  const cityOnly = !!rawRow && matchedOnCityAlone(text, rawRow);
  const shell = !!rawRow && isAShell(rawRow);
  const v1 = raw && !cityOnly && !shell ? raw : null;
  if (v1) return { id: v1, from: "v1" };
  if (cityOnly) return { id: null, from: "none" };
  const v2 = matchPlaceV2(text, PLACES);
  if (v2.decision === "match" && v2.place_id) return { id: v2.place_id, from: "v2" };
  if (raw && shell) return { id: raw, from: "v1" };
  return { id: null, from: "none", ambiguous: v2.decision === "ambiguous" };
}

const results = GOLD.map((g) => ({ g, r: resolve(g.text) }));

console.log("\n[1] every labelled venue resolves to the labelled row");
{
  const right = (x: { g: Gold; r: { id: number | null } }) =>
    x.r.id === x.g.id || (x.g.also !== undefined && x.r.id === x.g.also);
  const wrong = results.filter((x) => !right(x));
  for (const x of wrong) {
    const got = PLACES.find((q) => q.id === x.r.id);
    console.log(`  MISS  ${JSON.stringify(x.g.text)}: want ${x.g.id ?? "(provision)"}, got ${x.r.id ?? "(provision)"} ${got ? JSON.stringify(got.name) : ""}  [${x.g.why}]`);
  }
  ok(wrong.length === 0, `${GOLD.length - wrong.length}/${GOLD.length}`);
}

console.log("\n[2] the metrics, reported separately and never blended");
{
  const right = (x: { g: Gold; r: { id: number | null } }) =>
    x.r.id === x.g.id || (x.g.also !== undefined && x.r.id === x.g.also);
  const hadRow = results.filter((x) => x.g.id !== null);
  const accepted = results.filter((x) => x.r.id !== null);
  const rightAccepts = accepted.filter(right).length;
  const found = hadRow.filter(right).length;
  const dupes = hadRow.filter((x) => x.r.id === null).length;
  const wrongBuilding = accepted.length - rightAccepts;

  // The one that costs money when it drops: crew driven to the wrong building.
  ok(rightAccepts === accepted.length,
     `precision on accept ${rightAccepts}/${accepted.length}`, wrongBuilding ? `${wrongBuilding} WRONG BUILDING` : "");
  ok(found === hadRow.length, `recall ${found}/${hadRow.length}`);
  // The metric the current system fails: a venue the tenant already has, created again.
  ok(dupes === 0, `duplicate creation ${dupes}/${hadRow.length}`);
  // Declining must be right when it happens.
  const shouldProvision = results.filter((x) => x.g.id === null);
  const declined = shouldProvision.filter((x) => x.r.id === null).length;
  ok(declined === shouldProvision.length, `abstention correctness ${declined}/${shouldProvision.length}`);
}

console.log("\n[3] what the second pass added, and what it left");
{
  const byV2 = results.filter((x) => x.r.from === "v2" && (x.r.id === x.g.id || x.r.id === x.g.also));
  console.log(`  matchPlace alone would have provisioned ${byV2.length} duplicate row(s):`);
  for (const x of byV2) console.log(`      ${JSON.stringify(x.g.text)} -> ${x.r.id}`);
  ok(byV2.length > 0, "the second pass earns its place");

  // The class the deterministic spine genuinely cannot settle, named rather than
  // hidden: two REAL venues whose names agree and whose cities the client did not
  // write. Provisioning is what happens, and the ticket says what it was choosing
  // between — that is the honest answer, and it is where an escalation step, if one
  // is ever built, would be pointed.
  const amb = GOLD.filter((g) => matchPlace(g.text, PLACES) === null)
    .map((g) => ({ g, v2: matchPlaceV2(g.text, PLACES) }))
    .filter((x) => x.v2.decision === "ambiguous");
  console.log(`  ambiguous, left for a human: ${amb.length}`);
  for (const x of amb) console.log(`      ${JSON.stringify(x.g.text)} -> ${x.v2.candidates.slice(0, 3).map((c) => `${c.id} ${c.name}`).join(" / ")}`);
}

console.log("\n[4] the second pass cannot change an answer matchPlace already gives");
{
  // The whole safety property of running second. matchPlace carries scar tissue that
  // was paid for one wrong booking at a time, and none of it is at risk here.
  const v1Answers = GOLD.filter((g) => {
    const raw = matchPlace(g.text, PLACES);
    if (raw === null) return false;
    const row = PLACES.find((q) => q.id === raw)!;
    return !matchedOnCityAlone(g.text, row) && !isAShell(row);
  });
  const unchanged = v1Answers.every((g) => resolve(g.text).id === matchPlace(g.text, PLACES));
  ok(unchanged, `all ${v1Answers.length} venues matchPlace resolves are untouched`);
}

console.log("\n[5] a postcode in a different district is a veto, however alike the names");
{
  const r = matchPlaceV2("V&A, Cromwell Road, SW7 2RL", PLACES);
  ok(r.place_id === 23, "the South Kensington postcode picks the museum", String(r.place_id));
  const e = matchPlaceV2("V&A East Storehouse, E20 3BS", PLACES);
  ok(e.place_id === 826, "and the E20 postcode picks the Storehouse", String(e.place_id));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
