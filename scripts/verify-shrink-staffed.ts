// ============================================================================
// THE ONE WRITE NOBODY HAS TESTED: shrinking a crew block that people are on.
// ----------------------------------------------------------------------------
// `PATCH /slotTeams [{id, size: <smaller>}]` on a block with crew signed on may unbook
// them as quietly as a delete does. Nothing in the response would say so, and there is
// no read that returns a block's size, so the engine refuses it today (amendOrder.ts)
// and 45% of drafts inherit that refusal. This settles it by measurement.
//
// THE EXPERIMENT. A block of 3 with 2 people on it, shrunk to 1. Three outcomes, and
// they lead to three different rules:
//
//   A. 400, refused        -> best case. The engine can then allow a shrink down to the
//                             number signed on and let OnSinch guard the rest.
//   B. drops empty slots   -> a size-1 block holding 2 people. Inconsistent but nobody
//                             is unbooked; the engine can allow shrink >= signed-on.
//   C. unbooks somebody    -> the fear is real. Keep refusing, forever, and say why.
//
// WHY IT IS SAFE TO RUN
//
//   - TEST company 515 ("TEST - Eventz") only. Hardcoded, never a flag. Its client
//     contact is accounts@spartancrew.co.uk, so even a client-facing notification lands
//     inside Spartan.
//   - The workers signed on are DUMMIES this script creates: name and surname only.
//     `POST /workers` requires nothing else, so they carry NO EMAIL AND NO PHONE and
//     therefore cannot be emailed or texted. `POST /attendance` accepts only
//     {slot_id, user_id} — there is no notify flag to get wrong.
//   - The order is deleted at the end and every id is printed before each write.
//   - There is no DELETE /workers, so the dummies persist. They are named to be obvious
//     and are deactivated (status 0) on the way out.
//
// WHAT IT NEEDS FROM YOU — one of these, because a fresh order's SLOT ids are readable
// no other way (a standalone POST /slotTeams logs nothing; there is no GET /slots, no
// /positions, no /applicants):
//
//   --order <id>   an order YOU created in the OnSinch UI on TEST - Eventz, one block,
//                  3 crew. A UI create logs the full audit tree, so its slot ids are
//                  readable. Nothing else is needed. RECOMMENDED — no secret changes
//                  hands.
//   ONSINCH_SERVICE_API_KEY   the engine's own key. Its creates log the same tree, so
//                  the script can raise and delete the order itself, unattended.
//
// A person's API key logs one childless `order_created_via_api` row, which is why the
// key already in .env.local cannot bootstrap this on its own.
//
//   npx tsx scripts/verify-shrink-staffed.ts --order 13821 --write
// ============================================================================
import { OnsinchClient, httpTransport, type Transport } from "../app/lib/engine/onsinch";
import { buildOrderBody } from "../app/lib/engine/format";
import type { DesiredOrder } from "../app/lib/engine/types";
import { loadEnv } from "./_env.mjs";

loadEnv();

const COMPANY = 515;
const USER = 1591;
const RATE = 122;
const PLACE = 49;
const DAY = "2027-11-08";
/** Named so that anyone who finds them in the worker list knows what they are. */
const DUMMY = [
  { name: "ZZ-TEST", surname: "DO-NOT-USE-1" },
  { name: "ZZ-TEST", surname: "DO-NOT-USE-2" },
];

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const WRITE = process.argv.includes("--write");
const GIVEN_ORDER = Number(arg("--order") || 0) || 0;

const base = (process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1").replace(/\/$/, "");
const userKey = (process.env.ONSINCH_API_KEY || "").trim();
const serviceKey = (process.env.ONSINCH_SERVICE_API_KEY || "").trim();
if (!userKey && !serviceKey) { console.error("no OnSinch key set"); process.exit(2); }

/** Writes go out on the service key when there is one: only its creates log slot ids. */
const writeKey = serviceKey || userKey;
const client = new OnsinchClient(httpTransport({ baseUrl: base, apiKey: writeKey }));

/** Raw transport for the calls the typed client has no business exposing. */
const raw: Transport = async (method, path, body) => {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `apikey ${writeKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data: any = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = t.slice(0, 300); }
  return { status: r.status, data };
};

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${cond || !extra ? "" : `  (${extra})`}`);
  if (!cond) fails++;
};
const note = (s: string) => console.log(`        ${s}`);

