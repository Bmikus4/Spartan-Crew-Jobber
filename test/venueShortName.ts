// ============================================================================
// A venue named BRIEFLY — "ExCeL", "RAH" — rather than written out in full.
//
// Two separate holes, both measured against the live tenant's 6,847 places:
//
//   "ExCeL" resolved to place 2075, named "Excel" with every other field null,
//   while "ExCeL London" resolved to 49, the row carrying the address, postcode
//   and coordinates. Ten rows are named exactly "Excel" and match at tier 0;
//   the real row is named "ExCel London", and name-containment asks whether the
//   EMAIL contains the RECORD's name — "excel" does not contain "excel london".
//   Context outranks tier, but it can only rank rows that matched at all.
//
//   "RAH" resolved to nothing, because matchPlace returns null before any
//   matching runs when the text is under four characters — and nothing is what
//   provisions a duplicate. Five places carry an alias shorter than four
//   characters and NO alias under six characters is held by more than one place,
//   so an exact alias match cannot be ambiguous and does not need the floor.
//
// Run: npx tsx test/venueShortName.ts
// ============================================================================
import { matchPlace } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** The live row for the venue, id and fields as pulled 2026-08-18. */
const REAL_EXCEL: PlaceCandidate = {
  id: 49, name: "ExCel London", alias: "ExCel London",
  address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true,
};
/** What the tool created the last ten times a client just typed "ExCeL". */
const bareShell = (id: number, name = "Excel"): PlaceCandidate => ({ id, name, active: true });
/** And the 632 rows made from the whole address, which also begin with "excel". */
const ADDR_SHELL = "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL";

console.log("\n[1] a venue named briefly reaches the row that knows the address");
{
  const places = [bareShell(2075), bareShell(2081), bareShell(2090), REAL_EXCEL];
  ok(matchPlace("ExCeL", places) === 49, "'ExCeL' -> #49, not the address-less shell",
    String(matchPlace("ExCeL", places)));
  ok(matchPlace("ExCeL London", places) === 49, "and the name written out in full still -> #49",
    String(matchPlace("ExCeL London", places)));
}

console.log("\n[2] the shells made from the full address do not make it ambiguous");
{
  // 632 of these exist live. Every one of them begins with "excel", so counting
  // distinct STRINGS would refuse the match; they are the same venue as #49 and
  // carry no context, which is exactly what distinguishes them.
  const places = [bareShell(2075), ...[2221, 2239, 2240].map((id) => bareShell(id, ADDR_SHELL)), REAL_EXCEL];
  ok(matchPlace("ExCeL", places) === 49, "'ExCeL' -> #49 with 632-style shells present",
    String(matchPlace("ExCeL", places)));
}

console.log("\n[3] two DIFFERENT venues sharing a first word are never guessed between");
{
  // Live: "Olympia London" (#57) and "Olympia West" (#58) are different buildings.
  const OLYMPIA: PlaceCandidate = {
    id: 57, name: "Olympia London", alias: "Olympia",
    address: "Hammersmith Road", city: "London", zip: "W14 8UX", active: true,
  };
  const WEST: PlaceCandidate = {
    id: 58, name: "Olympia West", address: "Olympia Way", city: "London", zip: "W14 8UX", active: true,
  };
  ok(matchPlace("Olympia", [OLYMPIA, WEST]) === 57,
    "'Olympia' -> #57 on its ALIAS, which is exact, not on the first-word guess",
    String(matchPlace("Olympia", [OLYMPIA, WEST])));

  // Strip the alias and there is nothing exact left. Two rich rows begin with
  // "olympia " and the resolver must not pick one: a wrong venue sends crew to
  // the wrong building, which is worse than provisioning a duplicate row.
  const noAlias = { ...OLYMPIA, alias: undefined };
  const answer = matchPlace("Olympia", [noAlias, WEST]);
  ok(answer !== 58, "with no alias it does not fall on the other building", String(answer));
}

console.log("\n[4] a short alias resolves, and only an exact one");
{
  const RAH: PlaceCandidate = {
    id: 2, name: "Royal Albert Hall", alias: "RAH",
    address: "Kensington Gore", city: "London", zip: "SW7 2AP", active: true,
  };
  ok(matchPlace("RAH", [RAH]) === 2, "'RAH' -> #2 on the alias OnSinch already holds",
    String(matchPlace("RAH", [RAH])));
  ok(matchPlace("RAH, Kensington Gore", [RAH]) === 2, "'RAH, Kensington Gore' -> #2 too",
    String(matchPlace("RAH, Kensington Gore", [RAH])));

  const VA: PlaceCandidate = {
    id: 23, name: "Victoria and Albert Museum (V&A)", alias: "V&A",
    address: "Cromwell Road", city: "London", zip: "SW7 2RL", active: true,
  };
  ok(matchPlace("V&A", [VA]) === 23, "'V&A' normalises to 'v a' and still matches its alias",
    String(matchPlace("V&A", [VA])));

  // The floor is load-bearing for everything else. "O2" carries no alias on the
  // live tenant, so it stays unresolved — that is a row to fix in OnSinch, not
  // a rule to relax here. Three letters must never sweep the address list.
  const O2: PlaceCandidate = {
    id: 90, name: "The O2 Arena", address: "Peninsula Square", city: "London", zip: "SE10 0DX", active: true,
  };
  ok(matchPlace("O2", [O2]) === null, "'O2' with no alias resolves to nothing",
    String(matchPlace("O2", [O2])));
  const HALL: PlaceCandidate = { id: 91, name: "Rah Hall", address: "12 Rah Street", city: "Leeds", zip: "LS1 4DY", active: true };
  ok(matchPlace("RAH", [HALL]) === null, "and a three-letter text does not claim a street that contains it",
    String(matchPlace("RAH", [HALL])));
}

console.log("\n[5] a shell only wins when nothing better matched");
{
  // No rich row at all: the shell is still a better answer than inventing a
  // duplicate, and this is what the resolver did before either fix.
  const places = [bareShell(2075), bareShell(2081)];
  ok(matchPlace("ExCeL", places) === 2075, "the oldest shell, when it is all there is",
    String(matchPlace("ExCeL", places)));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
