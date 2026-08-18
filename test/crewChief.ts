// ============================================================================
// The crew-chief rule, as Ben settled it on 2026-08-18.
// ----------------------------------------------------------------------------
//   4 or more in a team  -> 1 crew chief
//   10 or more           -> 2
//   20 or more           -> 3
// The chief is CARVED OUT of the team, never added to it: the client's number is
// the number that turns up. 6 -> 5 + 1, 4 -> 3 + 1, 20 -> 17 + 3. Specialists are
// not exempt — 4 carpenters is 3 carpenters and a chief.
//
// The band reads ONE SlotTeam, and a SlotTeam is the unit of work: a new team when
// the window or the location differs, never when the size does. So blocks sharing a
// window and a place are merged before the band runs, and client labels like
// "Call 1 / Call 2" split nothing on their own.
//
// This replaced per-shift summing (which banded across professions sharing a start
// and end) and, before that, chiefCount = ceil(size / 4) applied only to profession
// CREW — which over-staffed everything above 4 and gave carpenters no chief at all.
//
// This is a REPLACEMENT tool, not an assistant — these numbers go on a real order
// and get billed, so they are pinned rather than left to a comment.
//
// Run: npx tsx test/crewChief.ts
// ============================================================================
import { composeOrder, chiefsForTeam } from "../app/lib/engine/compose";
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
    const got = chiefsForTeam(n);
    ok(got === want, `${String(n).padStart(3)} in a team -> ${want} chief(s)`, got === want ? "" : `got ${got}`);
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
const totalOf = (teams: any[]) => teams.reduce((n, t) => n + t.size, 0);

console.log("\n[2] general crew: the chief comes OUT of the count");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 6 }] });
  ok(sizeOf(teams, PROFESSION.CREW) === 5, "6 asked for -> 5 crew", String(sizeOf(teams, PROFESSION.CREW)));
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 1, "and 1 chief", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  ok(totalOf(teams) === 6, "six people turn up, as asked", String(totalOf(teams)));
}

console.log("\n[3] headcount is unchanged at every band");
{
  for (const [asked, crew, chiefs] of [[4, 3, 1], [10, 8, 2], [20, 17, 3], [40, 37, 3]] as const) {
    const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: asked }] });
    ok(sizeOf(teams, PROFESSION.CREW) === crew && sizeOf(teams, PROFESSION.CREW_CHIEF) === chiefs && totalOf(teams) === asked,
      `${asked} -> ${crew} + ${chiefs}`, `${sizeOf(teams, PROFESSION.CREW)} + ${sizeOf(teams, PROFESSION.CREW_CHIEF)}`);
  }
}

console.log("\n[4] Q9(a): specialists lose the body too");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 4, profession_hint: "carpenter" }] });
  ok(sizeOf(teams, PROFESSION.CARPENTER) === 3, "4 carpenters -> 3 carpenters", String(sizeOf(teams, PROFESSION.CARPENTER)));
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 1, "and a chief — a role request is NOT exempt", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  ok(totalOf(teams) === 4, "still four people", String(totalOf(teams)));
}

console.log("\n[5] size never splits: same window and place is ONE team");
{
  // "3 crew and 3 crew" at 14:00 at the same place is a team of 6 — which bands.
  const teams = teamsOf({
    requests: [
      { date: "2026-08-12", start_time: "14:00", end_time: "22:00", size: 3, task: "Call 1" },
      { date: "2026-08-12", start_time: "14:00", end_time: "22:00", size: 3, task: "Call 2" },
    ],
  });
  ok(teams.filter((t) => t.profession_id === PROFESSION.CREW).length === 1, "one crew team, not two",
    String(teams.filter((t) => t.profession_id === PROFESSION.CREW).length));
  ok(sizeOf(teams, PROFESSION.CREW) === 5 && sizeOf(teams, PROFESSION.CREW_CHIEF) === 1,
    "6 merged -> 5 + 1, where 3 and 3 banded apart would have given none",
    `${sizeOf(teams, PROFESSION.CREW)} + ${sizeOf(teams, PROFESSION.CREW_CHIEF)}`);
}

