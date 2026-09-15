// ============================================================================
// THE SWEEP — the only thing that looks at a booking nobody is emailing about.
// ----------------------------------------------------------------------------
// Before this, the engine read a thread only when mail arrived in it. Lead time from
// writing an order to the job happening is a median of 7 days and a p90 of 199, so a
// booking spends most of its life with nobody asking after it — and a write that silently
// did nothing had no second moment at which it could be noticed.
//
// Three questions per thread, and the order matters: an order that is gone cannot drift,
// and drift on an order that was never ours is not ours to correct.
//
//   1. is it still there
//   2. if not, what did it become
//   3. if it is, does it hold what the thread asks for
//
// Every branch here either changes nothing or moves the order towards the shape the client
// asked for. The cases that change nothing are the ones worth testing hardest, because
// each of them is a read that LOOKS like evidence and is not.
//
// Run: npx tsx test/sweepReconciles.ts
// ============================================================================
import { reconcileThread, sweepAll } from "../app/lib/engine/sweep";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationState, DesiredOrder } from "../app/lib/engine/types";
import type { PipelineDeps } from "../app/lib/engine/pipeline";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const TODAY = "2026-09-14T09:00:00Z";
const DAY = "2026-09-20";
const ORDER = 15998;
const TEAM = 40988;

const desired = (over: Partial<{ size: number; end: string }> = {}): DesiredOrder =>
  ({
    company_id: 42,
    pricelist_category_id: 197,
    slot_teams: [
      {
        name: "General",
        size: over.size ?? 4,
        profession_id: 1,
        place_id: 16689,
        beginning: `${DAY}T09:30:00+00:00`,
        end: over.end ?? `${DAY}T14:00:00+00:00`,
      },
    ],
  }) as unknown as DesiredOrder;

const stateBound = (over: Partial<ConversationState> = {}): ConversationState =>
  ({
    thread_id: "T-sweep",
    subject: "Re: Crew for the 20th",
    status: "ordered",
    needs_human: false,
    notes: [],
    order_action_log: [],
    company_id: 42,
    place_id: 16689,
    onsinch_order_id: ORDER,
    onsinch_order_number: "10998",
    onsinch_job_id: 16055,
    desired_order: desired(),
    last_ordered_teams: desired().slot_teams,
    last_ordered_team_ids: [TEAM],
    facts: { requests: [{ date: DAY, start_time: "09:30", end_time: "14:00", size: 4 }], location_text: "HQ" },
    ...over,
  }) as unknown as ConversationState;

/**
 * `orders` is what the tenant holds. An order absent from it is deleted; an EMPTY list is
 * the API failing to answer, and the two must never be read the same way.
 */
function fakeDeps(opts: {
  orders?: any[];
  slot?: { size: number; beginning: string; end: string; slotlocation_id: number; profession_id: number };
  writes?: string[];
}) {
  const writes = opts.writes ?? [];
  const onsinch = new OnsinchClient(async (method, path) => {
    const page = (data: unknown[]) => ({
      status: 200 as const,
      data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } },
    });
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/orders")) {
      const all = opts.orders ?? [];
      const m = /[?&]id(?:\[eq\])?=(\d+)/.exec(path);
      return page(m ? all.filter((o) => Number(o.id) === Number(m[1])) : all);
    }
    if (path.startsWith("/attendance")) {
      if (!opts.slot) return page([]);
      return page([{ Slot: [{ slotteam_id: TEAM, ...opts.slot, name: "" }], SlotTeam: [{ id: TEAM, name: "General" }] }]);
    }
    return page([]);
  });
  const deps = {
    onsinch,
    now: () => 1,
    store: { get: async () => undefined, put: async () => {}, all: async () => [] },
    executor: {
      async patchOrder(p: any) {
        writes.push(`patchOrder #${p.order_id}`);
        return ["intern_name"];
      },
      async amendOrderInPlace(p: any) {
        writes.push(`amend #${p.order_id}`);
        return { amended: { order_id: p.order_id, patched: 1, added: [], job_id: 16055 } };
      },
    },
  } as unknown as PipelineDeps;
  return { deps, writes };
}

