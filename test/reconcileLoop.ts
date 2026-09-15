// ============================================================================
// THE DESIRED SHAPE IS RE-ASSERTED UNTIL ONSINCH HOLDS IT.
// ----------------------------------------------------------------------------
// The engine cannot verify its own writes. An API write leaves NO audit row — measured on
// TEST company 515, 2026-09-13: a run that appended a block, moved windows, resized up and
// down and changed venue, profession and name produced three `order_created_via_api` rows
// and nothing else, while the Job window demonstrably moved. So a PATCH that returns 2xx
// and does nothing is indistinguishable from one that worked.
//
// That is fatal to the old gate. `teamsChanged` compares what we want against WHAT WE LAST
// WROTE, and that record is updated the moment the PATCH returns — so a silent no-op puts
// the two in agreement and the gate closes forever. The client's change never lands and
// nothing anywhere says so.
//
// The replacement asks a different question, and asks it fresh every pass: does OnSinch
// hold what we want? Two things have to hold for that to be safe rather than merely
// different:
//
//   1. drift re-asserts, and a correct order is left alone — otherwise the loop re-posts
//      the whole shape against every order, on every sweep, forever;
//   2. an UNREADABLE order is not a drifted one. This API answers a bad filter with an
//      empty list, and "nobody is signed on" returns the same empty list, so a failed read
//      must change nothing.
//
// Run: npx tsx test/reconcileLoop.ts
// ============================================================================
import { readLiveShape, driftAgainst, driftKey } from "../app/lib/engine/reconcile";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const ORDER = 15998;
const TEAM = 40988;
const DAY = "2026-09-15";

/** What the thread says the job should be: 4 crew, 09:30-14:00, at place 16689. */
const desired = (over: Partial<{ size: number; end: string; place_id: number; name: string }> = {}): DesiredOrder =>
  ({
    company_id: 42,
    pricelist_category_id: 197,
    intern_name: "RGJ_PO_148594",
    slot_teams: [
      {
        name: over.name ?? "General",
        size: over.size ?? 4,
        profession_id: 1,
        place_id: over.place_id ?? 16689,
        beginning: `${DAY}T09:30:00+00:00`,
        end: over.end ?? `${DAY}T14:00:00+00:00`,
      },
    ],
  }) as unknown as DesiredOrder;

/**
 * An OnSinch standing in for one order. `slot` is what it currently holds; `staffed` says
 * whether anybody is signed on, which is the only reason the block is readable at all.
 */
function onsinchHolding(opts: {
  slot?: { size: number; beginning: string; end: string; slotlocation_id: number; profession_id: number };
  teamName?: string;
  window?: { min: string; max: string };
  staffed?: boolean;
  intern_name?: string;
  throwOnOrder?: boolean;
}) {
  const staffed = opts.staffed !== false;
  return new OnsinchClient(async (method, path) => {
    const page = (data: unknown[]) => ({
      status: 200 as const,
      data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } },
    });
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/orders")) {
      if (opts.throwOnOrder) throw new Error("orders read exploded");
      return page([
        {
          id: ORDER,
          number: "10998",
          happening: `${DAY}T09:30:00+00:00`,
          intern_name: opts.intern_name ?? "RGJ_PO_148594",
          Job: [{ id: 16055, min_beginning: opts.window?.min ?? `${DAY}T09:30:00+00:00`, max_end: opts.window?.max ?? `${DAY}T14:00:00+00:00` }],
        },
      ]);
    }
    if (path.startsWith("/attendance")) {
      if (!staffed || !opts.slot) return page([]);
      // Two seats on one block: several rows carrying the same Slot, which is the live
      // shape and the reason readLiveShape de-duplicates by slot team id.
      const row = { Slot: [{ slotteam_id: TEAM, ...opts.slot, name: "" }], SlotTeam: [{ id: TEAM, name: opts.teamName ?? "General" }] };
      return page([row, row]);
    }
    return page([]);
  });
}

