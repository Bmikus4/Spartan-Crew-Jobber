// ============================================================================
// A new venue is created before anything is written against it — and, on the rebuild
// path, before anything is DELETED.
// ----------------------------------------------------------------------------
// A composed order whose venue the tenant does not hold carries `place_id: 0` and a
// `provision_place`. Only `createOrderWithPlace` ever acted on that. The in-place
// amendment and the delete-and-repost rebuild both wrote directly, so the zero reached
// the wire and OnSinch answered `400 {"place_id":["Fill in correct location"]}`.
//
// MEASURED IN THE 50-CASE MODEL-IN-THE-LOOP RUN, 2026-08-26:
//
//   R001  amendment  createSlotTeam 400 — the client's change simply never landed
//   R045  rebuild    "URGENT: draft order #15494 was DELETED and its replacement
//                     failed to post (createOrder 400 ...)"
//
// The second is why this file exists. The rebuild deletes first and posts second, so a
// replacement that cannot be built leaves NO booking at all — the exact failure every
// other guard in replaceOrder.ts is written to prevent, reached through a field nobody
// had counted as a precondition.
//
// Not a rare shape either: a venue the tenant does not hold is provisioned on roughly a
// quarter of enquiries, and it got MORE reachable the same day a client who moves the
// venue stopped being ignored — a re-resolved venue can land on "ambiguous, create a row
// rather than guess", which is this state, on an amendment.
//
// Run: npx tsx test/provisionOnAmend.ts
// ============================================================================
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const ORDER = 13632, JOB = 7001, NEW_PLACE = 6900;

/** An order whose venue does not exist yet: place_id 0 plus something to create. */
const desired = (withProvision = true): DesiredOrder => ({
  name: "Client @ a venue the tenant has never heard of",
  company_id: 501, user_id: 9001, request_approval: true,
  pricelist_category_id: 315,
  job_name: "4 at Somewhere on 2027-09-12",
  slot_teams: [{
    name: "Crew", profession_id: 1,
    beginning: "2027-09-12T09:00:00+00:00", end: "2027-09-12T17:00:00+00:00",
    size: 4, place_id: 0,
  }],
  ...(withProvision ? { provision_place: { name: "Thornbury Assembly Rooms", country: "GB", address: "14 Kestrel Way" } } : {}),
});

function fake(opts: { attendance?: number } = {}) {
  const calls: string[] = [];
  const client = new OnsinchClient((async (method: string, path: string, body: unknown) => {
    calls.push(`${method} ${path}`);
    if (method === "GET" && path.startsWith("/orders")) {
      return { status: 200, data: { data: [{ id: ORDER, provisional: false, quote: false, company_id: 501, Job: [{ id: JOB }] }], pagination: { count: 1, pageCount: 1 } } };
    }
    if (method === "GET" && path.startsWith("/attendance")) {
      return { status: 200, data: { data: [], pagination: { count: opts.attendance ?? 0, pageCount: 1 } } };
    }
    if (method === "POST" && path === "/places") return { status: 201, data: { data: [{ id: NEW_PLACE }] } };
    if (method === "POST" && path === "/orders") {
      // OnSinch's real behaviour: a zero place_id is rejected outright.
      const team = (body as Array<{ SlotTeam?: Array<{ place_id?: number }> }>)?.[0]?.SlotTeam?.[0];
      if (!team?.place_id) return { status: 400, data: { validationErrors: { 0: { SlotTeam: { 0: { place_id: ["Fill in correct location"] } } } } } };
      return { status: 201, data: { data: [{ id: 14001, number: "10999" }] } };
    }
    if (method === "POST" && path === "/slotTeams") {
      const t = (body as Array<{ place_id?: number }>)?.[0];
      if (!t?.place_id) return { status: 400, data: { validationErrors: { 0: { place_id: ["Fill in correct location"] } } } };
      return { status: 201, data: { data: [{ id: 900 }] } };
    }
    return { status: 200, data: { data: [], pagination: { count: 0, pageCount: 1 } } };
  }) as never);
  return { client, calls };
}

const hooks = { async onIntent() {}, async onDeleted() {} };

(async () => {
  console.log("\n[1] the rebuild creates the venue BEFORE it deletes anything");
  {
    const { client, calls } = fake();
    const r = await replaceProvisionalOrder(client, { order_id: ORDER, desired: desired(), weCreatedIt: true }, hooks);
    ok(!r.refused && !!r.created, "the rebuild succeeds instead of 400ing", r.refused ?? String(r.created?.id));
    const placeAt = calls.indexOf("POST /places");
    const deleteAt = calls.findIndex((c) => c.startsWith("DELETE"));
    ok(placeAt >= 0, "the place was created", calls.join(" -> "));
    ok(placeAt < deleteAt, "and it happened BEFORE the delete — everything that can fail, fails first",
      calls.join(" -> "));
  }

  console.log("\n[2] a rebuild that cannot name a venue REFUSES rather than deleting");
  {
    // No place_id and nothing to create. The old code deleted, then discovered this.
    const { client, calls } = fake();
    const r = await replaceProvisionalOrder(client, { order_id: ORDER, desired: desired(false), weCreatedIt: true }, hooks);
    ok(!!r.refused, "refused", r.refused ?? "(NOT REFUSED)");
    ok(!calls.some((c) => c.startsWith("DELETE")), "and nothing was deleted", calls.join(" -> "));
    ok(r.deleted === false, "the caller is told the order still stands");
  }

  console.log("\n[3] the in-place amendment provisions too, so an appended block lands");
  {
    const { client, calls } = fake();
    const two = desired();
    two.slot_teams = [
      { ...two.slot_teams[0] },
      { ...two.slot_teams[0], name: "Derig", beginning: "2027-09-12T18:00:00+00:00", end: "2027-09-12T22:00:00+00:00", size: 2 },
    ];
    const r = await amendOrderInPlace(
      client,
      { order_id: ORDER, previous: [desired().slot_teams[0]], desired: two, known: { job_id: JOB, team_ids: [501] } },
      { async onCreated() {} }
    );
    ok(!r.refused && !r.declined, "the amendment is applied rather than 400ing", r.refused ?? r.declined ?? "applied");
    ok(calls.includes("POST /places"), "the venue was created first", calls.join(" -> "));
  }

  console.log("\n[4] an order whose venue already exists creates no second row");
  {
    const { client, calls } = fake();
    const known = desired();
    known.slot_teams = known.slot_teams.map((s) => ({ ...s, place_id: 49 }));
    const r = await replaceProvisionalOrder(client, { order_id: ORDER, desired: known, weCreatedIt: true }, hooks);
    ok(!r.refused, "it rebuilds", r.refused ?? "ok");
    ok(!calls.includes("POST /places"), "and provisions nothing — the condition is a MISSING place_id, not the presence of provision_place",
      calls.join(" -> "));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
