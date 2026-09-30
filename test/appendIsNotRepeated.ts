// ============================================================================
// A block whose POST landed but whose answer was lost is not posted again.
// ----------------------------------------------------------------------------
// The id of an appended block is recorded (order_amend) only after POST /slotTeams
// returns. If it lands and the response is lost, nothing is recorded, and the next
// attempt appends it again: an order asked to hold 8 crew held 9 (audit #4). Probed on
// the live API 2026-09-30: an appended block leaves NO audit row, so nothing but a read
// of the order's blocks can see it. The retry now reads them and adopts an identical,
// unclaimed block instead of posting a second.
//
// Offline.  npx tsx test/appendIsNotRepeated.ts
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
  name: "build", profession_id: 1, size: 6, place_id: 49,
  beginning: "2027-11-12T08:00:00+00:00", end: "2027-11-12T18:00:00+00:00", ...o,
});
const evening = team({ name: "get-out", size: 2, beginning: "2027-11-12T19:00:00+00:00", end: "2027-11-12T23:00:00+00:00" });
const desired: DesiredOrder = {
  name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true, pricelist_category_id: 122, job_name: "X @ Y",
  slot_teams: [team(), evening],
};

/** A tenant that stores what is posted, and can lose the answer to one POST. */
function tenant(loseFirstAnswer: boolean) {
  const blocks: Array<{ id: number; t: DesiredSlotTeam }> = [{ id: 701, t: team() }];
  let posts = 0;
  let lose = loseFirstAnswer;
  const t: Transport = async (method, path, body) => {
    if (method === "POST" && path === "/slotTeams") {
      posts++;
      const b = (body as any[])[0];
      const id = 900 + posts;
      blocks.push({ id, t: { name: b.name, profession_id: b.profession_id, size: b.size, place_id: b.place_id, beginning: b.beginning, end: b.end } });
      if (lose) { lose = false; throw new Error("socket hang up"); } // landed, answer lost
      return { status: 201, data: { data: [{ id }] } };
    }
    if (method === "GET" && path.startsWith("/orders") && /Job__SlotTeam__Slot/.test(path)) {
      return { status: 200, data: { data: [{ id: 9001, Job: [{ id: 4001, SlotTeam: blocks.map((x) => ({
        id: x.id, name: x.t.name, Slot: [{ id: x.id * 10, size: x.t.size, role: 0, cancelled: false, profession_id: x.t.profession_id, beginning: x.t.beginning, end: x.t.end }],
      })) }] }] } };
    }
    if (method === "GET" && path.startsWith("/orders")) return { status: 200, data: { data: [{ id: 9001, company_id: 515, provisional: true, Job: [{ id: 4001 }] }] } };
    if (method === "GET") return { status: 200, data: { data: [] } };
    return { status: 204, data: null };
  };
  return { client: new OnsinchClient(t), blocks, posts: () => posts };
}

const args = { order_id: 9001, previous: [team()], desired, known: { job_id: 4001, team_ids: [701] } };

async function main() {
  console.log("\n[1] the retry after a lost answer adopts the block that landed");
  {
    const tn = tenant(true);
    const recorded: number[] = [];
    const hooks = { onCreated: async (id: number) => { recorded.push(id); } };
    let threw = false;
    try { await amendOrderInPlace(tn.client, args, hooks); } catch { threw = true; }
    ok(threw && recorded.length === 0 && tn.blocks.length === 2, "the first attempt landed the block and recorded nothing", `${tn.blocks.length} blocks, recorded ${recorded.length}`);
    // The pipeline's retry: order_amend was never written, so nothing is marked done.
    const res = await amendOrderInPlace(tn.client, args, hooks);
    ok(tn.blocks.length === 2, "the order still holds two blocks, not three", String(tn.blocks.length));
    ok(tn.posts() === 1, "no second POST was sent", String(tn.posts()));
    ok(recorded.length === 1 && recorded[0] === tn.blocks[1].id && (res.amended?.added ?? []).includes(tn.blocks[1].id),
      "and the landed block's id is recorded as appended", JSON.stringify({ recorded, added: res.amended?.added }));
  }

  console.log("\n[2] with nothing lost, the block is posted once as before");
  {
    const tn = tenant(false);
    const res = await amendOrderInPlace(tn.client, args, { onCreated: async () => {} });
    ok(tn.posts() === 1 && tn.blocks.length === 2 && (res.amended?.added ?? []).length === 1, "one POST, one block added");
  }

  console.log("\n[3] a different block on the order is never adopted as this one");
  {
    const tn = tenant(false);
    // A block ops added by hand that is NOT the one being asked for.
    tn.blocks.push({ id: 555, t: team({ name: "rigging", size: 3, beginning: "2027-11-12T19:00:00+00:00", end: "2027-11-12T23:00:00+00:00" }) });
    await amendOrderInPlace(tn.client, args, { onCreated: async () => {} });
    ok(tn.posts() === 1, "the evening block is still posted", String(tn.posts()));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
