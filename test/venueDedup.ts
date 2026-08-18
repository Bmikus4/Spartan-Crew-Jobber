// ============================================================================
// Which of several rows for the same venue a job gets booked to.
//
// The live tenant holds one real venue many times over: 632 rows named
// "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL" with
// every field null, beside ONE row named "ExCeL London" carrying the address,
// alias, postcode and coordinates. All 632 are active, so "first active hit" was
// really "whichever page of the pull it landed on".
//
// Ben, 2026-08-18: keep the one with the most context attached. That is decided
// here rather than by list order, and it outranks HOW the match was made — the
// shells match the client's text exactly precisely because the client's text is
// what created them.
//
// Run: npx tsx test/venueDedup.ts
// ============================================================================
import { matchPlace, placeContext } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const EXCEL_TEXT = "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL";
const REAL_EXCEL: PlaceCandidate = {
  id: 49, name: "ExCel London", alias: "ExCel London",
  address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true,
};
/** What the tool creates when the matcher misses: the email's text, nothing else. */
const shell = (id: number): PlaceCandidate => ({ id, name: EXCEL_TEXT, active: true });

console.log("\n[1] the rich record wins, wherever it sits in the list");
{
  for (const order of ["shells first", "rich first"] as const) {
    const shells = [2221, 2239, 2240, 2247].map(shell);
    const places = order === "shells first" ? [...shells, REAL_EXCEL] : [REAL_EXCEL, ...shells];
    ok(matchPlace(EXCEL_TEXT, places) === 49, `${order} -> #49`, String(matchPlace(EXCEL_TEXT, places)));
  }
}

console.log("\n[2] context outranks how the match was made");
{
  // The shell matches the text EXACTLY; #49 only by containment. Ranking on the
  // match tier picks the shell, which is the whole bug.
  const places = [shell(2221), REAL_EXCEL];
  ok(matchPlace(EXCEL_TEXT, places) === 49, "exact-name shell loses to the record that knows the address",
    String(matchPlace(EXCEL_TEXT, places)));
  ok(placeContext(REAL_EXCEL) > placeContext(shell(2221)), "and that is what 'more context' means");
}

console.log("\n[3] identical rows are settled by the oldest id, never by luck");
{
  const places = [shell(4000), shell(2221), shell(3000)];
  ok(matchPlace(EXCEL_TEXT, places) === 2221, "lowest id of the shells", String(matchPlace(EXCEL_TEXT, places)));
  ok(matchPlace(EXCEL_TEXT, [...places].reverse()) === 2221, "and the same answer reversed");
}

console.log("\n[4] an active row still beats a retired one");
{
  const retired: PlaceCandidate = { ...REAL_EXCEL, id: 9, active: false };
  const places = [retired, shell(2221)];
  ok(matchPlace(EXCEL_TEXT, places) === 2221, "retired venue loses even though it knows more",
    String(matchPlace(EXCEL_TEXT, places)));
  ok(matchPlace(EXCEL_TEXT, [retired]) === 9, "but is still better than inventing a duplicate");
}

console.log("\n[5] a street name is not an address (crew sent to the wrong town)");
{
  // Live: "Westbridge Manor Hall, 32 High Street, Westbridge, AB12 3CD" resolved to
  // Walthamstow Library, whose address is the two words "High Street".
  const library: PlaceCandidate = {
    id: 263, name: "Walthamstow Library", alias: "Walthamstow Library",
    address: "High Street", city: "London", zip: "E17 7JN", active: true,
  };
  const text = "Westbridge Manor Hall, 32 High Street, Westbridge, AB12 3CD";
  ok(matchPlace(text, [library]) !== 263, "a different town on the same street does not match",
    String(matchPlace(text, [library])));
  ok(matchPlace("Walthamstow Library, High Street, London E17 7JN", [library]) === 263,
    "the real address still matches — the postcode agrees");
}

console.log("\n[6] a record with no postcode must at least name a street number");
{
  const vague: PlaceCandidate = { id: 700, name: "Some Hall", address: "Station Road", active: true };
  ok(matchPlace("Other Venue, Station Road, Leeds LS1 4DY", [vague]) !== 700,
    "'Station Road' alone cannot claim a job", String(matchPlace("Other Venue, Station Road, Leeds LS1 4DY", [vague])));
  const numbered: PlaceCandidate = { id: 701, name: "Some Hall", address: "45 Station Road", active: true };
  ok(matchPlace("Some Hall, 45 Station Road, Leeds LS1 4DY", [numbered]) === 701,
    "a numbered street still resolves");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
