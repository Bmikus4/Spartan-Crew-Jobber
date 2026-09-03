// ============================================================================
// THE CREATED VENUE IS THE ONE THE JOB IS BOOKED AT — and only the job that asked.
// ----------------------------------------------------------------------------
// Since 2026-09-03 a venue the tenant does not hold is created from the client's
// own words (test/venueCreatesOnUnresolved.ts). That decision is made in
// compile() and carried as `provision_place` with place_id 0 on the teams that
// need it; nothing is written until an executor runs. So the decision being right
// proves nothing on its own — this file follows it to the wire.
//
// TWO PATHS DO THIS AND THEY DISAGREED. createOrderWithPlace (the create path)
// stamped the new id onto EVERY slot team:
//
//     o.slot_teams = o.slot_teams.map((s) => ({ ...s, place_id: place.id }))
//
// while provisionPlaceIfNeeded (the amend path) filled only the blanks:
//
//     slot_teams.map((s) => (s.place_id ? s : { ...s, place_id: place.id }))
//
// On a single-venue job the two are identical, which is why it survived. On a job
// that moves crew between two buildings and holds only one of them, the create
// path relocated every team to the new row: "6 at ExCeL then 4 at the Glass House"
// booked ten people at the Glass House and nobody at ExCeL. Both venues were
// stated, both were extracted, both survived compile, and the crew went to one
// address.
//
// Run: npx tsx test/createdVenueReachesTheJob.ts
// ============================================================================
import { createOrderWithPlace } from "../app/lib/deps";
import { provisionPlaceIfNeeded } from "../app/lib/engine/provisionPlace";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NEW_PLACE_ID = 7001;

/** Records what reached OnSinch. Nothing here talks to the network. */
function spy() {
  const calls: Array<{ what: string; body: unknown }> = [];
  const client = {
    async createPlace(body: unknown) {
      calls.push({ what: "createPlace", body });
      return { id: NEW_PLACE_ID };
    },
    async createOrder(body: unknown) {
      calls.push({ what: "createOrder", body });
      return { id: 9001, number: "R9001" };
    },
    // Read back straight after the create; irrelevant here but it runs.
    async orderById() { return { id: 9001, number: "R9001", Job: [{ id: 8001 }] }; },
    async createCompany() {
      throw new Error("no company should be created here");
    },
  };
  return { client, calls };
}

/** The teams as they reached the wire. buildOrderBody nests them under Job/SlotTeam. */
const teamsPosted = (calls: Array<{ what: string; body: unknown }>) =>
  ((calls.find((c) => c.what === "createOrder")?.body as Array<{ SlotTeam?: Array<{ size: number; place_id: number }> }>)?.[0]?.SlotTeam) ?? [];

const team = (size: number, place_id: number, beginning: string) => ({
  size,
  place_id,
  profession_id: 1,
  name: "Crew",
  beginning,
  end: `${beginning.slice(0, 10)}T18:00:00`,
});

/** Two buildings: one the tenant holds (#49), one it does not (place_id 0). */
const twoVenueOrder = (): DesiredOrder => ({
  name: "o",
  company_id: 1,
  user_id: 2,
  pricelist_category_id: 342,
  job_name: "j",
  slot_teams: [
    team(6, 49, "2026-03-09T08:00:00"),
    team(4, 0, "2026-03-09T13:00:00"),
  ],
  provision_place: { name: "The Glass House", country: "GB" },
}) as DesiredOrder;

async function main() {
  console.log("\n[1] CREATE PATH — the new row fills the blank and nothing else");
  {
    const { client, calls } = spy();
    await createOrderWithPlace(client as never, twoVenueOrder());

    const made = calls.find((c) => c.what === "createPlace");
    ok(!!made, "the venue is created before the order is posted");
    ok((made?.body as { name?: string })?.name === "The Glass House",
       "created under the client's own words", JSON.stringify(made?.body));

    const posted = teamsPosted(calls);
    ok(!!posted?.length, "an order is posted after it");
    const held = posted.find((t) => t.size === 6);
    const created = posted.find((t) => t.size === 4);
    ok(created?.place_id === NEW_PLACE_ID, "the block that had no venue gets the created one", String(created?.place_id));
    // The assertion this file was written for.
    ok(held?.place_id === 49, "the block that already had one KEEPS it", String(held?.place_id));
    ok(posted.every((t) => t.place_id > 0), "and no zero reaches the wire");
  }

  console.log("\n[2] AMEND PATH — same rule, and it always had it");
  {
    const { client } = spy();
    const { desired, created } = await provisionPlaceIfNeeded(client as never, twoVenueOrder());
    ok(created === NEW_PLACE_ID, "the venue is created", String(created));
    ok(desired.slot_teams.find((t) => t.size === 6)?.place_id === 49, "the held venue survives",
       String(desired.slot_teams.find((t) => t.size === 6)?.place_id));
    ok(desired.slot_teams.find((t) => t.size === 4)?.place_id === NEW_PLACE_ID, "the blank is filled",
       String(desired.slot_teams.find((t) => t.size === 4)?.place_id));
  }

  console.log("\n[3] the single-venue job — the shape that hid the bug for a fortnight");
  {
    const { client, calls } = spy();
    const one = twoVenueOrder();
    one.slot_teams = [team(6, 0, "2026-03-09T08:00:00"), team(4, 0, "2026-03-09T13:00:00")];
    await createOrderWithPlace(client as never, one);
    const posted = teamsPosted(calls);
    ok(posted.every((t) => t.place_id === NEW_PLACE_ID),
       "every team lands on the one created venue", JSON.stringify(posted.map((t) => t.place_id)));
  }

  console.log("\n[4] nothing is created when the tenant already holds every venue");
  {
    const { client, calls } = spy();
    const held = twoVenueOrder();
    held.slot_teams = [team(6, 49, "2026-03-09T08:00:00"), team(4, 57, "2026-03-09T13:00:00")];
    delete (held as { provision_place?: unknown }).provision_place;
    await createOrderWithPlace(client as never, held);
    ok(!calls.some((c) => c.what === "createPlace"), "no venue is created");
    const posted = teamsPosted(calls);
    ok(posted.map((t) => t.place_id).join(",") === "49,57", "both venues are kept as they were",
       JSON.stringify(posted.map((t) => t.place_id)));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main();
