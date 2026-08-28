// ============================================================================
// The ids the engine created must survive the compile seam.
// ----------------------------------------------------------------------------
// last_ordered_teams was correct and unreachable for weeks because compile()
// built its next state without carrying it, so every second email saw undefined.
// This field has the same failure mode and the same consequence — an amendment
// that silently cannot address the blocks it owns — so the seam is pinned before
// anything writes to it.
//
// Run: npx tsx test/idCustody.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOrderBody, buildSlotTeamBody } from "../app/lib/engine/format";
import type { DesiredOrder } from "../app/lib/engine/types";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { createOrderWithPlace } from "../app/lib/deps";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = readFileSync(join(ROOT, "app/lib/engine/compiler.ts"), "utf8");
const types = readFileSync(join(ROOT, "app/lib/engine/types.ts"), "utf8");

async function main() {
  console.log("the compile seam");
  ok(/last_ordered_team_ids\?\: number\[\]/.test(types), "ConversationState declares last_ordered_team_ids");
  ok(
    /last_ordered_team_ids:\s*prior\?\.last_ordered_team_ids/.test(compiler),
    "compile() carries last_ordered_team_ids forward from prior state"
  );

  const shell: DesiredOrder = {
    name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true,
    pricelist_category_id: 122,
    job_name: "X @ Y", slot_teams: [],
  };

  console.log("\nthe blockless order body");
  const body = buildOrderBody(shell)[0] as any;
  // OMITTING the key is a 400 ("Please fill the SlotTeam for this Order"); an EMPTY
  // ARRAY is a 201. The difference is the whole two-phase create, so it is pinned.
  ok("SlotTeam" in body, "SlotTeam is present as a key");
  ok(Array.isArray(body.SlotTeam) && body.SlotTeam.length === 0, "and it is an empty array",
     JSON.stringify(body.SlotTeam));
  ok(body.Job && body.Job.pricelist_category_id === 122, "the Job and its rate card still ride along");

  console.log("\nid comes back from the create");
  const posted: any[] = [];
  const t: Transport = async (method, path, b) => {
    posted.push({ method, path, body: b });
    if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: 35592 }] } };
    return { status: 200, data: null };
  };
  const c = new OnsinchClient(t);
  const made = await c.createSlotTeam(buildSlotTeamBody(14111, {
    name: "build", profession_id: 1, size: 3, place_id: 49,
    beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T14:00:00+00:00",
  }));
  ok(made.id === 35592, "createSlotTeam returns the new block's id", String(made.id));
  ok(posted[0].body[0].job_id === 14111, "and it was posted against the job we named");

  // A create that returns no id must throw rather than hand back a hole: an amendment
  // storing undefined would later patch nothing and report success.
  let threw = "";
  try {
    await new OnsinchClient(async () => ({ status: 201, data: { data: [{}] } }))
      .createSlotTeam(buildSlotTeamBody(1, { name: "x", profession_id: 1, size: 1, place_id: 1,
        beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T09:00:00+00:00" }));
  } catch (e: any) { threw = String(e?.message ?? e); }
  ok(/no id/i.test(threw), "a 201 with no id throws", threw);

  const order: DesiredOrder = {
    name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true,
    pricelist_category_id: 122, job_name: "X @ Y",
    slot_teams: [
      { name: "build", profession_id: 1, size: 3, place_id: 49,
        beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T14:00:00+00:00" },
      { name: "derig", profession_id: 1, size: 2, place_id: 49,
        beginning: "2027-11-10T18:00:00+00:00", end: "2027-11-10T22:00:00+00:00" },
    ],
  };

  console.log("");
  console.log("the create carries the crew");
  {
    /**
     * THE CREATE POSTS THE SHAPE THE API DOCUMENTS: `Job` with at least one `SlotTeam`.
     *
     * This section used to assert the opposite — that the order went out with NO nested
     * blocks and each block was posted separately — because `POST /slotTeams` returning
     * an id is the only way to hold one (§12), and holding them is what lets an
     * amendment patch a block instead of rebuilding the order.
     *
     * It bought those ids with the order itself. `SlotTeam: []` is accepted, so it
     * looked like a valid create and every check here passed, but OnSinch files an order
     * into ORDERS TO CONFIRM from the crew it was CREATED with, and never revisits it.
     * Blockless at creation means filed nowhere, permanently — appending the blocks a
     * second later does not move it. For five days the engine wrote nine correct orders
     * a day into a place nobody looks while ops re-keyed the same jobs by hand.
     *
     * Measured on three orders identical in every readable field: 15603, created with
     * its crew nested, was in To Confirm; 15602 and 15604, built the old way, were not.
     */
    const calls: any[] = [];
    const tr: Transport = async (method, path, b) => {
      calls.push({ method, path, body: b });
      if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9001 }] } };
      if (method === "GET" && path.startsWith("/orders"))
        return { status: 200, data: { data: [{ id: 9001, number: "R1", Job: [{ id: 4001 }] }] } };
      return { status: 200, data: null };
    };
    const res = await createOrderWithPlace(new OnsinchClient(tr), order);
    ok(res.id === 9001, "returns the order id", String(res.id));
    ok(res.job_id === 4001, "and the job id", String(res.job_id));

    const orderPost = calls.find((c) => c.method === "POST" && c.path === "/orders");
    const nested = orderPost.body[0].SlotTeam;
    ok(Array.isArray(nested) && nested.length === 2,
       "the order is created WITH its crew blocks — an empty array is filed nowhere",
       String(nested?.length));
    ok(nested[0].size === 3 && nested[1].size === 2, "both blocks, in order");
    ok(calls.filter((c) => c.method === "POST" && c.path === "/slotTeams").length === 0,
       "and nothing is appended afterwards");
  }

  console.log("");
  console.log("the block ids are gone, and that is the known price");
  {
    /**
     * Not a regression to fix later — the ids are unobtainable for a nested create and
     * both routes to them were probed shut on 2026-08-28: `POST /orders` answers
     * `{"data":[{"id":N}]}` with no child ids, and every `with=SlotTeam` spelling is a
     * 400. The audit log carries them only for UI-raised orders (§12).
     *
     * So the amendment must DEGRADE rather than lie. `amendInPlace` declines with "no
     * slot team ids could be read back" and the pipeline falls through to the rebuild.
     * The visible cost is a new R number on a crew change, which ops quote to clients.
     */
    const calls: any[] = [];
    const tr: Transport = async (method, path) => {
      calls.push({ method, path });
      if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9003 }] } };
      if (method === "GET" && path.startsWith("/orders"))
        return { status: 200, data: { data: [{ id: 9003, number: "R3", Job: [{ id: 4003 }] }] } };
      return { status: 200, data: null };
    };
    const res = await createOrderWithPlace(new OnsinchClient(tr), order);
    ok(Array.isArray(res.team_ids) && res.team_ids.length === 0,
       "no block ids are claimed — an invented one would patch the wrong block",
       JSON.stringify(res.team_ids));
  }

  console.log("");
  console.log("the pipeline keeps the ids, and keeps them after an amendment appends one");
  {
    const src = readFileSync(join(ROOT, "app/lib/engine/pipeline.ts"), "utf8");
    ok(/next\.last_ordered_team_ids\s*=\s*created\.team_ids/.test(src),
       "the create branch stores the ids the create returned");
    ok(/known:\s*\{[^}]*team_ids:\s*next\.last_ordered_team_ids/s.test(src),
       "tryAmendInPlace passes the stored ids to amendOrderInPlace");
    // An appended block's id must join the record, or the NEXT amendment loses custody of
    // it and silently falls back to the audit read, which is empty.
    ok(/last_ordered_team_ids\s*=\s*\[[\s\S]*?res\.amended\.added/.test(src),
       "and an appended block's id is added to the record");

    // The production executor is the seam this all runs through. Dropping `known` there
    // leaves every test above passing and the live path taking the audit read, which is
    // empty for every order the engine raises.
    const deps = readFileSync(join(ROOT, "app/lib/deps.ts"), "utf8");
    ok(/known:\s*p\.known/.test(deps), "the production executor forwards the stored ids");
  }
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
