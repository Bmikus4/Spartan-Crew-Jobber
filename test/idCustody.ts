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
  console.log("two-phase create");
  {
    const calls: any[] = [];
    let nextTeam = 700;
    const tr: Transport = async (method, path, b) => {
      calls.push({ method, path, body: b });
      if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9001 }] } };
      if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: ++nextTeam }] } };
      if (method === "GET" && path.startsWith("/orders"))
        return { status: 200, data: { data: [{ id: 9001, number: "R1", Job: [{ id: 4001 }] }] } };
      return { status: 200, data: null };
    };
    const res = await createOrderWithPlace(new OnsinchClient(tr), order);
    ok(res.id === 9001, "returns the order id", String(res.id));
    ok(res.job_id === 4001, "and the job id", String(res.job_id));
    ok(JSON.stringify(res.team_ids) === "[701,702]", "and one id per block, in order",
       JSON.stringify(res.team_ids));

    const orderPost = calls.find((c) => c.method === "POST" && c.path === "/orders");
    ok(Array.isArray(orderPost.body[0].SlotTeam) && orderPost.body[0].SlotTeam.length === 0,
       "the order was created with NO nested blocks");
    ok(calls.filter((c) => c.method === "POST" && c.path === "/slotTeams").length === 2,
       "and each block was posted separately");
  }

  console.log("");
  console.log("a half-built order is rolled back, not returned");
  {
    const calls: any[] = [];
    const tr: Transport = async (method, path) => {
      calls.push({ method, path });
      if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9002 }] } };
      if (method === "GET" && path.startsWith("/orders"))
        return { status: 200, data: { data: [{ id: 9002, number: "R2", Job: [{ id: 4002 }] }] } };
      // First block lands, second fails.
      if (method === "POST" && path === "/slotTeams") {
        const n = calls.filter((c) => c.path === "/slotTeams").length;
        if (n === 1) return { status: 201, data: { data: [{ id: 801 }] } };
        return { status: 400, data: { validationErrors: { size: ["nope"] } } };
      }
      if (method === "DELETE" && path === "/orders") return { status: 204, data: null };
      return { status: 200, data: null };
    };
    let err = "";
    try { await createOrderWithPlace(new OnsinchClient(tr), order); }
    catch (e: any) { err = String(e?.message ?? e); }
    ok(/could not be given its crew blocks/i.test(err), "it throws rather than returning a partial order", err);
    ok(calls.some((c) => c.method === "DELETE" && c.path === "/orders"),
       "and the blockless order was deleted");
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
