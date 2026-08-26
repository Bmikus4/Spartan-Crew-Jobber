// ============================================================================
// The amendment path against LIVE OnSinch — every shape, not just the scary one.
// ----------------------------------------------------------------------------
// The offline suite (test/amendInPlace.ts, test/amendmentReachesOnsinch.ts) proves the
// logic. It cannot prove OnSinch accepts what the engine emits, or that what lands is
// what was asked for. This does, shape by shape.
//
// WHAT CAN AND CANNOT BE PROVEN, and why the matrix is shaped this way:
//
// OnSinch will show you a block's WINDOW (`Job.min_beginning`, `Job.max_end` aggregate
// over the job's blocks) and the order's own top-level fields. It will NOT show you a
// block's size, venue, profession, name or description — the Job read model carries no
// headcount, and there is no GET /slotTeams. So:
//
//   PROVEN      — window moves, appended blocks, order-level fields, and every refusal
//                 or decline, all read back and asserted.
//   ACCEPTED    — size, place, profession, name, description. A 204 is the strongest
//                 evidence that exists. Rows are labelled so nobody later mistakes
//                 "accepted" for "seen to land".
//
// That asymmetry is not a gap in this script; it is the same fact that forces the
// engine to overwrite by position rather than diff (see amendOrder.ts).
//
// WHICH KEY YOU RUN WITH CHANGES WHAT PART A CAN DO. A service key (the engine's,
// `creator: null`) logs `order_create` plus a child row per Job, SlotTeam and Slot, so
// nested ids are readable. A person's own API key logs one childless
// `order_created_via_api` row — 4,119 of them since 2026-02-22, all user 2257. Part A
// therefore reads ids off orders the ENGINE really raised, and part B holds the ids it
// needs from `POST /slotTeams` responses, so the matrix runs on either key.
//
// TEST company 515 ("TEST - Eventz") only, hardcoded, never a flag. Every order this
// script raises is deleted before it exits, and no crew are involved anywhere.
//
//   npx tsx scripts/verify-amend-live.ts            # part A only, read-only
//   npx tsx scripts/verify-amend-live.ts --write    # the whole matrix
// ============================================================================
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { buildOrderBody, buildSlotTeamBody } from "../app/lib/engine/format";
import { planAmendment, amendOrderInPlace } from "../app/lib/engine/amendOrder";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";
import { loadEnv } from "./_env.mjs";

loadEnv();

const COMPANY = 515;
const USER = 1591;
const RATE = 122;
const PLACE = 49;        // ExCel London
const PLACE_ALT = 57;    // Olympia — for the venue-change row
const DAY = "2027-11-10";

/** Orders the ENGINE really created. Part A reads these and never writes to them. */
const ENGINE_ORDERS = [13784, 13809, 13786, 13788, 13630];