const HELD = { size: 4, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00`, slotlocation_id: 16689, profession_id: 1 };

(async () => {
  console.log("\n[1] OnSinch holds exactly what the thread asks for — no drift, nothing re-sent");
  {
    const live = await readLiveShape(onsinchHolding({ slot: HELD }), ORDER);
    ok(!live.unreadable, "the order read back", String(live.unreadable ?? "clean"));
    ok(live.staffedBlocks === 1, "one staffed block, de-duplicated from two attendance rows", String(live.staffedBlocks));
    const d = driftAgainst(live, desired(), [TEAM]);
    ok(d.length === 0, "and nothing differs", JSON.stringify(d));
  }

  console.log("\n[1b] THE SAME INSTANT IN A DIFFERENT ZONE IS NOT A DIFFERENCE");
  {
    /**
     * The bug the first live dry run found, on 12 of 13 drifted threads. The engine sends
     * `+01:00` through British Summer Time and OnSinch echoes `+00:00`; sliced to the
     * minute those read as an hour apart, so every order in the tenant looked drifted and
     * the loop would have re-asserted that non-change on every sweep, for ever.
     *
     * Comparing instants is the fix, and this is the assertion that keeps it.
     */
    const bst = {
      ...HELD,
      beginning: `${DAY}T10:30:00+01:00`,
      end: `${DAY}T15:00:00+01:00`,
      // The same two moments as HELD's 09:30-14:00 at +00:00.
    };
    const live = await readLiveShape(
      onsinchHolding({ slot: bst, window: { min: `${DAY}T10:30:00+01:00`, max: `${DAY}T15:00:00+01:00` } }),
      ORDER
    );
    ok(driftAgainst(live, desired(), [TEAM]).length === 0, "an offset difference produces no drift", JSON.stringify(driftAgainst(live, desired(), [TEAM])));
  }

  console.log("\n[2] the block was altered underneath us — every difference is named");
  {
    // Somebody moved the finish time and dropped a head. Neither change came from us, and
    // neither leaves any trace we could have read: this is the drift the loop exists for.
    const live = await readLiveShape(
      onsinchHolding({
        slot: { ...HELD, size: 3, end: `${DAY}T12:30:00+00:00` },
        window: { min: `${DAY}T09:30:00+00:00`, max: `${DAY}T12:30:00+00:00` },
      }),
      ORDER
    );
    const d = driftAgainst(live, desired(), [TEAM]);
    ok(d.some((x) => x.field === "size" && x.live === 3 && x.want === 4), "the crew size is reported", JSON.stringify(d.find((x) => x.field === "size")));
    ok(d.some((x) => x.where === "block 1" && x.field === "end"), "the block's finish time is reported");
    ok(d.some((x) => x.where === "window" && x.field === "end"), "and so is the job window, which is all an unstaffed order has");
  }

  console.log("\n[3] one re-assertion, then the next pass is a no-op — it converges");
  {
    // The loop's whole claim. Pass one sees the difference; the write lands; pass two
    // reads the corrected order and finds nothing. A loop that could not reach this would
    // re-post the same shape every sweep for the life of the thread.
    const before = driftAgainst(await readLiveShape(onsinchHolding({ slot: { ...HELD, size: 3 } }), ORDER), desired(), [TEAM]);
    const after = driftAgainst(await readLiveShape(onsinchHolding({ slot: HELD }), ORDER), desired(), [TEAM]);
    ok(before.length > 0, "pass one has something to do", `${before.length} difference(s)`);
    ok(after.length === 0, "pass two has nothing to do", `${after.length} difference(s)`);
  }

  console.log("\n[4] an UNREADABLE order is not a drifted one");
  {
    // The failure this guard exists for: a read that throws looks exactly like an order
    // holding nothing, and re-asserting on that re-posts the shape against an order that
    // was already correct, on every sweep.
    const live = await readLiveShape(onsinchHolding({ slot: HELD, throwOnOrder: true }), ORDER);
    ok(!!live.unreadable, "the failure is recorded as unreadable", String(live.unreadable));
    ok(driftAgainst(live, desired(), [TEAM]).length === 0, "and it produces NO drift, so nothing is re-sent");

    // An order that is simply missing is the same answer: not readable, not drifted.
    const gone = new OnsinchClient(async () => ({ status: 200, data: { data: [], pagination: { count: 0, pageCount: 1, nextPage: false } } }));
    const g = await readLiveShape(gone, ORDER);
    ok(!!g.unreadable, "an order that reads back empty is unreadable, not empty", String(g.unreadable));
  }

  console.log("\n[5] an UNSTAFFED block is invisible, and the job window carries it alone");
  {
    // Attendance is a row per assigned seat, so a To Confirm order nobody is on returns
    // zero rows. Reporting its blocks as differing would re-post the shape forever.
    const live = await readLiveShape(onsinchHolding({ slot: HELD, staffed: false }), ORDER);
    ok(!live.unreadable, "zero attendance rows is a clean read, not a failure");
    ok(live.staffedBlocks === 0, "and no block is readable", String(live.staffedBlocks));
    ok(driftAgainst(live, desired({ size: 9 }), [TEAM]).length === 0, "a crew size we cannot see is never reported as a difference");

    // But the times still are, because the Job window does not need anybody signed on.
    // It is ONE-SIDED evidence: min_beginning is the minimum across every block on the
    // order, so a span that ENDS BEFORE our block ends proves no block runs that late and
    // ours therefore is not there.
    const short = await readLiveShape(
      onsinchHolding({ slot: HELD, staffed: false, window: { min: `${DAY}T09:30:00+00:00`, max: `${DAY}T12:30:00+00:00` } }),
      ORDER
    );
    const d = driftAgainst(short, desired(), [TEAM]);
    ok(d.length === 1 && d[0].where === "window" && d[0].field === "end", "a time change that did not land IS caught on an unstaffed order", JSON.stringify(d));

    /**
     * And the other direction is NOT evidence. A span wider than we asked for means some
     * other block runs later — staff extending an order is normal and none of our
     * business. Reading it as drift reported a difference on every extended order in the
     * tenant and would have re-asserted it every sweep for ever.
     */
    const wide = await readLiveShape(
      onsinchHolding({ slot: HELD, staffed: false, window: { min: `${DAY}T06:00:00+00:00`, max: `${DAY}T23:00:00+00:00` } }),
      ORDER
    );
    ok(driftAgainst(wide, desired(), [TEAM]).length === 0, "a span WIDER than we asked for is not drift");
  }

  console.log("\n[6] a block we never wrote is not ours to reconcile");
  {
    // Ops added a block by hand. We hold no id for it, so it is not in `team_ids`, and the
    // loop must not touch it — the same rule that makes planAmendment decline.
    const live = await readLiveShape(onsinchHolding({ slot: { ...HELD, size: 99 } }), ORDER);
    ok(driftAgainst(live, desired(), [999999]).length === 0, "an id we do not hold produces no per-block drift");
    ok(driftAgainst(live, desired(), undefined).length === 0, "and neither does holding no ids at all");
  }

  console.log("\n[7] the fingerprint tracks WHAT IS ASKED FOR, not what OnSinch holds");
  {
    // The count has to survive the live side wobbling, or a difference that keeps failing
    // resets its attempt count whenever somebody touches the order and never reaches the
    // ceiling that turns it into a label.
    const a = driftAgainst(await readLiveShape(onsinchHolding({ slot: { ...HELD, size: 3 } }), ORDER), desired(), [TEAM]);
    const b = driftAgainst(await readLiveShape(onsinchHolding({ slot: { ...HELD, size: 2 } }), ORDER), desired(), [TEAM]);
    ok(driftKey(a) === driftKey(b), "the same ask against two different live values is one fingerprint", driftKey(a));

    const c = driftAgainst(await readLiveShape(onsinchHolding({ slot: { ...HELD, size: 3 } }), ORDER), desired({ size: 6 }), [TEAM]);
    ok(driftKey(a) !== driftKey(c), "a different ask is a different fingerprint", driftKey(c));

    // Two differences at once, and the order they were listed in must not matter — the
    // fingerprint is a set, not a sequence, or a count resets whenever the list comes back
    // in a different order.
    const two = driftAgainst(
      await readLiveShape(onsinchHolding({ slot: { ...HELD, size: 3, end: `${DAY}T12:30:00+00:00` } }), ORDER),
      desired(),
      [TEAM]
    );
    ok(two.length > 1, "two differences to fingerprint", String(two.length));
    ok(driftKey(two) === driftKey([...two].reverse()), "and the order of the list does not change it", driftKey(two));
  }

  console.log("\n[8] order-level fields reconcile too, and an empty ask never blanks one");
  {
    const live = await readLiveShape(onsinchHolding({ slot: HELD, intern_name: "OLD_PO" }), ORDER);
    const d = driftAgainst(live, desired(), [TEAM]);
    ok(d.some((x) => x.where === "order" && x.field === "intern_name"), "a PO number OnSinch never took is reported", JSON.stringify(d));

    // The engine sets these from the client's own words, so a message that said less must
    // not clear what is there. Silence is inherit, not blank.
    const quiet = { ...desired(), intern_name: undefined } as unknown as DesiredOrder;
    ok(
      driftAgainst(live, quiet, [TEAM]).every((x) => x.field !== "intern_name"),
      "but an amendment that says nothing about it leaves it alone"
    );
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