/** The order as OnSinch holds it when nothing is wrong. */
const LIVE_ORDER = {
  id: ORDER,
  number: "10998",
  happening: `${DAY}T09:30:00+00:00`,
  Job: [{ id: 16055, min_beginning: `${DAY}T09:30:00+00:00`, max_end: `${DAY}T14:00:00+00:00` }],
};
const HELD = { size: 4, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00`, slotlocation_id: 16689, profession_id: 1 };

(async () => {
  console.log("\n[1] the order holds what the thread asks for — nothing is written");
  {
    const { deps, writes } = fakeDeps({ orders: [LIVE_ORDER], slot: HELD });
    const r = await reconcileThread(stateBound(), deps, { todayISO: TODAY });
    ok(r.action === "holds", "reported as holding", r.action);
    ok(writes.length === 0, "and NOTHING was sent — a healthy sweep is a read-only sweep", JSON.stringify(writes));
  }

  console.log("\n[2] the crew was cut underneath us — the desired shape is re-asserted");
  {
    const { deps, writes } = fakeDeps({ orders: [LIVE_ORDER], slot: { ...HELD, size: 2 } });
    const s = stateBound();
    const r = await reconcileThread(s, deps, { todayISO: TODAY });
    ok(r.action === "reasserted", "reported as re-asserted", r.action);
    ok(writes.some((w) => w.startsWith("amend")), "the crew blocks were sent again", JSON.stringify(writes));
    ok(s.reconcile?.attempts === 1, "and the first attempt is counted", String(s.reconcile?.attempts));
    ok((s.notes ?? []).some((n) => n.includes("did not hold")), "and said what differed", JSON.stringify(s.notes.slice(-1)));
  }

  console.log("\n[3] the same difference four times becomes a dead end, not a loop");
  {
    // Re-asserting is right until the write is one OnSinch will never take. Past the
    // ceiling it costs two reads and a write every sweep for the life of the thread and
    // hides the failure behind a record that looks healthy.
    const s = stateBound();
    const seen: string[] = [];
    for (let pass = 1; pass <= 5; pass++) {
      const { deps } = fakeDeps({ orders: [LIVE_ORDER], slot: { ...HELD, size: 2 } });
      seen.push((await reconcileThread(s, deps, { todayISO: TODAY })).action);
    }
    ok(seen.slice(0, 3).every((a) => a === "reasserted"), "three attempts are made", seen.join(","));
    ok(seen[3] === "unreconciled", "the fourth gives up", seen[3]);
    ok(seen[4] === "skipped", "and the fifth does not even read it", seen[4]);
    ok(s.needs_human === true, "the thread is marked — which is what puts the label on it");
    ok((s.notes ?? []).some((n) => n.includes("has not taken this change")), "and says so once", JSON.stringify(s.notes.slice(-1)));
  }

  console.log("\n[4] the order was deleted and staff raised their own — the thread follows it");
  {
    // Ben, Q3: "if it doesnt exist anymore, look for it again, exact matches should create
    // the ammendment." Staff delete our To Confirm orders in sweeps — 49 deletions across
    // 31 sittings — and the job they raise in its place is the one ops work from.
    const successor = {
      id: 16010,
      number: "11010",
      happening: `${DAY}T09:30:00+00:00`,
      name: "RG Jones @ HQ",
      Job: [{ id: 16070 }],
    };
    const { deps } = fakeDeps({ orders: [successor] });
    const s = stateBound();
    const r = await reconcileThread(s, deps, { todayISO: TODAY });
    ok(r.action === "rebound", "reported as rebound", r.action);
    ok(Number(s.onsinch_order_id) === 16010, "the thread now points at the successor", String(s.onsinch_order_id));
    ok(s.onsinch_order_number === "11010", "and carries its R number", String(s.onsinch_order_number));
    /**
     * The ids we held belonged to the order that is gone. Keeping them would let the next
     * amendment PATCH the successor's blocks by position — which is how one block's times
     * get written onto another.
     */
    ok(s.last_ordered_team_ids === undefined, "and the dead order's block ids are dropped");
    ok(s.last_ordered_teams === undefined, "along with the shape they corresponded to");
  }

  console.log("\n[5] deleted with nothing to replace it — recorded, never guessed at");
  {
    const other = { id: 16011, number: "11011", happening: "2026-12-01T09:30:00+00:00", name: "RG Jones @ Elsewhere", Job: [{ id: 16071 }] };
    const { deps } = fakeDeps({ orders: [other] });
    const s = stateBound();
    const r = await reconcileThread(s, deps, { todayISO: TODAY });
    ok(r.action === "lost", "reported as lost", r.action);
    ok(s.onsinch_order_id === undefined, "the thread stops claiming a booking that does not exist");
    ok(s.needs_human === true, "and is marked, which is what takes the Order Built tag off it");
  }

  console.log("\n[6] AN EMPTY ANSWER IS NOT A DELETED ORDER");
  {
    // The failure mode this whole engine keeps hitting: an unsupported filter returns an
    // empty list rather than an error. Without the control, a bad API day would unbind
    // every thread in the system and mark every booking lost.
    const { deps, writes } = fakeDeps({ orders: [] });
    const s = stateBound();
    const r = await reconcileThread(s, deps, { todayISO: TODAY });
    ok(r.action === "skipped", "an empty client list decides nothing", `${r.action}: ${r.detail}`);
    ok(Number(s.onsinch_order_id) === ORDER, "the binding is untouched", String(s.onsinch_order_id));
    ok(writes.length === 0, "and nothing was written");
  }

  console.log("\n[7] the things a sweep must leave alone");
  {
    const past = stateBound({
      desired_order: { ...desired(), slot_teams: [{ ...desired().slot_teams[0], beginning: "2026-08-01T09:30:00+00:00", end: "2026-08-01T14:00:00+00:00" }] } as DesiredOrder,
    });
    const { deps: d1, writes: w1 } = fakeDeps({ orders: [LIVE_ORDER], slot: { ...HELD, size: 2 } });
    const r1 = await reconcileThread(past, d1, { todayISO: TODAY });
    ok(r1.action === "skipped" && /past/.test(String(r1.detail)), "a job that already happened is never corrected", String(r1.detail));
    ok(w1.length === 0, "and nothing was sent to it");

    const noShape = stateBound({ desired_order: undefined, last_ordered_teams: undefined });
    const { deps: d2 } = fakeDeps({ orders: [LIVE_ORDER], slot: HELD });
    const r2 = await reconcileThread(noShape, d2, { todayISO: TODAY });
    ok(r2.action === "skipped", "a thread with no recorded shape has nothing to reconcile towards", String(r2.detail));

    /**
     * But `desired_order` alone being absent is NOT that case, and 171 of 267 live
     * bindings are exactly this: the compiler overwrote the field with null on every pass
     * that composed nothing — most messages in a booked thread — while the block set sat
     * untouched in `last_ordered_teams` beside it. The compiler now carries it forward;
     * those rows are already written, and without the fallback none of them could ever be
     * reconciled.
     */
    const { deps: d4, writes: w4 } = fakeDeps({ orders: [LIVE_ORDER], slot: { ...HELD, size: 2 } });
    const onlyLastOrdered = stateBound({ desired_order: undefined });
    const r4 = await reconcileThread(onlyLastOrdered, d4, { todayISO: TODAY });
    ok(r4.action === "reasserted", "a row holding only last_ordered_teams still reconciles", r4.action);
    ok(w4.some((w) => w.startsWith("amend")), "and the blocks were re-sent", JSON.stringify(w4));

    // A block ops added by hand is not ours. We hold no id for it, so it contributes no
    // drift — the same rule that makes planAmendment decline.
    const { deps: d3, writes: w3 } = fakeDeps({ orders: [LIVE_ORDER], slot: { ...HELD, size: 99 } });
    const notOurs = stateBound({ last_ordered_team_ids: [999999] });
    const r3 = await reconcileThread(notOurs, d3, { todayISO: TODAY });
    ok(r3.action === "holds", "a block we never wrote is left alone", r3.action);
    ok(w3.length === 0, "and nothing was sent");
  }

  console.log("\n[8] one thread's failure does not end the sweep");
  {
    const { deps } = fakeDeps({ orders: [LIVE_ORDER], slot: HELD });
    const exploding = stateBound({ thread_id: "T-boom" });
    Object.defineProperty(exploding, "desired_order", {
      get() {
        throw new Error("state row is corrupt");
      },
    });
    const { swept, outcomes } = await sweepAll([exploding, stateBound({ thread_id: "T-fine" })], deps, { todayISO: TODAY });
    ok(swept === 2, "both threads were attempted", String(swept));
    ok(outcomes[0].action === "error", "the broken one is recorded as an error", outcomes[0].action);
    ok(outcomes[1].action === "holds", "and the next one still ran", outcomes[1].action);
  }

  console.log("\n[9] the limit counts threads that COST a read, not threads visited");
  {
    /**
     * Why this matters more than it looks. The store returns threads most-recently-updated
     * first, and 219 of the 287 live bindings are decided from the state row alone — no
     * desired shape, or the job is already past — without touching OnSinch. When those
     * counted against the limit, a scheduled run of 40 spent its entire budget on rows it
     * never read, stopped, and came back to the same 40 next time. The bookings it could
     * never reach were the quiet ones, which are the only ones this sweep is watching.
     */
    const { deps } = fakeDeps({ orders: [LIVE_ORDER], slot: HELD });
    // Twelve rows with nothing to reconcile, then two real ones behind them.
    const free = Array.from({ length: 12 }, (_, i) => {
      const s = stateBound({ thread_id: `T-free-${i}` });
      s.desired_order = null;
      s.last_ordered_teams = undefined;
      return s;
    });
    const real = [stateBound({ thread_id: "T-real-1" }), stateBound({ thread_id: "T-real-2" })];
    const { swept, outcomes } = await sweepAll([...free, ...real], deps, { todayISO: TODAY, limit: 2 });
    ok(swept === 2, "the budget is spent on the two that needed reading", String(swept));
    ok(outcomes.length === 14, "and every free row was still visited", String(outcomes.length));
    ok(
      outcomes.filter((o) => o.action !== "skipped").map((o) => o.thread_id).join(",") === "T-real-1,T-real-2",
      "so a limit smaller than the free head still reaches the threads behind it"
    );
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
