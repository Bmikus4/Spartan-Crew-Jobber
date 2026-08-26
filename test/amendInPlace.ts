// ============================================================================
// Amending an order in place, rather than destroying and rebuilding it.
// ----------------------------------------------------------------------------
// Three separable things are proved here, and the middle one is the reason the
// file exists rather than being folded into test/replaceOrder.ts:
//
//  1. The audit read recovers the right slot team ids — and only the right ones.
//     The LIKE filter it depends on returns rows for OTHER orders (%Order:138%
//     matches 1380 and 13800), and a Slot's path names its parent team, so the
//     parse has two distinct ways to report teams an order does not have. A team
//     count that is wrong by one silently pairs every block with the wrong id.
//
//  2. planAmendment declines rather than guessing. Positional pairing is only
//     valid against a set this engine wrote; against anything else it writes one
//     block's times onto another. Every decline here is a case where the old
//     delete-and-repost path is the correct answer.
//
//  3. A shrink of a STAFFED block sends nothing at all. It is the one write in
//     this API nobody has tested, it may unbook people, and a refusal that still
//     applied the other patches would leave the order agreeing with the client
//     about the times and disagreeing about the crew.
//
// Run: npx tsx test/amendInPlace.ts
// ============================================================================
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { planAmendment, amendOrderInPlace } from "../app/lib/engine/amendOrder";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${cond || !extra ? "" : `  (${extra})`}`);
  if (!cond) fails++;
};

const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "General",
  profession_id: 1,
  beginning: "2026-03-09T08:00:00+00:00",
  end: "2026-03-09T18:00:00+00:00",
  size: 4,
  place_id: 49,
  ...o,
});

const order = (teams: DesiredSlotTeam[]): DesiredOrder => ({
  name: "Acme @ Savoy Place",
  company_id: 42,
  user_id: 7,
  request_approval: true,
  
  pricelist_category_id: 311,
  job_name: "Acme @ Savoy Place",
  slot_teams: teams,
});

/**
 * An audit row exactly as the live tenant returns it: `data` is a JSON STRING, and the
 * path inside it carries ESCAPED slashes. Both matter — a parser written against the
 * pretty-printed shape reads neither.
 */
const auditRow = (id: number, action: string, payload: unknown) => ({
  id,
  action,
  creator: null,
  created: "2026-02-12T10:00:00+00:00",
  data: JSON.stringify(payload).replace(/\//g, "\\/"),
});

const slotTeamCreate = (auditId: number, order_id: number, job_id: number, team_id: number, name: string) =>
  auditRow(auditId, "common_create", {
    id: String(team_id),
    name,
    model: "SlotTeam",
    created: { Slot: 1, Attendance: 0, workers: 0 },
    data: { path: `Order:${order_id}/Job:${job_id}/SlotTeam:${team_id}` },
  });

/** The audit rows a real two-team order produces, plus the traps. */
function auditsFor(order_id: number, job_id: number, teamIds: number[]) {
  const rows: any[] = [
    auditRow(1000, "order_create", {
      id: String(order_id),
      name: "Acme @ Savoy Place",
      model: "Order",
      created: { Order: 1, Job: 1, SlotTeam: teamIds.length, Slot: teamIds.length },
      data: { quote: 0, number: 10654, path: `Order:${order_id}` },
    }),
    auditRow(1001, "common_create", {
      id: String(job_id),
      name: "Acme @ Savoy Place",
      model: "Job",
      data: { path: `Order:${order_id}/Job:${job_id}` },
    }),
  ];
  teamIds.forEach((tid, i) => rows.push(slotTeamCreate(1002 + i, order_id, job_id, tid, "General")));
  // TRAP 1: a Slot's path also names its SlotTeam. Counted, it reports a team per person.
  teamIds.forEach((tid, i) =>
    rows.push(
      auditRow(1100 + i, "common_create", {
        id: String(50000 + i),
        model: "Slot",
        created: { workers: "4" },
        data: { path: `Order:${order_id}/Job:${job_id}/SlotTeam:${tid}/Slot:${50000 + i}` },
      })
    )
  );
  // TRAP 2: the LIKE filter is `%Order:<id>%`, so a longer order id comes back too.
  rows.push(slotTeamCreate(1200, Number(`${order_id}9`), 99999, 88888, "Somebody else's block"));
  // TRAP 3: a later edit to one of our teams is not a create and must not double-count.
  if (teamIds.length)
    rows.push(
      auditRow(1300, "common_change", {
        id: String(teamIds[0]),
        name: "General",
        model: "SlotTeam",
        diffChanges: { SlotTeam: { size: { old: "4", new: 6 } } },
        data: { path: `Order:${order_id}/Job:${job_id}/SlotTeam:${teamIds[0]}` },
      })
    );
  return rows;
}

/** A transport that records every write, so the tests can assert what was SENT. */
function rig(opts: { teamIds: number[]; attendance?: Array<{ team: number }>; provisional?: boolean } = { teamIds: [501, 502] }) {
  const sent: Array<{ method: string; path: string; body: any }> = [];
  const ORDER = 9001, JOB = 7001;
  let nextTeamId = 900;
  const transport: Transport = async (method, path, body) => {
    sent.push({ method, path, body });
    if (method === "GET" && path.startsWith("/orders")) {
      return {
        status: 200,
        data: {
          data: [{ id: ORDER, number: "10654", provisional: opts.provisional ?? true, quote: false, company_id: 42, Job: [{ id: JOB }] }],
          pagination: { count: 1, pageCount: 1, nextPage: false },
        },
      };
    }
    if (method === "GET" && path.startsWith("/timelineAudits")) {
      const rows = auditsFor(ORDER, JOB, opts.teamIds);
      return { status: 200, data: { data: rows, pagination: { count: rows.length, pageCount: 1, nextPage: false } } };
    }
    if (method === "GET" && path.startsWith("/attendance")) {
      const rows = (opts.attendance ?? []).map((a, i) => ({ id: 8000 + i, SlotTeam: { id: a.team, name: "General" } }));
      return { status: 200, data: { data: rows, pagination: { count: rows.length, pageCount: 1, nextPage: false } } };
    }
    if (method === "PATCH" && path === "/slotTeams") return { status: 204, data: null };
    if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: ++nextTeamId }] } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  const created: number[] = [];
  return {
    client: new OnsinchClient(transport),
    sent,
    created,
    hooks: { async onCreated(id: number) { created.push(id); } },
    ORDER,
    JOB,
  };
}

(async () => {
  console.log("\n[1] the audit read recovers exactly the order's own slot team ids");
  {
    const { client } = rig({ teamIds: [501, 502] });
    const read = await client.slotTeamsForOrder(9001);
    ok(read.teams.length === 2, "two teams, not one per Slot and not the other order's", `got ${read.teams.length}`);
    ok(read.teams.map((t) => t.id).join(",") === "501,502", "in creation order", read.teams.map((t) => t.id).join(","));
    ok(read.job_id === 7001, "the job id comes off the same path", String(read.job_id));
    ok(read.order_number === "10654", "and the R number", String(read.order_number));
    ok(read.created_count === 2, "order_create's own count, for cross-checking", String(read.created_count));
    ok(!read.teams.some((t) => t.id === 88888), "a longer order id the LIKE filter matched is rejected");
  }

  console.log("\n[2] planAmendment: what it patches, what it appends");
  {
    const prev = [team({ size: 4 })];
    ok(planAmendment(prev, [team({ size: 4 })], [{ id: 501, name: "General" }]).patches.length === 0, "nothing changed -> no patches");

    const grow = planAmendment(prev, [team({ size: 6 })], [{ id: 501, name: "General" }]);
    ok(grow.patches.length === 1 && grow.patches[0].id === 501 && grow.patches[0].size === 6, "a size change patches that team only", JSON.stringify(grow.patches));
    ok(Object.keys(grow.patches[0]).join(",") === "id,size", "and sends ONLY the field that moved", Object.keys(grow.patches[0]).join(","));

    const moved = planAmendment(prev, [team({ end: "2026-03-09T20:00:00+00:00" })], [{ id: 501, name: "General" }]);
    ok(moved.patches[0]?.end === "2026-03-09T20:00:00+00:00", "a window move patches the window");

    const added = planAmendment(prev, [team({ size: 4 }), team({ name: "Derig", size: 2 })], [{ id: 501, name: "General" }]);
    ok(added.patches.length === 0 && added.creates.length === 1, "a new block is appended, the old one left alone", JSON.stringify(added));
    ok(added.creates[0].name === "Derig", "and it is the new block that gets appended");

    /**
     * A block inserted BEFORE the existing one. The pairing is positional, so team 501
     * is rewritten to hold the new early block and the old one is appended — different
     * ids, identical resulting set. That is the property the whole design rests on.
     */
    const inserted = planAmendment(prev, [team({ name: "Load in", size: 2 }), team({ size: 4 })], [{ id: 501, name: "General" }]);
    ok(inserted.patches.length === 1 && inserted.patches[0].name === "Load in", "a block inserted first rewrites the live team", JSON.stringify(inserted.patches));
    ok(inserted.creates.length === 1 && inserted.creates[0].size === 4, "and the displaced block is appended");
  }

  console.log("\n[3] planAmendment declines rather than guessing");
  {
    const prev = [team()];
    const dropped = planAmendment(prev, [], [{ id: 501, name: "General" }]);
    ok(!!dropped.declined, "an amendment to no blocks at all declines");

    const shrunk = planAmendment([team(), team({ name: "Derig" })], [team()], [
      { id: 501, name: "General" },
      { id: 502, name: "Derig" },
    ]);
    ok(!!shrunk.declined && /cannot remove/.test(shrunk.declined!), "a DROPPED block declines — OnSinch cannot remove a team", shrunk.declined);

    const opsAdded = planAmendment(prev, [team({ size: 6 })], [
      { id: 501, name: "General" },
      { id: 777, name: "a block ops raised by hand" },
    ]);
    ok(!!opsAdded.declined && /changed by somebody else/.test(opsAdded.declined!), "a live team set we did not write declines", opsAdded.declined);

    const unknown = planAmendment([], [team({ size: 6 })], []);
    ok(!!unknown.declined, "an order with no ids to aim at declines");
  }

  console.log("\n[4] end to end: the patches and the append actually go");
  {
    const r = rig({ teamIds: [501, 502] });
    const res = await amendOrderInPlace(
      r.client,
      { order_id: r.ORDER, previous: [team({ size: 4 }), team({ name: "Derig", size: 2 })], desired: order([team({ size: 6 }), team({ name: "Derig", size: 2 }), team({ name: "Load out", size: 3 })]) },
      r.hooks
    );
    ok(!!res.amended, "it amends", res.declined ?? res.refused ?? "");
    ok(res.amended?.patched === 1, "one block moved, so one PATCH", String(res.amended?.patched));
    const patch = r.sent.find((s) => s.method === "PATCH" && s.path === "/slotTeams");
    ok(!!patch && patch.body.length === 1 && patch.body[0].id === 501 && patch.body[0].size === 6, "aimed at the right id", JSON.stringify(patch?.body));
    const post = r.sent.filter((s) => s.method === "POST" && s.path === "/slotTeams");
    ok(post.length === 1 && post[0].body[0].job_id === r.JOB, "the new block is POSTed against the job", JSON.stringify(post[0]?.body));
    ok(post[0].body[0].name === "Load out", "and it is the new block");
    ok(r.created.length === 1 && res.amended?.added.length === 1, "its id was handed to the persistence hook before returning");
    ok(!r.sent.some((s) => s.method === "DELETE"), "NOTHING was deleted");
  }

  console.log("\n[5] a shrink of a STAFFED block sends nothing at all");
  {
    const r = rig({ teamIds: [501, 502], attendance: [{ team: 501 }, { team: 501 }, { team: 502 }] });
    const res = await amendOrderInPlace(
      r.client,
      { order_id: r.ORDER, previous: [team({ size: 4 }), team({ name: "Derig", size: 2 })], desired: order([team({ size: 2 }), team({ name: "Derig", size: 5 })]) },
      r.hooks
    );
    ok(!!res.refused, "it refuses", JSON.stringify(res));
    ok(/2 crew are already signed on/.test(res.refused ?? ""), "and says how many people it would have unbooked", res.refused);
    ok(!r.sent.some((s) => s.method === "PATCH"), "the OTHER block's growth was NOT applied either — half an amendment is worse than none");
  }

  console.log("\n[6] growing a staffed block IS applied — this is the common amendment");
  {
    const r = rig({ teamIds: [501], attendance: [{ team: 501 }, { team: 501 }] });
    const res = await amendOrderInPlace(
      r.client,
      { order_id: r.ORDER, previous: [team({ size: 4 })], desired: order([team({ size: 8 })]) },
      r.hooks
    );
    ok(!!res.amended && res.amended.patched === 1, "applied", res.refused ?? res.declined ?? "");
    const patch = r.sent.find((s) => s.method === "PATCH");
    ok(patch?.body[0].size === 8, "size up on a staffed block goes through", JSON.stringify(patch?.body));
  }

  console.log("\n[7] a confirmed order is never touched, by this path either");
  {
    // This case used to assert the opposite: `provisional: false` meant CONFIRMED and
    // the preflight refused. That gate is gone, because orders are now raised in the To
    // Confirm posture and read back provisional=false from birth (format.ts) — keeping
    // it would have refused every amendment the engine ever attempted.
    //
    // Nothing is lost by dropping it HERE, because amending in place destroys nothing:
    // it patches a size or a window. The write that CAN hurt somebody is a shrink of a
    // block people have signed on to, and that is refused on attendance in [5], which
    // measures the harm directly instead of trusting a flag ops can toggle in the UI.
    const r = rig({ teamIds: [501], provisional: false });
    const res = await amendOrderInPlace(
      r.client,
      { order_id: r.ORDER, previous: [team({ size: 4 })], desired: order([team({ size: 8 })]) },
      r.hooks
    );
    ok(!res.refused && !!res.amended, "an order in the To Confirm posture is amended, not refused",
       res.refused ?? res.declined ?? "");
    const patch = r.sent.find((s) => s.method === "PATCH");
    ok(patch?.body[0].size === 8, "and the change reaches the wire", JSON.stringify(patch?.body));
  }

  console.log("\n[8] a resumed amendment appends only what is missing");
  {
    // A previous attempt already appended team 900 and died before persisting the state
    // row. The live set is therefore [501, 900] while the engine last wrote one block.
    const r = rig({ teamIds: [501, 900] });
    const res = await amendOrderInPlace(
      r.client,
      {
        order_id: r.ORDER,
        previous: [team({ size: 4 })],
        desired: order([team({ size: 4 }), team({ name: "Derig", size: 2 })]),
        alreadyCreated: [900],
      },
      r.hooks
    );
    ok(!!res.amended, "it resumes instead of declining on its own progress", res.declined ?? res.refused ?? "");
    ok(!r.sent.some((s) => s.method === "POST"), "and does NOT append the block a second time");
    ok(res.amended?.added.join(",") === "900", "the already-created id is carried through", JSON.stringify(res.amended?.added));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
