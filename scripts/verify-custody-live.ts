// ============================================================================
// The custody loop, against the live tenant. TEST company 515 only, hardcoded.
// ----------------------------------------------------------------------------
// Creates an order the new way, amends it in place, and PROVES the amendment
// landed by reading the Job window — which is derived from the order's blocks
// and is therefore the only field that cannot lie about them. Size, profession,
// place and name are ACCEPTED (204) and unreadable; that asymmetry is permanent.
//
//   npx tsx scripts/verify-custody-live.ts --write
// ============================================================================
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { createOrderWithPlace } from "../app/lib/deps";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";
import { loadEnv, onsinchBase } from "./_env.mjs";

loadEnv();
if (!process.argv.includes("--write")) {
  console.log("read-only by default. Pass --write to create one order on TEST 515.");
  process.exit(0);
}

const COMPANY = 515, USER = 1591, RATE = 122, PLACE = 49, DAY = "2027-11-10";
const L = "CUSTODY VERIFY - safe to delete";
const client = new OnsinchClient(httpTransport({ baseUrl: onsinchBase(), apiKey: (process.env.ONSINCH_API_KEY || "").trim() }));

let fails = 0;
const ok = (c: boolean, label: string, extra = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "build", profession_id: 1, size: 3, place_id: PLACE,
  beginning: `${DAY}T08:00:00+00:00`, end: `${DAY}T14:00:00+00:00`, ...o,
});
const derig = team({ name: "derig", size: 2, beginning: `${DAY}T18:00:00+00:00`, end: `${DAY}T22:00:00+00:00` });
const orderOf = (teams: DesiredSlotTeam[]): DesiredOrder => ({
  name: L, company_id: COMPANY, user_id: USER, request_approval: true,
  provisional: true, quote: false, pricelist_category_id: RATE, job_name: L, slot_teams: teams,
});
const windowOf = async (id: number) => {
  const live: any = await client.orderById(id);
  const o = live?.data ?? live;
  const job = (Array.isArray(o?.Job) ? o.Job[0] : o?.Job) ?? {};
  return `${String(job?.min_beginning).slice(11, 16)}-${String(job?.max_end).slice(11, 16)}`;
};

(async () => {
  const created = await createOrderWithPlace(client, orderOf([team(), derig]));
  console.log(`order ${created.id} job ${created.job_id} teams ${JSON.stringify(created.team_ids)}`);
  ok(created.team_ids.length === 2, "the create handed back one id per block");
  const before = await windowOf(created.id);
  ok(before === "08:00-22:00", "both blocks are live", before);

  // The read that used to be the only route, on an order created this way.
  const read = await client.slotTeamsForOrder(created.id);
  ok(read.teams.length === 0, "the audit read is still empty — custody is what makes this work");

  // Move the LATE block's window: the one change the window can prove.
  const res = await amendOrderInPlace(
    client,
    { order_id: created.id, previous: [team(), derig],
      desired: orderOf([team(), team({ name: "derig", size: 2, beginning: `${DAY}T18:00:00+00:00`, end: `${DAY}T20:00:00+00:00` })]),
      known: { job_id: created.job_id, team_ids: created.team_ids } },
    { onCreated: async () => {} }
  );
  ok(!res.declined && !res.refused, "the amendment ran", res.declined ?? res.refused ?? "");
  const after = await windowOf(created.id);
  ok(after === "08:00-20:00", "PROVEN: the window shrank to the amended end time", after);

  console.log(`\nleaving order ${created.id} for inspection — delete it when done`);
  process.exit(fails ? 1 : 0);
})();
