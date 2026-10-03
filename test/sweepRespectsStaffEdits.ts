// ============================================================================
// THE SWEEP NEVER WRITES OVER A PERSON.
// ----------------------------------------------------------------------------
// Re-asserting exists to retry the engine's own write when OnSinch silently dropped it.
// It used to read every difference that way. Measured 2026-10-03: all 42 re-asserted
// orders that could still be read had been edited by staff, and R11312's PO, typed in
// by user 573 on 10-02 16:14, was replaced by the engine's at 10-03 13:00.
//
// The rule pinned here: the sweep writes only to an order that nobody but the engine
// has touched since the engine last wrote it. Every doubt resolves to "leave it".
//
// Run: npx tsx test/sweepRespectsStaffEdits.ts
// ============================================================================
import { reconcileThread, __resetApiUser } from "../app/lib/engine/sweep";
import { staffChangeSince } from "../app/lib/engine/reconcile";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationState, DesiredOrder } from "../app/lib/engine/types";
import type { PipelineDeps } from "../app/lib/engine/pipeline";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const ENGINE = 2257;
const STAFF = 573;
const TODAY = "2026-09-14T09:00:00Z";
const DAY = "2026-09-20";
const ORDER = 15998;
const TEAM = 40988;
const WROTE = Date.parse("2026-09-14T08:00:00Z");
const BEFORE = "2026-09-14T07:00:00+00:00";
const AFTER = "2026-09-14T08:30:00+00:00";

const desired = (): DesiredOrder =>
  ({
    company_id: 42,
    pricelist_category_id: 197,
    intern_name: "PO-ENGINE",
    slot_teams: [
      { name: "General", size: 4, profession_id: 1, place_id: 16689, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00` },
    ],
  }) as unknown as DesiredOrder;

const bound = (log: ConversationState["order_action_log"]): ConversationState =>
  ({
    thread_id: "T-staff",
    subject: "Re: Crew for the 20th",
    status: "ordered",
    needs_human: false,
    notes: [],
    order_action_log: log,
    company_id: 42,
    place_id: 16689,
    onsinch_order_id: ORDER,
    onsinch_order_number: "10998",
    onsinch_job_id: 16055,
    desired_order: desired(),
    last_ordered_teams: desired().slot_teams,
    last_ordered_team_ids: [TEAM],
    facts: { requests: [{ date: DAY, start_time: "09:30", end_time: "14:00", size: 4 }], location_text: "HQ" },
  }) as unknown as ConversationState;

const engineWrote = [{ ts: WROTE, kind: "create" as const, order_id: ORDER, ok: true }];

/** The order as OnSinch holds it: crew cut to 2 and the PO retyped, by whoever `who` says. */
function order(who: { order?: [number, string]; team?: [number, string] }) {
  return {
    id: ORDER,
    number: "10998",
    happening: `${DAY}T09:30:00+00:00`,
    intern_name: "PO-STAFF",
    ...(who.order ? { modifier: who.order[0], modified: who.order[1] } : { modifier: ENGINE, modified: "2026-09-14T08:00:05+00:00" }),
    Job: [{
      id: 16055,
      modifier: ENGINE,
      modified: "2026-09-14T08:00:05+00:00",
      min_beginning: `${DAY}T09:30:00+00:00`,
      max_end: `${DAY}T14:00:00+00:00`,
      SlotTeam: [{
        id: TEAM,
        name: "General",
        ...(who.team ? { modifier: who.team[0], modified: who.team[1] } : { modifier: ENGINE, modified: "2026-09-14T08:00:05+00:00" }),
        Slot: [{ size: 2, role: 0, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00`, profession_id: 1, modified: AFTER }],
      }],
    }],
  };
}

