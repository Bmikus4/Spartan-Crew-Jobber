// ============================================================================
// Which bucket every venue row lands in, and the three rules that are easy to
// get wrong.
//
//  1. THE SENTINEL IS ONE NAME, NOT A FAMILY. August held back 384 rows with a
//     regex matching placeholder|unknown|test. The engine looks up exactly one
//     string, "No Location", so that rule was protecting 210 "Placeholder" rows
//     and 171 "Unknown" rows — all bare, all active, all matchable.
//
//  2. GENERIC WITH DATA IS NOT GENERIC-BARE. Nine rows are named "Private
//     Residence" and every one carries a different real postcode. They are nine
//     different homes. Deleting them destroys nine real addresses; merging them
//     is worse.
//
//  3. USAGE IS NOT AN INPUT. Ben, 2026-09-18: "an in use venue is not
//     automatically kept. instead, we must still look at it for duplicates."
//     classify() takes one argument and cannot see reference counts.
//
// Run: npx tsx test/venueClassify.ts
// ============================================================================
import { classify, richness, isBare, SENTINEL_NAME } from "../scripts/venue-sweep";

let fails = 0;
const ok = (c: boolean, label: string) => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`);
};

const P = [
  // identical: same normalised name, same postcode. Survivor is the richest.
  { id: 9, name: "Fairmont Windsor Park", zip: "TW20 0YL", city: "Egham", active: true },
  { id: 6835, name: "Fairmont Windsor Park", zip: "TW20 0YL", active: true },
  { id: 6837, name: "Fairmont Windsor Park", zip: "TW20 0YL", active: true },
  // same name, different postcode -> never auto-merged
  { id: 8, name: "Battersea Power Station", zip: "SW11 8DD", active: true },
  { id: 312, name: "Battersea Power Station", zip: "SW11 8BZ", active: true },
  // several rows, none of which can locate a job
  { id: 2158, name: "Northbridge Convention Center, 122 Main Street, London, NW1 3AB", active: true },
  { id: 2161, name: "Northbridge Convention Center, 122 Main Street, London, NW1 3AB", active: true },
  // generic AND bare -> delete
  { id: 1809, name: "Placeholder", active: true },
  { id: 2100, name: "Unknown", active: true },
  { id: 2069, name: "London", active: true },
  // generic WITH data -> kept
  { id: 60, name: "Private Residence", zip: "N10 1NT", active: true },
  // the sentinel, and a clone of it
  { id: 6922, name: "No Location", active: true },
  { id: 6999, name: "No Location", active: true },
  // ordinary row -> untouched
  { id: 49, name: "ExCel London", zip: "E16 1XL", address: "1 Western Gateway", active: true },
];

const c = classify(P);

ok(c.byId.get(6922) === "sentinel", "the lowest-id No Location is the sentinel");
ok(!c.deletions.includes(6922), "the sentinel is never deleted");
ok(c.byId.get(6999) === "generic-bare" && c.deletions.includes(6999), "a second No Location is an ordinary duplicate");
ok(!c.groups.some((g) => g.members.includes(6999)), "the sentinel's clone is never put in a merge group");

ok(c.byId.get(60) === "generic-with-data", "Private Residence carries a postcode, so it is not bare");
ok(!c.deletions.includes(60), "a generic row with data is never deleted");
ok(
  c.deletions.includes(1809) && c.deletions.includes(2100) && c.deletions.includes(2069),
  "generic AND bare rows are deletions"
);
ok(c.byId.get(49) === "untouched", "an ordinary locatable row with a unique name is untouched");

const fair = c.groups.find((g) => g.members.includes(6835));
ok(fair?.bucket === "identical", "same name + same postcode is the identical bucket");
ok(fair?.survivor === 9, "the survivor is the row with the most data");
ok(fair?.members.length === 3, "all three Fairmont rows are in one group");
ok(fair?.members.includes(6835) === true, "a duplicate is grouped regardless of how booked it is");

const bat = c.groups.find((g) => g.members.includes(312));
ok(bat?.bucket === "same-name-diff-postcode", "different postcodes never land in identical");

const shells = c.groups.find((g) => g.members.includes(2158));
ok(shells?.bucket === "shell-group", "same name, nothing locatable, is shell-group not diff-postcode");

// Structural, not a promise in a comment: re-adding a usage parameter breaks this.
ok(classify.length === 1, "classify takes exactly one argument and cannot see usage");

ok(isBare({ name: "X" }) === true, "a row with nothing on it is bare");
ok(isBare({ name: "X", zip: "E16 1XL" }) === false, "a postcode makes it locatable");
ok(isBare({ name: "X", address: "X" }) === true, "an address that is a copy of the name locates nothing");
ok(richness({ zip: "A", city: "B" }) === 2, "richness counts populated fields");
ok(SENTINEL_NAME === "no location", "the sentinel name is normalised");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
