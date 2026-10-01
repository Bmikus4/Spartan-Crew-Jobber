// ============================================================================
// A crew or time change on an order ops raised does not move ops' venue.
// ----------------------------------------------------------------------------
// The venue used to ride along with every block patch. On a hand-raised order the
// thread's venue is the engine's reading of the client's address, and ops often chose a
// different record for the same building: order 16308 would have gone from ops' 1027 to
// the engine's fallback guess, 706 "100 Bishopsgate" for "8 Bishopsgate" (2026-09-30).
// Ben, 2026-10-01: send a venue only when the client's differs. The live venue is
// readable through the nested read's SlotLocation, so OnSinch is also not re-sent a venue
// it already holds.
//
// Offline.  npx tsx test/venueNotResent.ts
// ============================================================================
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { nestedShape } from "../app/lib/engine/reconcile";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const ORDER = 16308, JOB = 4308, TEAM = 41700, DAY = "2026-10-12";
const OPS_VENUE = 1027, GUESS = 706, MOVED = 900;

/** One hand-raised order with one block, at `livePlace`. Records every PATCH. */
function tenant(livePlace: number) {
  const patched: any[] = [];
  const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
  const client = new OnsinchClient(async (method, path, body) => {
    if (method === "PATCH" && path.startsWith("/slotTeams")) { patched.push(...(body as any[])); return { status: 204, data: null }; }
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/orders") && /SlotTeam/.test(decodeURIComponent(path))) {
      return page([{ id: ORDER, company_id: 207, Job: [{ id: JOB, SlotTeam: [{ id: TEAM, name: "crew cover", Slot: [
        { id: 1, size: 1, role: 0, cancelled: false, profession_id: 1, beginning: `${DAY}T12:30:00+00:00`, end: `${DAY}T16:30:00+00:00`, SlotLocation: { place_id: livePlace } },
      ] }] }] }]);
    }
    if (path.startsWith("/orders")) return page([{ id: ORDER, number: "10700", company_id: 207, happening: `${DAY}T12:30:00+00:00`, Job: [{ id: JOB }] }]);
    if (path.startsWith("/timelineAudits")) {
      return page([{ id: 1, action: "common_create", data: JSON.stringify({ model: "SlotTeam", id: String(TEAM), name: "crew cover", data: { path: `Order:${ORDER}\\/Job:${JOB}\\/SlotTeam:${TEAM}` } }) }]);
    }
    return page([]);
  });
  return { client, patched };
}

const team = (place: number, end = `${DAY}T18:30:00+01:00`): DesiredSlotTeam =>
  ({ name: "crew cover", size: 1, profession_id: 1, place_id: place, beginning: `${DAY}T13:30:00+01:00`, end }) as DesiredSlotTeam;
const order = (t: DesiredSlotTeam): DesiredOrder =>
  ({ company_id: 207, user_id: 7, place_id: t.place_id, pricelist_category_id: 315, slot_teams: [t] }) as unknown as DesiredOrder;
const hooks = { async onCreated() {} };
const placeOf = (p: any[]) => p.find((x) => x.id === TEAM)?.place_id;

async function main() {
  console.log("\n[1] the client changes the finish; the venue they named has not moved");
  {
    const tn = tenant(OPS_VENUE);
    const res = await amendOrderInPlace(tn.client, { order_id: ORDER, previous: [], desired: order(team(GUESS)), known: { place_id: GUESS } }, hooks);
    ok(!!res.amended, "the change landed", JSON.stringify(res));
    ok(tn.patched.some((p) => p.end) && placeOf(tn.patched) === undefined, "the new finish is sent and ops' venue is left alone", JSON.stringify(tn.patched));
  }

  console.log("\n[2] the client really moves the venue");
  {
    const tn = tenant(OPS_VENUE);
    await amendOrderInPlace(tn.client, { order_id: ORDER, previous: [], desired: order(team(MOVED)), known: { place_id: GUESS } }, hooks);
    ok(placeOf(tn.patched) === MOVED, "the new venue is sent", JSON.stringify(tn.patched));
  }

  console.log("\n[3] the client moves it to where OnSinch already has it");
  {
    const tn = tenant(MOVED);
    await amendOrderInPlace(tn.client, { order_id: ORDER, previous: [], desired: order(team(MOVED)), known: { place_id: GUESS } }, hooks);
    ok(placeOf(tn.patched) === undefined, "nothing is re-sent", JSON.stringify(tn.patched));
  }

  console.log("\n[4] no baseline (a sweep re-assert, a dashboard confirm): never a venue");
  {
    const tn = tenant(OPS_VENUE);
    await amendOrderInPlace(tn.client, { order_id: ORDER, previous: [], desired: order(team(GUESS)) }, hooks);
    ok(placeOf(tn.patched) === undefined, "ops' venue stands", JSON.stringify(tn.patched));
  }

  console.log("\n[5] the nested read carries each block's venue");
  {
    const shape = nestedShape({ id: 1, Job: [{ id: 2, SlotTeam: [{ id: 3, name: "x", Slot: [{ id: 4, size: 2, role: 0, profession_id: 1, beginning: `${DAY}T08:00:00+00:00`, end: `${DAY}T16:00:00+00:00`, slotlocation_id: 16610, SlotLocation: { place_id: 65 } }] }] }] });
    ok(shape.teams.get(3)?.place_id === 65 && shape.teams.get(3)?.slotlocation_id === 16610, "place 65, not the slotlocation id", JSON.stringify([...shape.teams.values()]));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
