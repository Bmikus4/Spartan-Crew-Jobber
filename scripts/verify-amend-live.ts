// ============================================================================
// Prove the in-place amendment against the LIVE OnSinch tenant.
// ----------------------------------------------------------------------------
// The offline suite proves the logic; it cannot prove OnSinch behaves the way this
// code believes. Two beliefs are worth a live run: that a nested slot team's id is
// recoverable at all, and that PATCH/POST /slotTeams actually move what they say.
//
// WHICH KEY YOU RUN THIS WITH CHANGES THE ANSWER, and that is not a detail:
//
//   a SERVICE key (the engine's, `creator: null` in the audit log)
//       -> a create logs `order_create` PLUS a child row per Job, SlotTeam and Slot,
//          each carrying `path: Order:N/Job:M/SlotTeam:T`. The ids are readable.
//   a USER key (a person's own API key — ben@… is user 2257)
//       -> a create logs ONE row, `order_created_via_api`, with no children and no
//          ids. Verified over 4,119 such rows going back to 2026-02-22: every one is
//          user 2257 and none has a child. Nothing about this is new or broken.
//
// So `slotTeamsForOrder` returns NOTHING for an order created with a user key, and the
// engine correctly declines to amend it. Run part B with a user key and the write half
// still proves out, because the ids there come from `POST /slotTeams` responses rather
// than from the audit log.
//
// Part A is READ ONLY, against orders the engine really created. Part B creates one
// order on TEST company 515 ("TEST - Eventz") and deletes it at the end; 515 is
// hardcoded, not a flag, because the only way this script could do harm is by being
// pointed at a real client.
//
// NO CREW ARE INVOLVED. The one write nobody has tested — shrinking a block people are
// signed on to — needs a real signup and may notify a worker. It is Ben's call and this
// script deliberately cannot make it.
//
//   npx tsx scripts/verify-amend-live.ts            # part A, reads nothing but audits
//   npx tsx scripts/verify-amend-live.ts --write    # and part B, one throwaway order
// ============================================================================
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { buildOrderBody, buildSlotTeamBody } from "../app/lib/engine/format";
import { planAmendment } from "../app/lib/engine/amendOrder";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";
import { loadEnv } from "./_env.mjs";

loadEnv();

/** TEST - Eventz, its only Client contact, and the rate card its own live order carries. */
const COMPANY = 515;
const USER = 1591;
const RATE = 122;
/** ExCel London — a real place, so a create cannot fail on the commonest 400. */
const PLACE = 49;

/**
 * Orders the ENGINE created, spread over three weeks. Part A reads these; it never
 * writes to them. Chosen because they are the shape the amendment actually meets.
 */
const ENGINE_ORDERS = [13784, 13809, 13786, 13788, 13630];