const key = (process.env.ONSINCH_API_KEY || "").trim();
if (!key) { console.error("ONSINCH_API_KEY not set"); process.exit(2); }
const base = (process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1").replace(/\/$/, "");
const client = new OnsinchClient(httpTransport({ baseUrl: base, apiKey: key }));

let fails = 0;
const rows: Array<{ shape: string; grade: string; detail: string }> = [];
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${cond || !extra ? "" : `  (${extra})`}`);
  if (!cond) fails++;
  return cond;
};
/** PROVEN = read back and asserted. ACCEPTED = 204, no read exists. */
const record = (shape: string, grade: "PROVEN" | "ACCEPTED" | "DECLINED" | "REFUSED" | "GATED", detail: string) =>
  rows.push({ shape, grade, detail });

const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "AMEND MATRIX - safe to delete",
  profession_id: 1,
  beginning: `${DAY}T08:00:00+00:00`,
  end: `${DAY}T18:00:00+00:00`,
  size: 3,
  place_id: PLACE,
  ...o,
});
const jobOf = (live: any) => (Array.isArray(live?.Job) ? live.Job[0] : live?.Job) ?? {};
const order = (teams: DesiredSlotTeam[], extra: Partial<DesiredOrder> = {}): DesiredOrder => ({
  name: "AMEND MATRIX - safe to delete",
  company_id: COMPANY, user_id: USER, request_approval: true,
  pricelist_category_id: RATE,
  job_name: "AMEND MATRIX - safe to delete",
  slot_teams: teams,
  ...extra,
});

const raised: number[] = [];
async function raise(teams: DesiredSlotTeam[], extra: Partial<DesiredOrder> = {}) {
  const created = await client.createOrder(buildOrderBody(order(teams, extra)));
  raised.push(created.id);
  const job_id = Number(jobOf(await client.orderById(created.id)).id);
  return { order_id: created.id, job_id };
}

(async () => {
  const me: any = await client.profile();
  const who = me?.data?.data ?? me?.data;
  console.log(`\nkey belongs to user ${who?.id} (${who?.email ?? "?"})`);

  console.log("\n=== PART A — nested slot team ids read back off real engine-raised orders (read only)");
  for (const id of ENGINE_ORDERS) {
    const r = await client.slotTeamsForOrder(id);
    ok(r.teams.length > 0 && Number.isInteger(r.job_id), `order ${id}: ids recovered`,
      `teams=[${r.teams.map((t) => t.id).join(",")}] job=${r.job_id} R=${r.order_number}`);
  }
  record("read nested ids back (engine-raised orders)", "PROVEN", `${ENGINE_ORDERS.length}/${ENGINE_ORDERS.length} orders`);

  if (!process.argv.includes("--write")) {
    console.log("\n=== PART B skipped. Re-run with --write for the full matrix on TEST 515.\n");
    process.exit(fails === 0 ? 0 : 1);
  }

  try {
    // ---------------------------------------------------------------- applied shapes
    console.log("\n=== PART B — every amendment shape that should APPLY, on one throwaway order");
    const { order_id, job_id } = await raise([team()]);
    console.log(`      order #${order_id}, job ${job_id} — deleted before this script exits`);

    console.log("\n[B1] APPEND a block");
    const added = await client.createSlotTeam(buildSlotTeamBody(job_id, team({ name: "block 2", size: 2, beginning: `${DAY}T19:00:00+00:00`, end: `${DAY}T22:00:00+00:00` })));
    const afterAppend = jobOf(await client.orderById(order_id));
    ok(Number.isInteger(added.id), "POST /slotTeams returned an id", String(added.id));
    ok(String(afterAppend.max_end).startsWith(`${DAY}T22`), "the job's end moved out to it", String(afterAppend.max_end));
    record("append a crew block", "PROVEN", `max_end -> ${afterAppend.max_end}`);

    console.log("\n[B2] MOVE THE WINDOW — both ends, via planAmendment");
    const was = team({ name: "block 2", size: 2, beginning: `${DAY}T19:00:00+00:00`, end: `${DAY}T22:00:00+00:00` });
    const moved = team({ name: "block 2", size: 2, beginning: `${DAY}T05:00:00+00:00`, end: `${DAY}T23:00:00+00:00` });
    const p1 = planAmendment([was], [moved], [{ id: added.id, name: "block 2" }]);
    ok(!p1.declined && p1.patches.length === 1, "one patch planned", JSON.stringify(p1.patches));
    await client.patchSlotTeams(p1.patches);
    const afterMove = jobOf(await client.orderById(order_id));
    ok(String(afterMove.min_beginning).startsWith(`${DAY}T05`), "the start moved", String(afterMove.min_beginning));
    ok(String(afterMove.max_end).startsWith(`${DAY}T23`), "and the end moved", String(afterMove.max_end));
    record("move a block's window (both ends)", "PROVEN", `${afterMove.min_beginning} .. ${afterMove.max_end}`);

    console.log("\n[B3] IDEMPOTENCY — send the very same patch again");
    await client.patchSlotTeams(p1.patches);
    const afterRepeat = jobOf(await client.orderById(order_id));
    ok(afterRepeat.min_beginning === afterMove.min_beginning && afterRepeat.max_end === afterMove.max_end,
      "nothing moved and nothing was duplicated", `${afterRepeat.min_beginning} .. ${afterRepeat.max_end}`);
    record("re-apply an identical patch", "PROVEN", "no change, no duplicate");

    console.log("\n[B4] GROW then SHRINK an EMPTY block (nobody signed on)");
    await client.patchSlotTeams([{ id: added.id, size: 9 }]);
    ok(true, "3 -> 9 accepted (204)");
    await client.patchSlotTeams([{ id: added.id, size: 1 }]);
    ok(true, "9 -> 1 accepted (204) — the floor");
    record("resize an EMPTY block, up and down", "ACCEPTED", "204 both ways; no read exists for size");

    console.log("\n[B5] VENUE, PROFESSION, NAME and DESCRIPTION in one patch");
    const multi = await client.patchSlotTeams([{ id: added.id, place_id: PLACE_ALT, profession_id: 3, name: "block 2 renamed", description: "amendment matrix" }]);
    ok(multi === true, "accepted (204)");
    record("change venue + profession + name + description", "ACCEPTED", "204; none of these are readable back");

    console.log("\n[B6] ORDER-LEVEL fields alongside the blocks");
    await client.patchOrder([{ id: order_id, specification: "matrix spec", intern_name: "PO-MATRIX-1" }]);
    const liveOrder: any = await client.orderById(order_id);
    ok(liveOrder?.specification === "matrix spec", "specification landed", String(liveOrder?.specification));
    ok(liveOrder?.intern_name === "PO-MATRIX-1", "and the PO", String(liveOrder?.intern_name));
    record("order-level specification + PO", "PROVEN", "both read back");

    console.log("\n[B7] INSERT a block FIRST — the positional rewrite the design rests on");
    /**
     * previous [A] -> next [B, A]. Pairing is positional, so the LIVE id that held A is
     * rewritten to hold B and A is appended. Different ids, identical resulting set —
     * which is the whole claim. Witnessed by the window aggregate spanning both.
     */
    const A = team({ name: "A", size: 2, beginning: `${DAY}T12:00:00+00:00`, end: `${DAY}T14:00:00+00:00` });
    const B = team({ name: "B", size: 2, beginning: `${DAY}T09:00:00+00:00`, end: `${DAY}T10:00:00+00:00` });
    const solo = await raise([A]);
    const soloTeam = await client.createSlotTeam(buildSlotTeamBody(solo.job_id, A));
    // Treat the appended team as the one we own, so its id is known without the audit log.
    const plan = planAmendment([A], [B, A], [{ id: soloTeam.id, name: "A" }]);
    ok(!plan.declined, "applicable", plan.declined);
    ok(plan.patches.length === 1 && plan.patches[0].name === "B", "the live block is rewritten to B", JSON.stringify(plan.patches));
    ok(plan.creates.length === 1 && plan.creates[0].name === "A", "and A is appended", JSON.stringify(plan.creates.map((c) => c.name)));
    await client.patchSlotTeams(plan.patches);
    const appendedA = await client.createSlotTeam(buildSlotTeamBody(solo.job_id, plan.creates[0]));
    const soloJob = jobOf(await client.orderById(solo.order_id));
    ok(String(soloJob.min_beginning).startsWith(`${DAY}T09`), "the job now starts at B's start", String(soloJob.min_beginning));
    ok(String(soloJob.max_end).startsWith(`${DAY}T14`), "and ends at A's end — the set is {B, A}", String(soloJob.max_end));
    ok(Number.isInteger(appendedA.id), "A's new id", String(appendedA.id));
    record("insert a block first (positional rewrite)", "PROVEN", `window ${soloJob.min_beginning} .. ${soloJob.max_end}`);

    // ---------------------------------------------------------------- declines
    console.log("\n=== PART C — shapes that must DECLINE, so delete-and-repost takes them");

    const dropped = planAmendment([A, B], [A], [{ id: 1, name: "A" }, { id: 2, name: "B" }]);
    ok(!!dropped.declined && /cannot remove/.test(dropped.declined!), "a DROPPED block declines", dropped.declined);
    record("drop a crew block", "DECLINED", "OnSinch cannot remove a slot team; rebuild takes it");

    const mismatch = planAmendment([A], [A, B], [{ id: 1, name: "A" }, { id: 99, name: "a block ops added" }]);
    ok(!!mismatch.declined && /somebody else/.test(mismatch.declined!), "a team set we did not write declines", mismatch.declined);
    record("live team set changed by ops", "DECLINED", "positional pairing would move the wrong block");

    console.log("\n[C3] and the real thing: an order whose ids cannot be read declines end to end");
    const blind = await amendOrderInPlace(client, { order_id, previous: [team()], desired: order([team({ size: 5 })]) }, { async onCreated() {} });
    ok(!!blind.declined, "amendOrderInPlace declines rather than guessing", JSON.stringify(blind));
    record("order whose nested ids are unreadable", "DECLINED", "declines; the rebuild path takes it");

    // ---------------------------------------------------------------- refusals
    console.log("\n=== PART D — shapes that must REFUSE, where no path may write");

    /**
     * D1 ASSERTS THE OPPOSITE OF WHAT IT USED TO, AND THAT IS THE FIX, NOT A REGRESSION.
     *
     * It required `provisional: false` to refuse. Orders are now raised in the To
     * Confirm posture, which means OnSinch's defaults, which means provisional reads
     * back FALSE on every order the engine writes (format.ts). The old rule would
     * therefore have refused every amendment the engine ever attempted — including the
     * delete-and-repost a dropped block needs.
     *
     * The guarantee moved to attendance, which is the harm itself rather than a proxy
     * for it: measured over 300 live orders on 2026-08-25, no flag separates a committed
     * booking from a fresh one (status=0 + provisional=false, the engine's own posture,
     * was staffed in 6 of 8 sampled). That refusal is PART E, and it is still gated.
     */
    console.log("[D1] provisional=false — now the posture every order is born in");
    /**
     * On its OWN order, not the matrix order. The matrix order has been appended to and
     * had a block inserted ahead of it by now, so `previous: [team()]` no longer
     * describes it and the amendment declines on the team-count check instead of
     * reaching the question being asked. The old assertion never noticed because the
     * provisional gate short-circuited ahead of that check.
     */
    /**
     * Raised the way the ENGINE raises one — empty SlotTeam, then the block posted
     * separately — because that is the only create whose block ids are addressable
     * afterwards (API reference §12). A nested create leaves a childless audit row, so
     * `slotTeamsForOrder` reads back zero blocks and the amendment declines on the
     * team-count check before it can answer the question this case asks.
     */
    const d1 = await raise([]);
    const d1Team = await client.createSlotTeam(buildSlotTeamBody(d1.job_id, team()));
    await client.patchOrder([{ id: d1.order_id, provisional: false }]);
    /**
     * `known` is passed because that is what PRODUCTION passes (pipeline.ts): the engine
     * records each block id as POST /slotTeams returns it, and the audit read is skipped
     * for orders it created. Measured while writing this: an order created seconds ago
     * has NO audit rows at all — not its teams, not its job id, not its R number — so a
     * case that leans on the fallback read is testing the recovery path for UI-raised
     * orders, not the amendment path a client's follow-up actually takes.
     */
    const confirmed = await amendOrderInPlace(
      client,
      {
        order_id: d1.order_id,
        previous: [team()],
        desired: order([team({ size: 5 })]),
        known: { job_id: d1.job_id, team_ids: [d1Team.id] },
      },
      { async onCreated() {} }
    );
    ok(!confirmed.refused && !!confirmed.amended, "amended, not refused", confirmed.refused ?? confirmed.declined ?? "amended");
    record("amend an order with provisional=false", "PROVEN", "the To Confirm posture is amendable; attendance is the gate now");

    console.log("[D2] another client's order");
    const wrongCo = await amendOrderInPlace(client, { order_id, previous: [team()], desired: order([team()], { company_id: 999999 }) }, { async onCreated() {} });
    ok(!!wrongCo.refused && /belongs to company/.test(wrongCo.refused!), "refused", wrongCo.refused);
    record("amend across a company boundary", "REFUSED", "company is re-read, never trusted");

    console.log("[D3] size 0 — refused locally, before it is ever sent");
    let local = "";
    await client.patchSlotTeams([{ id: added.id, size: 0 }]).catch((e) => { local = String(e?.message ?? e); });
    ok(/floor is 1/.test(local), "the client refuses it", local || "NOTHING THREW");
    record("size 0", "REFUSED", "refused client-side; the 400 would land after earlier patches");

    // ---------------------------------------------------------------- the gap
    console.log("\n=== PART E — the one row this script cannot fill");
    console.log("  GATED  shrinking a block that people are SIGNED ON to.");
    console.log("         Needs a seat occupied, and POST /attendance needs a slot_id, which");
    console.log("         exists only in the audit trail of a SERVICE-key or UI-raised order.");
    console.log("         scripts/verify-shrink-staffed.ts runs it given either. Refused today.");
    record("shrink a block with crew on it", "GATED", "refused by the engine; see verify-shrink-staffed.ts");
  } catch (err: any) {
    fails++;
    console.log(`  FAIL  threw: ${String(err?.message ?? err)}`);
  } finally {
    for (const id of raised) {
      try {
        await client.deleteOrders([id]);
        ok((await client.orderById(id)) === null, `cleaned up order #${id}`);
      } catch (err: any) {
        fails++;
        console.log(`  FAIL  could not delete order #${id} — DELETE IT BY HAND: ${String(err?.message ?? err)}`);
      }
    }
  }

  console.log("\n=== THE MATRIX");
  const w = Math.max(...rows.map((r) => r.shape.length));
  for (const r of rows) console.log(`  ${r.grade.padEnd(9)} ${r.shape.padEnd(w)}  ${r.detail}`);
  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
