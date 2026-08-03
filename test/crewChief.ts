// ============================================================================
// The crew-chief rule, as Ben specified it on 2026-08-03.
// ----------------------------------------------------------------------------
//   4 or more crew on a shift  -> 1 crew chief
//   10 or more                 -> 2
//   20 or more                 -> 3
// "add-on for both": the chief is ADDED, never substituted, for general crew and
// for specific roles alike. Four carpenters means four carpenters plus a chief,
// five people.
//
// The bands count a SHIFT, not a slot team — "four or more crew added to a shift".
// So teams sharing a start and end are summed before the band applies: 4 carpenters
// plus 4 crew at the same time is 8 people and one chief, not one per team.
//
// What the code did instead: chiefCount = ceil(size / 4), applied per team, and
// only to profession CREW. So 8 crew got 2 chiefs, 20 got 5, 40 got 10, and a
// carpenters-only request got none at all.
//
// This is a REPLACEMENT tool, not an assistant — these numbers go on a real order
// and get billed, so they are pinned rather than left to a comment.
//
// Run: npx tsx test/crewChief.ts
// ============================================================================
import { composeOrder, chiefsForShift } from "../app/lib/engine/compose";
import { PROFESSION, type ConversationFacts } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

console.log("\n[1] the bands themselves");
{
  const cases: Array<[number, number]> = [
    [0, 0], [1, 0], [3, 0],
    [4, 1], [5, 1], [9, 1],
    [10, 2], [15, 2], [19, 2],
    [20, 3], [40, 3], [100, 3],
  ];
  for (const [n, want] of cases) {
    const got = chiefsForShift(n);
    ok(got === want, `${String(n).padStart(3)} crew -> ${want} chief(s)`, got === want ? "" : `got ${got}`);
  }
}

const compose = (facts: ConversationFacts) =>
  composeOrder({
    facts, company_id: 1, user_id: 2, place_id: 3,
    pricelist_category_id: 342, jobName: "job", orderName: "order",
  });

const teamsOf = (facts: ConversationFacts) => compose(facts).order?.slot_teams ?? [];
const sizeOf = (teams: any[], prof: number) =>
  teams.filter((t) => t.profession_id === prof).reduce((n, t) => n + t.size, 0);

console.log("\n[2] general crew: the chief is ADDED, not taken out of the count");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 6 }] });
  ok(sizeOf(teams, PROFESSION.CREW) === 6, "all 6 crew are still crew", String(sizeOf(teams, PROFESSION.CREW)));
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 1, "plus 1 chief", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
}

console.log("\n[3] Ben's carpenter example: 4 carpenters -> 5 people");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 4, profession_hint: "carpenter" }] });
  ok(sizeOf(teams, PROFESSION.CARPENTER) === 4, "4 carpenters", String(sizeOf(teams, PROFESSION.CARPENTER)));
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 1, "and a chief — a role request is NOT exempt", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  const total = teams.reduce((n, t) => n + t.size, 0);
  ok(total === 5, "five people in total", String(total));
}

console.log("\n[4] the band counts the SHIFT, not each team");
{
  // 4 carpenters + 4 crew at the same time = 8 people = ONE chief, not two.
  const teams = teamsOf({
    requests: [
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 4, profession_hint: "carpenter" },
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 4 },
    ],
  });
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 1, "8 people on one shift -> 1 chief", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  ok(teams.filter((t) => t.profession_id === PROFESSION.CREW_CHIEF).length === 1, "as a single chief team");
}
{
  // Different days are different shifts and are banded independently.
  const teams = teamsOf({
    requests: [
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 6 },
      { date: "2026-08-13", start_time: "08:00", end_time: "18:00", size: 12 },
    ],
  });
  const chiefs = teams.filter((t) => t.profession_id === PROFESSION.CREW_CHIEF);
  ok(chiefs.length === 2, "one chief team per shift", String(chiefs.length));
  ok(chiefs.some((t) => t.size === 1) && chiefs.some((t) => t.size === 2),
    "6 crew -> 1, 12 crew -> 2", chiefs.map((t) => t.size).join("/"));
}

console.log("\n[5] under the threshold, nobody is added");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 3 }] });
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 0, "3 crew -> no chief", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  ok(teams.length === 1, "and no extra team");
}

console.log("\n[6] a chief is never given a chief");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 5, profession_hint: "crew chief" }] });
  const chiefTeams = teams.filter((t) => t.profession_id === PROFESSION.CREW_CHIEF);
  const total = chiefTeams.reduce((n, t) => n + t.size, 0);
  ok(total === 5, "5 chiefs requested stay 5, with none added on top", String(total));
}

console.log("\n[7] the warning states the rule that was applied");
{
  const { warnings } = compose({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 12 }] });
  ok(warnings.some((w) => /12/.test(w) && /2/.test(w) && /chief/i.test(w)),
    "says 12 crew -> 2 chiefs", warnings.find((w) => /chief/i.test(w)) ?? "(none)");
  ok(!warnings.some((w) => /Tracy/i.test(w)),
    "no longer asks anyone to confirm the policy — Ben has ruled on it");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