const key = (process.env.ONSINCH_API_KEY || "").trim();
if (!key) { console.error("ONSINCH_API_KEY not set"); process.exit(2); }
const client = new OnsinchClient(
  httpTransport({
    baseUrl: (process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1").replace(/\/$/, ""),
    apiKey: key,
  })
);

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${cond || !extra ? "" : `  (${extra})`}`);
  if (!cond) fails++;
};

/** Far enough out that nobody would sign on even if it were visible. */
const DAY = "2027-11-06";
const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "AMEND VERIFY - safe to delete",
  profession_id: 1,
  beginning: `${DAY}T08:00:00+00:00`,
  end: `${DAY}T18:00:00+00:00`,
  size: 3,
  place_id: PLACE,
  ...o,
});

const jobOf = (live: any) => (Array.isArray(live?.Job) ? live.Job[0] : live?.Job) ?? {};

let order_id = 0;
(async () => {
  const me = await client.profile();
  const whoami = (me as any)?.data?.data ?? (me as any)?.data;
  console.log(`\nkey belongs to user ${whoami?.id} (${whoami?.email ?? "?"})`);

  console.log("\n=== PART A — the ids come back, on orders the engine really created (read only)");
  for (const id of ENGINE_ORDERS) {
    const r = await client.slotTeamsForOrder(id);
    const shape = `teams=[${r.teams.map((t) => t.id).join(",")}] job=${r.job_id} R=${r.order_number}`;
    ok(r.teams.length > 0 && Number.isInteger(r.job_id), `order ${id}: ids recovered`, shape);
    // order_create's own tally, when the order was created through the API. It counts
    // what the CREATE made, so a team ops added later makes it legitimately lower —
    // which is precisely the case planAmendment must decline on.
    if (r.created_count !== undefined && r.created_count !== r.teams.length) {
      console.log(`        note: order_create made ${r.created_count}, ${r.teams.length} exist — a block was added later`);
      const plan = planAmendment(new Array(r.created_count).fill(team()), [team({ size: 9 })], r.teams);
      ok(!!plan.declined, `order ${id}: and an amendment to it DECLINES rather than pairing by position`, plan.declined);
    }
  }

  if (!process.argv.includes("--write")) {
    console.log("\n=== PART B skipped. Re-run with --write to create and delete one order on TEST 515.");
    console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}\n`);
    process.exit(fails === 0 ? 0 : 1);
  }

  console.log("\n=== PART B — the writes land, on a throwaway order on TEST company 515");
  const order: DesiredOrder = {
    name: "AMEND VERIFY - safe to delete",
    company_id: COMPANY,
    user_id: USER,
    request_approval: true,
    provisional: true,
    quote: false,
    pricelist_category_id: RATE,
    job_name: "AMEND VERIFY - safe to delete",
    slot_teams: [team()],
  };

  try {
    const created = await client.createOrder(buildOrderBody(order));
    order_id = created.id;
    console.log(`      order #${order_id} created — delete it by hand if this script dies`);
    const job_id = Number(jobOf(await client.orderById(order_id)).id);
    ok(Number.isInteger(job_id), "its job id read back", String(job_id));

    console.log("\n[1] POST a second block onto the order that already exists");
    const added = await client.createSlotTeam(
      buildSlotTeamBody(job_id, team({ name: "AMEND VERIFY block 2", size: 2, beginning: `${DAY}T19:00:00+00:00`, end: `${DAY}T22:00:00+00:00` }))
    );
    ok(Number.isInteger(added.id), "POST /slotTeams returned the new id", String(added.id));
    const afterAdd = jobOf(await client.orderById(order_id));
    ok(String(afterAdd.max_end).startsWith(`${DAY}T22`), "and the job's end moved out to the new block", String(afterAdd.max_end));

    console.log("\n[2] PATCH that block: 2 -> 5 people, and an hour later");
    const plan = planAmendment(
      [team({ name: "AMEND VERIFY block 2", size: 2, beginning: `${DAY}T19:00:00+00:00`, end: `${DAY}T22:00:00+00:00` })],
      [team({ name: "AMEND VERIFY block 2", size: 5, beginning: `${DAY}T19:00:00+00:00`, end: `${DAY}T23:00:00+00:00` })],
      [{ id: added.id, name: "AMEND VERIFY block 2" }]
    );
    ok(plan.patches.length === 1 && plan.patches[0].size === 5 && !!plan.patches[0].end, "the plan is one patch carrying size and end", JSON.stringify(plan.patches));
    await client.patchSlotTeams(plan.patches);
    const afterPatch = jobOf(await client.orderById(order_id));
    ok(String(afterPatch.max_end).startsWith(`${DAY}T23`), "the window moved — read back off the job", String(afterPatch.max_end));

    /**
     * A SIZE CHANGE CANNOT BE READ BACK. Anywhere. The Job read model carries exactly
     * `id, order_id, supervisor_id, name, created, modified, creator, modifier,
     * pricelist_category_id, min_beginning, max_end` — no headcount — and there is no
     * GET /slotTeams. So the 204 is the only evidence a resize landed, and any claim
     * this engine makes about crew numbers in OnSinch rests on the write having been
     * accepted, never on having seen the result.
     *
     * The windows are the one thing that IS observable, which is why they carry the
     * proof here: if `beginning` and `end` reach the record, so does `size`, which
     * travels in the same body through the same endpoint.
     */
    console.log("\n[3] move the START time — the other end of the window, and the other witness");
    await client.patchSlotTeams([{ id: added.id, beginning: `${DAY}T05:00:00+00:00`, size: 1 }]);
    const afterShrink = jobOf(await client.orderById(order_id));
    ok(String(afterShrink.min_beginning).startsWith(`${DAY}T05`), "the start moved too", String(afterShrink.min_beginning));
    ok(String(afterShrink.max_end).startsWith(`${DAY}T23`), "and the end it was not asked to change stayed put", String(afterShrink.max_end));

    console.log("\n[4] size 0 is refused before it is ever sent");
    let refused = "";
    await client.patchSlotTeams([{ id: added.id, size: 0 }]).catch((e) => { refused = String(e?.message ?? e); });
    ok(/floor is 1/.test(refused), "the client refuses it locally", refused || "NOTHING THREW");

    console.log("\n[5] nobody is signed on, so the per-team attendance read is empty");
    const byTeam = await client.attendanceByTeam(order_id);
    ok(byTeam.size === 0, "no attendance rows", JSON.stringify([...byTeam]));
  } catch (err: any) {
    fails++;
    console.log(`  FAIL  threw: ${String(err?.message ?? err)}`);
  } finally {
    if (order_id) {
      console.log(`\n[6] clean up: delete order #${order_id}`);
      try {
        await client.deleteOrders([order_id]);
        ok((await client.orderById(order_id)) === null, "deleted");
      } catch (err: any) {
        fails++;
        console.log(`  FAIL  could not delete order #${order_id} — DELETE IT BY HAND: ${String(err?.message ?? err)}`);
      }
    }
  }
  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