if (!WRITE) {
  console.log(
    "\nThis signs dummy workers onto a crew block and shrinks it, on TEST company 515.\n" +
      "It needs --order <id> (an order you raised in the OnSinch UI) or ONSINCH_SERVICE_API_KEY.\n" +
      "Re-run with --write when you mean it.\n"
  );
  process.exit(0);
}
if (!GIVEN_ORDER && !serviceKey) {
  console.error(
    "\nCannot start: a fresh order's SLOT ids are only readable when the order was created\n" +
      "by a service key or in the UI. Give me --order <id> from the OnSinch UI on\n" +
      "TEST - Eventz (one block, 3 crew), or set ONSINCH_SERVICE_API_KEY.\n"
  );
  process.exit(2);
}

/** Every Slot id under an order, from the audit trail, grouped by its slot team. */
async function slotsByTeam(order_id: number): Promise<Map<number, number[]>> {
  const r = await raw("GET", `/timelineAudits?limit=100&${encodeURIComponent("data[like]")}=${encodeURIComponent(`%Order:${order_id}%`)}`);
  const out = new Map<number, number[]>();
  for (const row of (r.data?.data ?? []) as any[]) {
    let p: any;
    try { p = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch { continue; }
    if (p?.model !== "Slot" || row.action !== "common_create") continue;
    const path = String(p?.data?.path ?? "").replace(/\\\//g, "/");
    const m = /^Order:(\d+)\/Job:\d+\/SlotTeam:(\d+)\/Slot:(\d+)$/.exec(path);
    if (!m || Number(m[1]) !== Number(order_id)) continue;
    const team = Number(m[2]);
    out.set(team, [...(out.get(team) ?? []), Number(m[3])]);
  }
  return out;
}

/** Find or create a dummy worker. No email, no phone — it cannot be contacted. */
async function dummyWorker(d: { name: string; surname: string }): Promise<number> {
  const found = await raw("GET", `/workers?limit=100&surname=${encodeURIComponent(d.surname)}`);
  const hit = ((found.data?.data ?? []) as any[]).find((w) => w.surname === d.surname && w.name === d.name);
  if (hit?.id) { note(`reusing dummy worker ${hit.id} (${d.name} ${d.surname})`); return Number(hit.id); }
  const made = await raw("POST", "/workers", [{ name: d.name, surname: d.surname }]);
  const id = Number(made.data?.data?.[0]?.id);
  if (!Number.isInteger(id)) throw new Error(`could not create dummy worker: ${JSON.stringify(made.data)}`);
  note(`created dummy worker ${id} (${d.name} ${d.surname}) — no email, no phone`);
  return id;
}

let order_id = GIVEN_ORDER;
let mine = false;
const attendanceIds: number[] = [];

(async () => {
  const who = await raw("GET", "/users/profile");
  console.log(`\nwriting as user ${who.data?.data?.id} (${who.data?.data?.email ?? "?"})${serviceKey ? " [service key]" : " [user key]"}`);

  try {
    if (!order_id) {
      console.log("\n[0] raise a throwaway order on TEST 515 with one block of 3");
      const order: DesiredOrder = {
        name: "SHRINK TEST - safe to delete",
        company_id: COMPANY, user_id: USER, request_approval: true,
        provisional: true, quote: false, pricelist_category_id: RATE,
        job_name: "SHRINK TEST - safe to delete",
        slot_teams: [{ name: "SHRINK TEST block", profession_id: 1, beginning: `${DAY}T08:00:00+00:00`, end: `${DAY}T18:00:00+00:00`, size: 3, place_id: PLACE }],
      };
      const created = await client.createOrder(buildOrderBody(order));
      order_id = created.id;
      mine = true;
      console.log(`      order #${order_id} created — delete it by hand if this dies`);
    } else {
      console.log(`\n[0] using YOUR order #${order_id}`);
      const live = await client.orderById(order_id);
      ok(!!live, "it exists");
      ok(Number(live?.company_id) === COMPANY, `and belongs to TEST company ${COMPANY}`, `company_id=${live?.company_id}`);
      if (Number(live?.company_id) !== COMPANY) throw new Error("refusing to touch an order outside TEST - Eventz");
    }

    console.log("\n[1] read the block and its slots out of the audit trail");
    const read = await client.slotTeamsForOrder(order_id);
    const slots = await slotsByTeam(order_id);
    ok(read.teams.length >= 1, "slot team id(s) recovered", JSON.stringify(read.teams));
    const team = read.teams[0];
    const mySlots = slots.get(team?.id) ?? [];
    ok(mySlots.length >= 3, `the block has at least 3 slots to work with`, `team ${team?.id} slots ${JSON.stringify(mySlots)}`);
    if (!team || mySlots.length < 3) {
      throw new Error(
        "need one block of at least 3 crew whose slot ids are readable — " +
          "a UI-raised order gives this; a person's API key does not"
      );
    }

    console.log("\n[2] sign TWO dummy workers onto it, leaving one slot empty");
    for (let i = 0; i < 2; i++) {
      const user_id = await dummyWorker(DUMMY[i]);
      const a = await raw("POST", "/attendance", [{ slot_id: mySlots[i], user_id }]);
      const aid = Number(a.data?.data?.[0]?.id);
      ok(a.status === 201 || a.status === 200, `worker ${user_id} attached to slot ${mySlots[i]}`, `${a.status} ${JSON.stringify(a.data).slice(0, 160)}`);
      if (Number.isInteger(aid)) attendanceIds.push(aid);
    }
    const before = await client.attendanceByTeam(order_id);
    ok((before.get(team.id) ?? 0) === 2, "the block reads back as carrying 2 people", JSON.stringify([...before]));

    console.log("\n[3] THE EXPERIMENT — shrink the block from 3 to 1 with 2 people on it");
    let patchStatus = 0, patchBody = "";
    const r = await raw("PATCH", "/slotTeams", [{ id: team.id, size: 1 }]);
    patchStatus = r.status;
    patchBody = JSON.stringify(r.data ?? null).slice(0, 300);
    console.log(`      PATCH /slotTeams -> ${patchStatus} ${patchBody}`);

    const after = await client.attendanceByTeam(order_id);
    const stillOn = after.get(team.id) ?? 0;
    const slotsAfter = await slotsByTeam(order_id);
    console.log(`      attendance on the block: 2 -> ${stillOn}`);
    console.log(`      slots recorded as created: ${JSON.stringify(slotsAfter.get(team.id) ?? [])}`);

    console.log("\n[4] the verdict");
    if (patchStatus === 400) {
      console.log("      OUTCOME A — OnSinch REFUSED the shrink. Nobody can be unbooked this way.");
      console.log("      => amendOrder.ts may allow a shrink down to the number signed on.");
    } else if (stillOn === 2) {
      console.log("      OUTCOME B — the shrink was accepted and BOTH people are still on it.");
      console.log("      => OnSinch drops empty slots first. A shrink to >= the signed-on count is safe.");
    } else {
      console.log(`      OUTCOME C — ${2 - stillOn} of 2 people were UNBOOKED, silently, on a ${patchStatus}.`);
      console.log("      => the refusal in amendOrder.ts stays, and this is why.");
    }
    ok(true, "measured", `PATCH ${patchStatus}, attendance 2 -> ${stillOn}`);

    // Audit rows are the second witness: an unbooking leaves attendance_delete behind.
    const au = await raw("GET", `/timelineAudits?limit=100&${encodeURIComponent("data[like]")}=${encodeURIComponent(`%Order:${order_id}%`)}`);
    const kinds = ((au.data?.data ?? []) as any[]).map((x) => x.action);
    const deletions = kinds.filter((k) => /delete/i.test(k));
    console.log(`      audit actions on this order: ${JSON.stringify([...new Set(kinds)])}`);
    console.log(`      deletion rows: ${deletions.length ? JSON.stringify(deletions) : "none"}`);

    console.log("\n[5] put it back to 3, so nothing is left shrunk if the delete fails");
    const restore = await raw("PATCH", "/slotTeams", [{ id: team.id, size: 3 }]);
    ok(restore.status === 204 || restore.status === 200, "restored", String(restore.status));
  } catch (err: any) {
    fails++;
    console.log(`  FAIL  threw: ${String(err?.message ?? err)}`);
  } finally {
    if (order_id && mine) {
      console.log(`\n[6] clean up: delete order #${order_id}`);
      try {
        await client.deleteOrders([order_id]);
        ok((await client.orderById(order_id)) === null, "deleted");
      } catch (err: any) {
        fails++;
        console.log(`  FAIL  could not delete order #${order_id} — DELETE IT BY HAND: ${String(err?.message ?? err)}`);
      }
    } else if (order_id) {
      console.log(`\n[6] order #${order_id} is YOURS — left alone. Delete it in the UI when you are done.`);
      note(`its crew block was restored to 3; ${attendanceIds.length} dummy attendance row(s) are still on it`);
    }
    // Deactivate the dummies rather than leave usable worker accounts lying around.
    for (const d of DUMMY) {
      const found = await raw("GET", `/workers?limit=100&surname=${encodeURIComponent(d.surname)}`);
      const hit = ((found.data?.data ?? []) as any[]).find((w) => w.surname === d.surname);
      if (hit?.id) {
        const p = await raw("PATCH", "/workers", [{ id: hit.id, status: 0 }]);
        note(`dummy worker ${hit.id} deactivated (${p.status})`);
      }
    }
  }
  console.log(`\n${fails === 0 ? "DONE" : `${fails} FAILURE(S)`}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