console.log("\n[6] a differing window splits, and each team bands alone");
{
  // RG Jones stays two teams because the TIMES differ, not because of the labels.
  const teams = teamsOf({
    requests: [
      { date: "2026-08-12", start_time: "08:00", end_time: "12:00", size: 4 },
      { date: "2026-08-12", start_time: "14:00", end_time: "22:00", size: 4 },
    ],
  });
  ok(teams.filter((t) => t.profession_id === PROFESSION.CREW).length === 2, "two crew teams");
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 2, "a chief carved out of each", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  ok(totalOf(teams) === 8, "eight people, as asked", String(totalOf(teams)));
}

console.log("\n[7] a differing location splits, at the same time");
{
  const teams = teamsOf({
    requests: [
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 4, place_id: 3 },
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 4, place_id: 9 },
    ],
  });
  ok(teams.filter((t) => t.profession_id === PROFESSION.CREW).length === 2, "two crew teams, one per place");
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 2, "and a chief at each place", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  ok(teams.every((t) => t.place_id === 3 || t.place_id === 9), "each team keeps its own place");
}

console.log("\n[8] a chief the client asked for offsets the carve");
{
  // 3 crew + 1 chief: the crew team is under the band, so nothing is taken.
  const teams = teamsOf({
    requests: [
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 3 },
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 1, profession_hint: "crew chief" },
    ],
  });
  ok(sizeOf(teams, PROFESSION.CREW) === 3 && sizeOf(teams, PROFESSION.CREW_CHIEF) === 1,
    "3 + 1 stays 3 + 1", `${sizeOf(teams, PROFESSION.CREW)} + ${sizeOf(teams, PROFESSION.CREW_CHIEF)}`);
}
{
  // 10 crew + 1 chief is 11 people wanting 2 chiefs; one is already named, so only
  // one more is carved — 9 + 2, not 8 + 3.
  const teams = teamsOf({
    requests: [
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 10 },
      { date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 1, profession_hint: "crew chief" },
    ],
  });
  ok(sizeOf(teams, PROFESSION.CREW) === 9 && sizeOf(teams, PROFESSION.CREW_CHIEF) === 2,
    "10 + 1 -> 9 + 2", `${sizeOf(teams, PROFESSION.CREW)} + ${sizeOf(teams, PROFESSION.CREW_CHIEF)}`);
  ok(totalOf(teams) === 11, "eleven people, as asked", String(totalOf(teams)));
  ok(teams.filter((t) => t.profession_id === PROFESSION.CREW_CHIEF).length === 1,
    "as a single chief team — same window, same place, same profession");
}

console.log("\n[9] under the threshold, nobody is taken");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 3 }] });
  ok(sizeOf(teams, PROFESSION.CREW) === 3, "3 crew stay 3", String(sizeOf(teams, PROFESSION.CREW)));
  ok(teams.length === 1, "and no chief team appears");
}

console.log("\n[10] a chief is never given a chief");
{
  const teams = teamsOf({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 5, profession_hint: "crew chief" }] });
  ok(sizeOf(teams, PROFESSION.CREW_CHIEF) === 5, "5 chiefs requested stay 5", String(sizeOf(teams, PROFESSION.CREW_CHIEF)));
  ok(teams.length === 1, "and nothing is carved out of them");
}

console.log("\n[11] the warning states what was done to the count");
{
  const { warnings } = compose({ requests: [{ date: "2026-08-12", start_time: "08:00", end_time: "18:00", size: 12 }] });
  const w = warnings.find((x) => /chief/i.test(x)) ?? "(none)";
  ok(/12/.test(w) && /10/.test(w) && /2/.test(w), "says 12 -> 10 + 2", w);
  ok(/headcount unchanged/i.test(w), "and says the headcount did not move", w);
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
