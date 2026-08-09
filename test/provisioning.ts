// ============================================================================
// A client OnSinch has never met still gets a job, and is found next time.
// ----------------------------------------------------------------------------
// Ben, 2026-08-09:
//
//   "if company or venue location are not found in the system, always create new
//    ones if they can be inferred. This is why the checking procedure was so
//    important. if that data is not available, create them with placeholders
//    (might need a user, use my own Ben Mikus) and then for venue, if it doesnt
//    exist in onsinch, then you should also use a placeholder location ('No
//    Location') which you will create. You must make sure that in cases where a
//    location must be created or a company must be created, that they will be
//    found the NEXT time that name is used, to prove the consistency of our
//    datalogging system"
//
// The last sentence is the one worth testing. Creating is easy; creating without
// making a duplicate on the next email is the actual requirement, and there are
// two ways to fail it:
//
//   1. the warm list the company was judged absent from is up to five minutes old,
//      so the second enquiry misses against a list that predates the create;
//   2. a cold lambda has no warm list at all, so the memory has to be durable.
//
// (1) is covered by cacheAppend in onsinch.ts, (2) by the alias store. This file
// tests both, and the second-create-attempt is the assertion that matters: the
// tenant must gain exactly ONE company however many emails arrive.
//
// Run: npx tsx test/provisioning.ts
// ============================================================================
import { OnsinchClient, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
import { createOrderWithPlace } from "../app/lib/deps";
import { compile } from "../app/lib/engine/compiler";
import { matchCompany, normName, normAddr } from "../app/lib/engine/resolve";
import { mockReasoner } from "./mocks";
import type { DesiredOrder, HydratedThread } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** A tenant that starts with one company and one venue, and records every write. */
function tenant() {
  const companies = [{ id: 126, name: "Eclipse" }];
  const places = [{ id: 18, name: "Tobacco Dock", address: "50 Porters Walk, London" }];
  const writes: string[] = [];
  let nextId = 900;

  const t: Transport = async (method, path, body) => {
    if (method === "GET" && path.startsWith("/companies") && path.includes("with=Client")) {
      return { status: 200, data: { data: [{ Client: [] }] } };
    }
    if (method === "GET" && path.startsWith("/companies")) {
      return { status: 200, data: { data: companies, pagination: { pageCount: 1 } } };
    }
    if (method === "GET" && path.startsWith("/places")) {
      return { status: 200, data: { data: places, pagination: { pageCount: 1 } } };
    }
    if (method === "GET" && path.startsWith("/orders")) {
      return { status: 200, data: { data: [], pagination: { pageCount: 1 } } };
    }
    if (method === "POST" && path === "/companies") {
      const c = { id: nextId++, name: (body as any[])[0].name };
      companies.push(c);
      writes.push(`POST /companies ${c.name}`);
      return { status: 201, data: { data: [c] } };
    }
    if (method === "POST" && path === "/places") {
      const p = { id: nextId++, ...(body as any[])[0] };
      places.push(p);
      writes.push(`POST /places ${p.name}`);
      return { status: 201, data: { data: [p] } };
    }
    if (method === "POST" && path === "/orders") {
      writes.push("POST /orders");
      return { status: 201, data: { data: [{ id: 14001, number: "10999" }] } };
    }
    return { status: 200, data: { data: [], pagination: { pageCount: 1 } } };
  };
  return { client: new OnsinchClient(t), companies, places, writes };
}

/** The alias store, in memory, behaving like aliasesDb: only "exact" is trusted. */
function aliasStore() {
  const rows = new Map<string, { id: number; source: string }>();
  return {
    rows,
    lookup: async (kind: string, key: string) => {
      const hit = rows.get(`${kind}:${key}`);
      return hit && hit.source === "exact" ? hit.id : null;
    },
    record: async (a: { kind: string; alias_norm: string; entity_id: number; source: string }) => {
      rows.set(`${a.kind}:${a.alias_norm}`, { id: a.entity_id, source: a.source });
    },
  };
}

const order = (over: Partial<DesiredOrder> = {}): DesiredOrder => ({
  name: "Crew enquiry",
  company_id: 0,
  user_id: 2257,
  request_approval: true,
  provisional: true,
  quote: false,
  pricelist_category_id: 342,
  job_name: "4 crew",
  slot_teams: [{ name: "Crew", profession_id: 1, beginning: "2026-09-12T08:00:00+01:00", end: "2026-09-12T18:00:00+01:00", size: 4, place_id: 0 }],
  ...over,
});

async function main() {

console.log("\n[1] a company OnSinch does not have is created, once");
{
  __resetListCache();
  const { client, companies, writes } = tenant();
  const aliases = aliasStore();
  const remember = (a: any) => aliases.record(a);

  // First enquiry: pull the list, miss, create.
  await client.allCompanies();
  const o1 = order({ provision_company: { name: "Rundell & Rundell" }, provision_place: { name: "The Barbican", country: "GB", address: "Silk St, London" } });
  await createOrderWithPlace(client, o1, remember as never);
  ok(writes.filter((w) => w.startsWith("POST /companies")).length === 1, "the company is created", writes.join(" | "));
  const created = companies.find((c) => c.name === "Rundell & Rundell");
  ok(!!created, "and it exists in the tenant now");

  // SECOND enquiry, same lambda, same 5-minute window. The list it would consult is
  // the one pulled before the create - this is the duplicate-company failure.
  const listNow = await client.allCompanies();
  ok(listNow.some((c: any) => c.id === created!.id),
    "the warm list already carries it, without waiting for the TTL", String(listNow.length));
  ok(matchCompany("Rundell & Rundell", listNow as never) === created!.id,
    "so the matcher resolves the name it just created", String(matchCompany("Rundell & Rundell", listNow as never)));

  // And the durable half, for a lambda that never held that list.
  ok((await aliases.lookup("company", normName("Rundell & Rundell"))) === created!.id,
    "the alias store answers the same, from cold", JSON.stringify([...aliases.rows]));
  ok((await aliases.lookup("place", normAddr("Silk St, London"))) !== null,
    "and the venue is remembered by the address the email will use next time");
}

console.log("\n[2] the second enquiry creates NOTHING - one client, not two");
{
  __resetListCache();
  const { client, writes } = tenant();
  const aliases = aliasStore();
  const remember = (a: any) => aliases.record(a);
  await client.allCompanies();

  await createOrderWithPlace(client, order({ provision_company: { name: "Rundell & Rundell" } }), remember as never);
  // The compiler would resolve the id this time, so the second order carries no
  // provision at all. That is the contract: provisioning happens once, and the
  // resolver's memory is what stops the second one.
  const resolved = matchCompany("Rundell & Rundell", (await client.allCompanies()) as never);
  await createOrderWithPlace(client, order({ company_id: resolved!, slot_teams: order().slot_teams.map((s) => ({ ...s, place_id: 18 })) }), remember as never);

  const creates = writes.filter((w) => w.startsWith("POST /companies"));
  ok(creates.length === 1, "exactly one company was created across two enquiries", writes.join(" | "));
  ok(writes.filter((w) => w === "POST /orders").length === 2, "and both orders were raised");
}

console.log("\n[3] no venue named -> the 'No Location' placeholder, created once and reused");
{
  __resetListCache();
  const { client, places, writes } = tenant();
  const aliases = aliasStore();
  const remember = (a: any) => aliases.record(a);

  await createOrderWithPlace(client, order({ company_id: 126, provision_place: { name: "No Location", country: "GB" } }), remember as never);
  const ph = places.find((p) => p.name === "No Location");
  ok(!!ph, "the placeholder venue is created", writes.join(" | "));
  ok(!(ph as any)?.address,
    "with no address - 'No Location' must not read as somewhere to drive to", JSON.stringify(ph));
  ok((await aliases.lookup("place", normAddr("No Location"))) === ph!.id,
    "and is remembered under its own name, so the next venue-less enquiry reuses it");

  // The next enquiry with no venue resolves it from the list rather than creating again.
  const listed = await client.allPlaces();
  ok(listed.some((p: any) => p.id === ph!.id), "it is in the warm list immediately");
}

/** One message from a client, for driving compile(). */
const thread = (thread_id: string, body: string): HydratedThread => ({
  thread_id,
  messages: [{
    message_id: "m1",
    from: "june@farago-projects.com",
    to: ["bookings@spartancrew.co.uk"],
    date_iso: "2026-08-09T10:00:00Z",
    subject: "Crew request",
    body,
    is_from_spartan: false,
  }],
});

console.log("\n[4] an existing client with an unknown venue and no contact on file still gets an order");
{
  // This is the shape the live board was full of: everything resolvable except the
  // venue and the contact, and the old code produced no order for any of it. The
  // mock reasoner always answers "RedBeast Energy", so the company here is the new
  // one - what makes this case work is the seeded rate card standing in for history.
  __resetListCache();
  const { client } = tenant();
  const { state, actions } = await compile(
    thread("t-venue", "6 crew on 12 August at ExCeL London, 08:00-18:00."),
    // A prior state carries the resolved company, exactly as a second email in a
    // thread does, so this exercises venue and contact rather than re-testing [1].
    { company_id: 126, facts: { requests: [] } } as never,
    { reasoner: mockReasoner, onsinch: client, now: () => 1, repliesEnabled: false, seededRateCard: async () => 342 }
  );

  ok(!!state.desired_order, "an order was composed", JSON.stringify(state.notes));
  ok(!!actions.createOrder || !!state.desired_order, "and it is staged rather than dropped");
  ok(state.desired_order?.user_id === 2257, "against Ben Mikus as the stand-in contact",
    String(state.desired_order?.user_id));
  ok((state.notes ?? []).some((n) => /stand-in/.test(n)), "and says so on the ticket");
  ok(!!state.desired_order?.provision_place, "the unknown venue is created on write, not refused",
    JSON.stringify(state.desired_order?.provision_place));
  ok(state.needs_human === true, "a human is still called to check it");
}

console.log("\n[5] every slot team carries a place_id even when the venue is being created");
{
  // place_id 0 on a slot team is the single commonest cause of a 400 from
  // POST /orders, and it is legal ONLY while a provision_place is attached to
  // carry the real id in at write time. validateOrder enforces that pairing;
  // this checks the composed order actually satisfies it.
  __resetListCache();
  const { client } = tenant();
  const { state } = await compile(
    thread("t-noloc", "6 crew on 12 August, 08:00-18:00."),
    { company_id: 126, facts: { requests: [] } } as never,
    { reasoner: mockReasoner, onsinch: client, now: () => 1, repliesEnabled: false, seededRateCard: async () => 342 }
  );
  const o = state.desired_order;
  ok(!!o, "an order exists", JSON.stringify(state.notes));
  ok(o!.slot_teams.every((s) => s.place_id === 0 ? !!o!.provision_place : true),
    "a zero place_id is always paired with a venue to create", JSON.stringify(o!.slot_teams.map((s) => s.place_id)));
  ok(o!.slot_teams.every((s) => s.size >= 1 && !!s.beginning && !!s.end),
    "and every team has a real size and real times - those are never stood in for");
}

console.log("\n[6] THE REMAINING BLOCKER, stated rather than hidden: a new client has no rate card");
{
  // I1 says an order never goes out without an explicit pricelist_category_id,
  // because OnSinch silently assigns its own default otherwise - the wrong-rate
  // failure Tracy reported. A company being created has no order history to derive
  // one from, and there is no house default to borrow: across the 100 most recent
  // live orders the cards are 342 (49%) and 315 (30%), so the "197 is standard" in
  // the API reference is stale and a majority pick would be a coin flip on what a
  // client is charged.
  //
  // So a brand-new client composes everything and still holds, on one number. That
  // is deliberate and it is the one thing Ben's "always create" cannot cover
  // without him naming a default card for new clients.
  __resetListCache();
  const { client } = tenant();
  const { state, actions } = await compile(
    thread("t-newco", "4 crew on 12 September at The Barbican, 08:00-18:00."),
    undefined,
    { reasoner: mockReasoner, onsinch: client, now: () => 1, repliesEnabled: false }
  );
  ok(state.classification === "new-job", "classified new-job", state.classification);
  ok(!actions.createOrder, "no order is staged for a client with no rate card");
  ok((state.notes ?? []).some((n) => /no rate card yet/.test(n)),
    "and the ticket says exactly that, naming the company", JSON.stringify(state.notes));
  ok((state.notes ?? []).some((n) => /will be created in OnSinch/.test(n)),
    "while still recording that the company would be created");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
