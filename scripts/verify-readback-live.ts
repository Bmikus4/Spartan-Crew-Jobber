// ============================================================================
// CAN WE READ BACK WHAT WE CHANGED? Ben's protocol, on TEST 515.
// ----------------------------------------------------------------------------
// Note the original, change it, go and find it again.
//
// The standing claim in this repo — "there is no GET /slotTeams, so size, venue,
// profession and name can only ever be ACCEPTED on a 204, never PROVEN" — is wrong.
// `/attendance?with=Slot,SlotTeam&Order__id=<id>` returns Slot.size, Slot.profession_id,
// Slot.name, Slot.beginning/end, Slot.slotlocation_id and SlotTeam.name/description.
// `Order__id` is a real filter (2/2 correct on a known order, 0 rows for id 99999999).
//
// THE ONE THING THAT DECIDES WHETHER THIS IS USABLE: an attendance row exists per
// STAFFED seat. A brand-new order has no crew on it, so it may have no attendance rows
// and therefore no readable slots — which is exactly the order we most need to verify.
// This script settles that, then runs the full note-change-refind loop either way.
//
// TEST company 515 ("TEST - Eventz") only, hardcoded. The order it raises is deleted
// before it exits. No crew are involved anywhere.
//
//   npx tsx scripts/verify-readback-live.ts
// ============================================================================
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { buildOrderBody, buildSlotTeamBody } from "../app/lib/engine/format";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";
import { loadEnv } from "./_env.mjs";

loadEnv();

const COMPANY = 515, USER = 1591, RATE = 122;
const PLACE = 49, PLACE_ALT = 57;
const DAY = "2027-11-12";

const key = (process.env.ONSINCH_API_KEY || "").trim();
if (!key) { console.error("ONSINCH_API_KEY not set"); process.exit(2); }
const base = (process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1").replace(/\/$/, "");
const client = new OnsinchClient(httpTransport({ baseUrl: base, apiKey: key }));

const raw = async (path: string) => {
  const r = await fetch(base + path, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  const t = await r.text();
  try { return { s: r.status, j: JSON.parse(t) as any }; } catch { return { s: r.status, j: null as any }; }
};

const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "READBACK - safe to delete",
  profession_id: 1,
  beginning: `${DAY}T08:00:00+00:00`,
  end: `${DAY}T18:00:00+00:00`,
  size: 2,
  place_id: PLACE,
  ...o,
});
const order = (teams: DesiredSlotTeam[]): DesiredOrder => ({
  name: "READBACK - safe to delete",
  company_id: COMPANY, user_id: USER, request_approval: true,
  pricelist_category_id: RATE,
  job_name: "READBACK - safe to delete",
  slot_teams: teams,
});
const jobOf = (live: any) => (Array.isArray(live?.Job) ? live.Job[0] : live?.Job) ?? {};

/** Every route that might show a block, tried in turn. */
async function readBlocks(order_id: number, job_id: number) {
  const out: Record<string, any> = {};
  const att = await raw(`/attendance?with=Slot,SlotTeam&Order__id=${order_id}&limit=100`);
  out.attendance = (att.j?.data ?? []).map((a: any) => ({
    slot: a.Slot?.id, team: a.Slot?.slotteam_id, size: a.Slot?.size,
    prof: a.Slot?.profession_id, place: a.Slot?.slotlocation_id,
    name: a.SlotTeam?.name, beginning: a.Slot?.beginning, end: a.Slot?.end,
  }));
  // If a seat is required for visibility, these two say so plainly.
  const bySlotJob = await raw(`/attendance?with=Slot&Slot__job_id=${job_id}&limit=100`);
  out.bySlotJob = { http: bySlotJob.s, rows: (bySlotJob.j?.data ?? []).length };
  const live: any = await client.orderById(order_id);
  const j = jobOf(live);
  out.jobWindow = { id: j.id, min: j.min_beginning, max: j.max_end };
  return out;
}

