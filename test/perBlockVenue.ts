// ============================================================================
// A job that moves crew between venues is staffed as separate teams.
//
// Location is half of what separates one SlotTeam from another (Ben, 2026-08-18),
// but nothing upstream could ever say it: the model extracted ONE venue for the
// whole job and every block inherited it, so "4 crew at ExCeL, then 2 at Olympia
// that afternoon" composed as one team at one place.
//
// The guard that matters is the other direction: a block-level venue string is the
// shortest and least reliable venue text in an email, so one that does not resolve
// keeps the job's venue rather than provisioning a new one. Creating venues from
// fragments is how the tenant ended up with 632 empty "ExCeL" rows.
//
// Run: npx tsx test/perBlockVenue.ts
// ============================================================================
import { composeOrder } from "../app/lib/engine/compose";
import { matchPlace } from "../app/lib/engine/resolve";
import type { ConversationFacts, PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PLACES: PlaceCandidate[] = [
  { id: 49, name: "ExCel London", alias: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 57, name: "Olympia London", alias: "Olympia", address: "Hammersmith Road", city: "London", zip: "W14 8UX", active: true },
];

const compose = (facts: ConversationFacts, place_id: number) =>
  composeOrder({ facts, company_id: 1, user_id: 2, place_id, pricelist_category_id: 342, jobName: "j", orderName: "o" });

console.log("\n[1] the resolver finds a block's own venue");
{
  ok(matchPlace("Olympia London", PLACES) === 57, "Olympia -> 57", String(matchPlace("Olympia London", PLACES)));
  ok(matchPlace("ExCeL London", PLACES) === 49, "ExCeL -> 49", String(matchPlace("ExCeL London", PLACES)));
}

console.log("\n[2] two venues at the same time are two teams");
{
  const teams = compose({
    requests: [
      { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4 },
      { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4, place_id: 57 },
    ],
  }, 49).order!.slot_teams;
  const crew = teams.filter((t) => t.profession_id === 1);
  ok(crew.length === 2, "two crew teams, not one of 8", String(crew.length));
  ok(crew.some((t) => t.place_id === 49) && crew.some((t) => t.place_id === 57), "one at each venue");
  // 8 people in one team would band to 2 chiefs; 4 and 4 band to one each. Same
  // number of bodies, different staffing — which is the whole point of the split.
  ok(teams.filter((t) => t.profession_id === 36).length === 2, "and a chief carved out at each place",
    String(teams.filter((t) => t.profession_id === 36).length));
  ok(teams.reduce((n, t) => n + t.size, 0) === 8, "eight people, as asked", String(teams.reduce((n, t) => n + t.size, 0)));
}

console.log("\n[3] a block with no venue of its own stays on the job's");
{
  const teams = compose({
    requests: [
      { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 3 },
      { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 3 },
    ],
  }, 49).order!.slot_teams;
  ok(teams.filter((t) => t.profession_id === 1).length === 1, "still one merged team of 6");
  ok(teams.every((t) => t.place_id === 49), "all on the order's place");
}

console.log("\n[4] the same venue named twice does not split anything");
{
  const teams = compose({
    requests: [
      { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 3, place_id: 49 },
      { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 3, place_id: 49 },
    ],
  }, 49).order!.slot_teams;
  ok(teams.filter((t) => t.profession_id === 1).length === 1, "one team of 5 + a chief, not two of 3",
    String(teams.filter((t) => t.profession_id === 1).length));
}

console.log("\n[5] an unresolvable block venue is not a new venue");
{
  // The compiler only assigns a per-block place when matchPlace finds an EXISTING one.
  ok(matchPlace("the loading bay round the back", PLACES) === null,
    "a fragment resolves to nothing rather than to something", String(matchPlace("the loading bay round the back", PLACES)));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
