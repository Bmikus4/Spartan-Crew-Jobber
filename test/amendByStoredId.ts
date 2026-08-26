// ============================================================================
// An amendment addresses the blocks the engine created, by id.
// ----------------------------------------------------------------------------
// amendOrderInPlace read the live blocks from /timelineAudits. That read returns
// NOTHING for an order created through the API (reference §12), so the amendment
// declined on every order the engine has made. With the ids stored at create
// time it does not need the read at all.
//
// The second case is the one that matters longest: a human adds a block in the
// OnSinch UI. Position-pairing shifts and overwrites the wrong block on a 201.
// Owning ids means the engine patches only what it created and cannot touch the
// human's block.
//
// Run: npx tsx test/amendByStoredId.ts
// ============================================================================
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "build", profession_id: 1, size: 3, place_id: 49,
  beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T14:00:00+00:00", ...o,
});
const desiredOf = (teams: DesiredSlotTeam[]): DesiredOrder => ({
  name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true,
  pricelist_category_id: 122, job_name: "X @ Y",
  slot_teams: teams,
});
const hooks = { onCreated: async () => {} };  // the real AmendHooks member

/** A transport where the AUDIT READ IS EMPTY, as it is for every engine order. */
function transport(sink: any[]): Transport {
  return async (method, path, body) => {
    sink.push({ method, path, body });
    if (method === "GET" && path.startsWith("/timelineAudits")) return { status: 200, data: { data: [] } };
    if (method === "GET" && path.startsWith("/orders"))
      return { status: 200, data: { data: [{ id: 9001, company_id: 515, provisional: true, Job: [{ id: 4001 }] }] } };
    if (method === "GET" && path.startsWith("/attendance")) return { status: 200, data: { data: [] } };
    if (method === "PATCH" && path === "/slotTeams") return { status: 204, data: null };
    if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: 999 }] } };
    return { status: 200, data: null };
  };
}

async function main() {
  console.log("stored ids make an engine order amendable at all");
  {
    const calls: any[] = [];
    const res = await amendOrderInPlace(
      new OnsinchClient(transport(calls)),
      {
        order_id: 9001,
        previous: [team(), team({ name: "derig", size: 2, beginning: "2027-11-10T18:00:00+00:00", end: "2027-11-10T22:00:00+00:00" })],
        desired: desiredOf([team({ size: 5 }), team({ name: "derig", size: 2, beginning: "2027-11-10T18:00:00+00:00", end: "2027-11-10T22:00:00+00:00" })]),
        known: { job_id: 4001, team_ids: [701, 702] },
      },
      hooks
    );
    ok(!res.declined, "it does not decline despite an empty audit read", res.declined ?? "");
    ok(res.amended?.patched === 1, "one block was patched", JSON.stringify(res.amended));
    const patch = calls.find((c) => c.method === "PATCH" && c.path === "/slotTeams");
    ok(patch?.body?.[0]?.id === 701, "and it targeted the STORED id", JSON.stringify(patch?.body));
    ok(patch?.body?.[0]?.size === 5, "with the new size");
    ok(!calls.some((c) => String(c.path).startsWith("/timelineAudits")),
       "the audit read was not even attempted");
  }

  console.log("");
  console.log("a count mismatch in our OWN record declines");
  {
    const calls: any[] = [];
    const res = await amendOrderInPlace(
      new OnsinchClient(transport(calls)),
      { order_id: 9001, previous: [team(), team({ name: "derig" })],
        desired: desiredOf([team({ size: 5 })]),
        known: { job_id: 4001, team_ids: [701] } },   // one id for two previous blocks
      hooks
    );
    ok(!!res.declined, "declined rather than guessing which block the id belongs to", res.declined ?? "(did not decline)");
    ok(!calls.some((c) => c.method === "PATCH"), "and nothing was written");
  }

  console.log("");
  console.log("no stored ids: the audit read is still used");
  {
    const calls: any[] = [];
    const res = await amendOrderInPlace(
      new OnsinchClient(transport(calls)),
      { order_id: 9001, previous: [team()], desired: desiredOf([team({ size: 5 })]) },
      hooks
    );
    ok(calls.some((c) => String(c.path).startsWith("/timelineAudits")),
       "a UI-raised order still reads the audit trail");
    ok(!!res.declined, "and declines when that read is empty, exactly as before", res.declined ?? "");
  }
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