let raisedId = 0;
(async () => {
  try {
    // ── 1. note the original ────────────────────────────────────────────────
    const created = await client.createOrder(buildOrderBody(order([team()])));
    raisedId = created.id;
    const job_id = Number(jobOf(await client.orderById(created.id)).id);
    console.log(`raised order #${created.id}, job ${job_id}`);
    console.log(`SENT: size 2, profession 1, place ${PLACE}, name "READBACK - safe to delete", ${DAY} 08:00-18:00\n`);

    const before = await readBlocks(created.id, job_id);
    console.log("BEFORE — what the API will show us:");
    console.log("  /attendance rows:", before.attendance.length, JSON.stringify(before.attendance));
    console.log("  /attendance?Slot__job_id:", JSON.stringify(before.bySlotJob));
    console.log("  Job window:", JSON.stringify(before.jobWindow));

    const visibleUnstaffed = before.attendance.length > 0;
    console.log(`\n  => an UNSTAFFED block is ${visibleUnstaffed ? "VISIBLE" : "INVISIBLE"} to /attendance\n`);

    // ── 2. change it ────────────────────────────────────────────────────────
    // Needs the block id. A nested create does not return it, so add a second block
    // separately (that id IS returned) and patch THAT — the same move the amendment
    // path makes on a block it owns.
    const added = await client.createSlotTeam(buildSlotTeamBody(job_id, team({
      name: "READBACK block B", size: 3, beginning: `${DAY}T19:00:00+00:00`, end: `${DAY}T22:00:00+00:00`,
    })));
    console.log(`added block B id=${added.id} (size 3, profession 1, place ${PLACE}, 19:00-22:00)`);

    const mid = await readBlocks(created.id, job_id);
    console.log("  after adding B, /attendance rows:", mid.attendance.length, JSON.stringify(mid.attendance));

    await client.patchSlotTeams([{
      id: added.id, size: 7, name: "READBACK block B RENAMED",
      place_id: PLACE_ALT, profession_id: 3,
      beginning: `${DAY}T17:00:00+00:00`, end: `${DAY}T23:00:00+00:00`,
    } as any]);
    console.log(`\nPATCHED block ${added.id}: size 3->7, name renamed, place ${PLACE}->${PLACE_ALT}, profession 1->3, window 19:00-22:00 -> 17:00-23:00\n`);

    // ── 3. go and find it ───────────────────────────────────────────────────
    const after = await readBlocks(created.id, job_id);
    console.log("AFTER:");
    console.log("  /attendance rows:", after.attendance.length, JSON.stringify(after.attendance));
    console.log("  Job window:", JSON.stringify(after.jobWindow));

    const found = (after.attendance as any[]).find((b) => b.team === added.id);
    console.log("\nVERDICT");
    if (found) {
      console.log(`  block ${added.id} READ BACK: size=${found.size} prof=${found.prof} place=${found.place} name=${JSON.stringify(found.name)} ${found.beginning}..${found.end}`);
      console.log(`  size 7?        ${found.size === 7}`);
      console.log(`  profession 3?  ${found.prof === 3}`);
      console.log(`  place ${PLACE_ALT}?     ${found.place === PLACE_ALT}`);
      console.log(`  renamed?       ${String(found.name).includes("RENAMED")}`);
    } else {
      console.log(`  block ${added.id} is NOT readable through /attendance — no staffed seat on it.`);
      console.log(`  window witness only: Job ${after.jobWindow.min} .. ${after.jobWindow.max}`);
    }
  } catch (err) {
    console.error("ERROR:", (err as Error)?.message ?? err);
  } finally {
    if (raisedId) {
      try { await client.deleteOrders([raisedId]); console.log(`\ncleaned up order #${raisedId}`); }
      catch (e) { console.error(`CLEANUP FAILED for #${raisedId} — delete it by hand:`, (e as Error)?.message); }
    }
  }
})();
