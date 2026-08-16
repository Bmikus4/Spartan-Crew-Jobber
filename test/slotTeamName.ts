// ============================================================================
// A SlotTeam name over 80 characters is a 400 on the WHOLE order.
//
// OnSinch does not truncate; it refuses:
//   400 {"0":{"SlotTeam":{"0":{"name":["Name is too long, maximum is 80
//   characters."]}}}}
//
// Nothing capped it. `orderName` was capped at 80 in compiler.ts and the Job
// name at 100 in jobNameFrom, but the slot team name is built straight from the
// extracted `task` — which is a description of the work whenever the client
// wrote one out. So it overflowed on exactly the enquiries that described the
// job best. Live: three failed creates on thread 19fdc18aeb550d3b (2026-08-07),
// the only OnSinch error the engine has ever produced, and one of the 21 orders
// staged in production carried a 118-character name waiting to do it again.
//
// The two halves of the fix are both covered here, and the SECOND is the one
// that matters operationally: a staged order is written from JSON stored before
// the cap existed and is never re-composed, so capping in compose alone would
// have left every already-staged order still failing.
//
// Run: npx tsx test/slotTeamName.ts
// ============================================================================
import { composeOrder } from "../app/lib/engine/compose";
import { buildOrderBody, capSlotTeamName, SLOT_TEAM_NAME_MAX, DRAFT_POSTURE } from "../app/lib/engine/format";
import type { ConversationFacts, DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// The exact text off live thread 19ff0292d9c8a86c — 118 characters.
const LONG =
  "Rig: unloading vans, shunting cases, assist lighting tech putting out lights, hanging mirror balls, working at heights";

const facts = (task: string, date?: string): ConversationFacts => ({
  location_text: "ExCeL London",
  requests: [{ date, size: 4, task, start_time: "08:00", end_time: "18:00" }],
});

const compose = (f: ConversationFacts) =>
  composeOrder({
    facts: f,
    company_id: 1,
    user_id: 2257,
    place_id: 10,
    pricelist_category_id: 315,
    orderName: "Client @ ExCeL",
    jobName: "4 at ExCeL London on 2026-09-01",
  });

console.log(`\n[1] the live 118-char case, composed (${LONG.length} chars in)`);
{
  const { order, warnings } = compose(facts(LONG, "2026-09-01"));
  const team = order!.slot_teams[0];
  console.log(`      -> ${JSON.stringify(team.name)}  (${team.name.length} chars)`);
  ok(team.name.length <= SLOT_TEAM_NAME_MAX, "name within the limit", String(team.name.length));
  ok(team.description === LONG, "the full text is kept as the team's description");
  ok(LONG.startsWith(team.name), "the name is the head of what the client wrote, not a rewrite");
  ok(warnings.some((w) => /over 80 chars/.test(w)), "the shortening is said out loud", JSON.stringify(warnings.filter((w) => /80/.test(w))));
}

console.log("\n[2] a short name is untouched — no description invented");
{
  const { order } = compose(facts("Get-in crew", "2026-09-01"));
  const team = order!.slot_teams[0];
  ok(team.name === "Get-in crew", "name passes through", team.name);
  ok(team.description === undefined, "no description added", String(team.description));
}

console.log("\n[3] a long name with NO date keeps its (TBC) marker");
{
  // The failure jobNameFrom already had once: cap the finished string and the
  // load-bearing tail is what falls off. (TBC) is how the board shows that this
  // block has no confirmed date.
  const { order } = compose(facts(LONG, undefined));
  const team = order!.slot_teams[0];
  console.log(`      -> ${JSON.stringify(team.name)}  (${team.name.length} chars)`);
  ok(team.name.endsWith(" (TBC)"), "ENDS WITH (TBC)");
  ok(team.name.length <= SLOT_TEAM_NAME_MAX, "still within the limit", String(team.name.length));
  ok(team.description === LONG, "full text still preserved");
}

console.log("\n[4] the crew-chief add-on is never the one that overflows");
{
  const { order } = compose(facts(LONG, "2026-09-01"));
  const chief = order!.slot_teams.find((t) => t.name === "Crew Chief");
  ok(!!chief, "a chief was added for 4 crew");
  ok((chief?.name.length ?? 99) <= SLOT_TEAM_NAME_MAX, "chief name within the limit");
}

console.log("\n[5] THE ONE THAT MATTERS: a staged order composed before the cap");
{
  // What is actually sitting in conversation_state.pending_order in production.
  // It is written from stored JSON — compose never runs again — so the cap has to
  // hold at serialisation or these 400 on the first click of Confirm.
  const staged: DesiredOrder = {
    name: "Client @ ExCeL",
    company_id: 1,
    user_id: 2257,
    request_approval: true,
    ...DRAFT_POSTURE,
    pricelist_category_id: 315,
    job_name: "4 at ExCeL London on 2026-09-01",
    slot_teams: [
      {
        name: LONG, // uncapped, exactly as stored
        profession_id: 1,
        beginning: "2026-09-01T08:00:00+01:00",
        end: "2026-09-01T18:00:00+01:00",
        size: 4,
        place_id: 10,
      },
    ],
  };
  const body = buildOrderBody(staged)[0];
  console.log(`      -> ${JSON.stringify(body.SlotTeam[0].name)}  (${body.SlotTeam[0].name.length} chars)`);
  ok(body.SlotTeam[0].name.length <= SLOT_TEAM_NAME_MAX, "the body OnSinch receives is within the limit", String(body.SlotTeam[0].name.length));
  ok(body.SlotTeam[0].description === LONG, "the description carries the full text");
  ok(staged.slot_teams[0].name === LONG, "the stored DesiredOrder is not mutated");
}

console.log("\n[6] capSlotTeamName is idempotent and does not steal a real description");
{
  const once = capSlotTeamName({ name: LONG });
  const twice = capSlotTeamName(once);
  ok(once.name === twice.name && once.description === twice.description, "applying it twice changes nothing");

  // compose caps first and format caps again. If the second pass overwrote the
  // description it would replace the client's text with a shortened copy of it.
  const kept = capSlotTeamName({ name: LONG, description: "unload the artic first" });
  ok(kept.description === "unload the artic first", "an existing description survives", String(kept.description));
  ok(kept.name.length <= SLOT_TEAM_NAME_MAX, "name still capped alongside it");
}

console.log("\n[7] the boundary itself");
{
  const exact = "x".repeat(SLOT_TEAM_NAME_MAX);
  ok(capSlotTeamName({ name: exact }).name === exact, "exactly 80 is allowed through untouched");
  ok(capSlotTeamName({ name: exact }).description === undefined, "and gains no description");
  ok(capSlotTeamName({ name: exact + "y" }).name.length === SLOT_TEAM_NAME_MAX, "81 is cut to 80");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