function deps(o: any, opts: { profile?: boolean } = {}) {
  const writes: string[] = [];
  __resetApiUser();
  const onsinch = new OnsinchClient(async (method, path) => {
    const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
    if (method !== "GET") {
      writes.push(`${method} ${path}`);
      return { status: 204, data: null };
    }
    if (path.startsWith("/users/profile")) return opts.profile === false ? { status: 500, data: null } : { status: 200 as const, data: { data: { id: ENGINE } } };
    if (path.startsWith("/orders")) return page([o]);
    if (path.startsWith("/attendance")) {
      return page([{ Slot: [{ slotteam_id: TEAM, size: 2, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00`, slotlocation_id: 16689, profession_id: 1, name: "" }], SlotTeam: [{ id: TEAM, name: "General" }] }]);
    }
    return page([]);
  });
  const d = {
    onsinch,
    now: () => WROTE + 3_600_000,
    store: { get: async () => undefined, put: async () => {}, all: async () => [] },
    executor: {
      async patchOrder(p: any) { writes.push(`patchOrder #${p.order_id}`); return ["intern_name"]; },
      async amendOrderInPlace(p: any) { writes.push(`amend #${p.order_id}`); return { amended: { order_id: p.order_id, patched: 1, added: [], job_id: 16055 } }; },
    },
  } as unknown as PipelineDeps;
  return { d, writes };
}

(async () => {
  console.log("\n[1] nobody but the engine has touched it since the write: the dropped write is retried");
  {
    const { d, writes } = deps(order({}));
    const r = await reconcileThread(bound(engineWrote), d, { todayISO: TODAY });
    ok(r.action === "reasserted", "re-asserted, as before", r.action);
    ok(writes.length > 0, "and the retry was sent", JSON.stringify(writes));
  }

  console.log("\n[2] staff changed the order itself after the engine wrote it: nothing is written");
  {
    const s = bound(engineWrote);
    const { d, writes } = deps(order({ order: [STAFF, AFTER] }));
    const r = await reconcileThread(s, d, { todayISO: TODAY });
    ok(r.action === "staff-changed", "reported as the person's change", r.action);
    ok(writes.length === 0, "and OnSinch was not written", JSON.stringify(writes));
    ok(String(r.detail).includes(`user ${STAFF}`), "it names who changed it", String(r.detail));
    ok(s.needs_human === false, "and raises no Needs label: the person has decided");
    ok(s.reconcile === undefined, "and no attempt is counted towards giving up");
  }

  console.log("\n[3] staff changed a crew block after the engine wrote it: nothing is written");
  {
    const { d, writes } = deps(order({ team: [1164, AFTER] }));
    const r = await reconcileThread(bound(engineWrote), d, { todayISO: TODAY });
    ok(r.action === "staff-changed", "reported as the person's change", r.action);
    ok(writes.length === 0, "and OnSinch was not written", JSON.stringify(writes));
  }

  console.log("\n[4] a staff edit from BEFORE the engine's last write does not stop the retry");
  {
    // The engine's write came later and is the one that should be there; a person's
    // earlier stamp on a record the engine did not touch says nothing about it.
    const { d, writes } = deps(order({ team: [1164, BEFORE] }));
    const r = await reconcileThread(bound(engineWrote), d, { todayISO: TODAY });
    ok(r.action === "reasserted", "re-asserted", r.action);
    ok(writes.length > 0, "and sent", JSON.stringify(writes));
  }

  console.log("\n[5] the engine never wrote this order (R11312: staff raised it by copy): nothing is written");
  {
    const { d, writes } = deps(order({}));
    const r = await reconcileThread(bound([]), d, { todayISO: TODAY });
    ok(r.action === "staff-changed", "left alone", r.action);
    ok(writes.length === 0, "and OnSinch was not written", JSON.stringify(writes));
  }

  console.log("\n[6] a failed write is not an engine write");
  {
    const { d, writes } = deps(order({}));
    const r = await reconcileThread(bound([{ ts: WROTE, kind: "amend", order_id: ORDER, ok: false }]), d, { todayISO: TODAY });
    ok(r.action === "staff-changed" && writes.length === 0, "left alone", `${r.action} ${JSON.stringify(writes)}`);
  }

  console.log("\n[7] the engine's own user cannot be read: nothing is written");
  {
    const { d, writes } = deps(order({}), { profile: false });
    const r = await reconcileThread(bound(engineWrote), d, { todayISO: TODAY });
    ok(r.action === "staff-changed" && writes.length === 0, "left alone", `${r.action} ${JSON.stringify(writes)}`);
  }

  console.log("\n[8] staffChangeSince ignores the Slot's own timestamp, which crew sign-on moves");
  {
    ok(staffChangeSince(order({}), WROTE, ENGINE) === null, "a slot modified after the write, with nobody else stamped, is not a staff change");
    ok(staffChangeSince(order({ order: [ENGINE, AFTER] }), WROTE, ENGINE) === null, "the engine's own later stamp is not a staff change");
    ok(staffChangeSince(order({ order: [STAFF, AFTER] }), WROTE, ENGINE)?.startsWith("the order by user 573") === true, "a person's later stamp is");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nall pass");
  process.exit(fails ? 1 : 0);
})();
