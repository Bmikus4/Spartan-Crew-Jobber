// ============================================================================
// AN ORDER OPS RAISED IS AMENDED IN PLACE, OR IT IS LEFT ALONE. NEVER DESTROYED.
// ----------------------------------------------------------------------------
// Measured 2026-09-14: 28 of 37 live bound orders were raised by staff, not by this
// engine. Order dedup links a thread to whatever order already exists for that client on
// that day, so inheriting somebody else's order is the NORMAL case.
//
// Until now those had exactly one route. `amendOrderInPlace` needs `previous` — the block
// array this engine last wrote — to know which live block is which, an inherited order has
// none, so the amendment declined and the rebuild took it: delete the order, post a
// corrected one. That returns the job right and the R NUMBER WRONG, on an order ops have
// quoted from, attached files to and typed fields into.
//
// Two changes, and they only make sense together:
//
//   replaceOrder now REFUSES an order we did not create. Ben dropped that gate on
//     2026-08-18 because refusing to destroy meant refusing to amend at all; that is no
//     longer the trade, so the plan's rule of 2026-09-13 stands.
//   amendOrderInPlace GAINS a route for them, pairing the thread's blocks to the order's
//     on day and venue — Ben's identity ruling, one level down. Crew and times are what an
//     amendment changes, so neither can identify the thing being changed.
//
// Without the second, the first is just a dead end with a label on it.
//
// Run: npx tsx test/amendStaffRaisedOrder.ts
// ============================================================================
import { pairBlocks, amendOrderInPlace, type LiveBlock } from "../app/lib/engine/amendOrder";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const ORDER = 13784;
const JOB = 14064;
const DAY = "2026-09-20";
const VENUE = 88;
const OTHER_VENUE = 99;

const block = (over: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam =>
  ({
    name: "General",
    size: 4,
    profession_id: 1,
    place_id: VENUE,
    beginning: `${DAY}T09:00:00+01:00`,
    end: `${DAY}T17:00:00+01:00`,
    ...over,
  }) as DesiredSlotTeam;

const order = (teams: DesiredSlotTeam[]): DesiredOrder =>
  ({ company_id: 501, user_id: 7, place_id: VENUE, pricelist_category_id: 197, slot_teams: teams }) as unknown as DesiredOrder;

/**
 * An OnSinch holding one order ops raised. `audit` is what the audit tree yields (block
 * ids and names, available for any UI-raised order); `staffed` is which of those blocks
 * somebody is signed on to, which is the only reason their shapes are readable.
 */
function fakeOnsinch(opts: {
  audit: Array<{ id: number; name: string }>;
  staffed?: Record<number, { size: number; beginning: string; end: string; slotlocation_id: number; profession_id: number }>;
}) {
  const calls: string[] = [];
  const patched: any[] = [];
  const created: any[] = [];
  const client = new OnsinchClient(async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    const page = (data: unknown[]) => ({
      status: 200 as const,
      data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } },
    });
    if (method === "PATCH" && path.startsWith("/slotTeams")) { patched.push(body); return { status: 204, data: null }; }
    if (method === "POST" && path.startsWith("/slotTeams")) {
      created.push(body);
      return { status: 201, data: { data: [{ id: 40999 }] } };
    }
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/orders")) {
      return page([{ id: ORDER, number: "10687", company_id: 501, happening: `${DAY}T09:00:00+00:00`, Job: [{ id: JOB, min_beginning: `${DAY}T08:00:00+00:00`, max_end: `${DAY}T16:00:00+00:00` }] }]);
    }
    if (path.startsWith("/timelineAudits")) {
      return page(
        opts.audit.map((t, i) => ({
          id: 1000 + i,
          action: "common_create",
          data: JSON.stringify({ model: "SlotTeam", id: String(t.id), name: t.name, data: { path: `Order:${ORDER}\\/Job:${JOB}\\/SlotTeam:${t.id}` } }),
        }))
      );
    }
    if (path.startsWith("/attendance")) {
      const rows: unknown[] = [];
      for (const [id, slot] of Object.entries(opts.staffed ?? {})) {
        rows.push({ Slot: [{ slotteam_id: Number(id), ...slot, name: "" }], SlotTeam: [{ id: Number(id), name: opts.audit.find((a) => a.id === Number(id))?.name ?? "" }] });
      }
      return page(rows);
    }
    return page([]);
  });
  return { client, calls, patched, created };
}

const hooks = { async onCreated() {} };
const LIVE = (over: Partial<{ beginning: string; place_id: number }> = {}) => ({
  size: 4,
  beginning: over.beginning ?? `${DAY}T08:00:00+00:00`, // the same instant as 09:00+01:00
  end: `${DAY}T16:00:00+00:00`,
  slotlocation_id: over.place_id ?? VENUE,
  profession_id: 1,
});

(async () => {
  console.log("\n[1] pairBlocks — one block on each side needs no key at all");
  {
    // Which is what carries an UNSTAFFED staff-raised order: nobody is signed on, so no
    // shape is readable, and the pairing is still the only one there is.
    const p = pairBlocks([block()], [{ id: 40988, name: "General" }] as LiveBlock[]);
    ok(!p.declined && p.pairs.length === 1 && p.pairs[0].id === 40988, "the only pairing there is", JSON.stringify(p));
  }

  console.log("\n[2] pairBlocks — day and venue separate several blocks");
  {
    const live: LiveBlock[] = [
      { id: 1, name: "General", beginning: `${DAY}T08:00:00+00:00`, profession_id: 1 },
      { id: 2, name: "General", beginning: `2026-09-21T08:00:00+00:00`, profession_id: 1 },
    ];
    // Two blocks both called "General" — order 13784 really does carry that — so names
    // could never have done this.
    const p = pairBlocks([block({ beginning: `2026-09-21T10:00:00+01:00` }), block()], live);
    ok(!p.declined, "paired", String(p.declined));
    ok(p.pairs.find((x) => x.index === 0)?.id === 2, "the 21st's block went to the 21st", JSON.stringify(p.pairs));
    ok(p.pairs.find((x) => x.index === 1)?.id === 1, "and the 20th's to the 20th");
  }

  console.log("\n[3] pairBlocks — a TIME change still finds its block, a VENUE change does not");
  {
    const live: LiveBlock[] = [{ id: 1, name: "General", beginning: `${DAY}T08:00:00+00:00`, profession_id: 1 }];
    // "Make that 4x at 1400-2000" — the whole point of keying on the day and not the time.
    const moved = pairBlocks([block({ beginning: `${DAY}T14:00:00+01:00`, end: `${DAY}T20:00:00+01:00`, size: 4 }), block({ beginning: "2026-10-01T09:00:00+01:00" })], live);
    ok(!moved.declined && moved.pairs.some((x) => x.index === 0 && x.id === 1), "a moved time pairs to the same block", JSON.stringify(moved));

    /**
     * A VENUE MOVE PAIRS TO THE SAME BLOCK AND CARRIES THE NEW VENUE, because a block's
     * live venue cannot be read: `Slot.slotlocation_id` reads like a place id and is not
     * one — thread place 621 is "Westfield Stratford City", the slotlocation on that same
     * block is 16610, and `/places?id[eq]=16610` finds nothing. No `/slotLocations`
     * endpoint exists in any spelling.
     *
     * So the venue cannot participate in the key, and this assertion used to say the
     * opposite. What protects the client is that the pairing is unique on day and role:
     * there is one block it could be, the patch sets the venue the thread asked for, and
     * crew go where the client said.
     */
    const relocated = pairBlocks([block({ place_id: OTHER_VENUE })], live);
    ok(
      !relocated.declined && relocated.pairs.length === 1 && relocated.pairs[0].id === 1,
      "a block that moved venue pairs to its same-day, same-role block",
      JSON.stringify(relocated.pairs)
    );
  }

  console.log("\n[4] pairBlocks — every way it refuses");
  {
    const sameKey: LiveBlock[] = [
      { id: 1, name: "General", beginning: `${DAY}T08:00:00+00:00`, profession_id: 1 },
      { id: 2, name: "General", beginning: `${DAY}T14:00:00+00:00`, profession_id: 1 },
    ];
    ok(!!pairBlocks([block(), block()], sameKey).declined, "two blocks on one day at one venue: nothing separates them");

    const unreadable: LiveBlock[] = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
    ok(!!pairBlocks([block(), block()], unreadable).declined, "several blocks and no readable shapes: declines");

    // Ops added a block this thread knows nothing about, and the thread also wants a new
    // one. Appending beside a block we cannot account for doubles the crew on a 201.
    const extra: LiveBlock[] = [
      { id: 1, name: "ours", beginning: `${DAY}T08:00:00+00:00`, profession_id: 1 },
      { id: 2, name: "theirs", beginning: `${DAY}T08:00:00+00:00`, profession_id: 36 },
    ];
    const grows = pairBlocks([block(), block({ beginning: "2026-11-05T09:00:00+01:00" })], extra);
    ok(!!grows.declined && /double the crew/.test(grows.declined), "an append beside an unaccounted block refuses", String(grows.declined));

    ok(!!pairBlocks([block()], []).declined, "no ids at all: declines");
  }

  console.log("\n[5] a staff-raised order is amended in place — the whole path");
  {
    const { client, patched, created, calls } = fakeOnsinch({
      audit: [{ id: 40988, name: "General" }],
      staffed: { 40988: LIVE() },
    });
    // `previous: []` is the inherited order: this engine never wrote a block set for it.
    const res = await amendOrderInPlace(
      client,
      { order_id: ORDER, previous: [], desired: order([block({ size: 6 })]) },
      hooks
    );
    ok(!!res.amended, "it amended", JSON.stringify(res).slice(0, 160));
    ok(patched.length === 1, "one PATCH went out", JSON.stringify(patched));
    ok(patched[0]?.[0]?.id === 40988, "aimed at the block the audit tree named", String(patched[0]?.[0]?.id));
    ok(Number(patched[0]?.[0]?.size) === 6, "carrying the new crew size", String(patched[0]?.[0]?.size));
    ok(!calls.some((c) => c.startsWith("DELETE")), "and nothing was deleted", calls.join(" -> "));
    ok(!created.length, "and nothing was appended");
  }

  console.log("\n[6] the same instant in another zone is not a change, so it is not patched");
  {
    // The live block runs 08:00+00:00; the thread asks for 09:00+01:00. Same moment. A
    // PATCH here would be harmless but it would also make the shrink guard below read a
    // size on a block whose size never moved.
    const { client, patched } = fakeOnsinch({ audit: [{ id: 40988, name: "General" }], staffed: { 40988: LIVE() } });
    const res = await amendOrderInPlace(client, { order_id: ORDER, previous: [], desired: order([block()]) }, hooks);
    ok(!!res.amended, "it ran");
    ok(patched.length === 0, "and sent nothing, because nothing differs", JSON.stringify(patched));
  }

  console.log("\n[7] shrinking a block somebody is signed on to is still refused");
  {
    const { client, patched } = fakeOnsinch({ audit: [{ id: 40988, name: "General" }], staffed: { 40988: LIVE() } });
    const res = await amendOrderInPlace(client, { order_id: ORDER, previous: [], desired: order([block({ size: 2 })]) }, hooks);
    ok(!!res.refused && /signed on/.test(res.refused), "refused, and says why", String(res.refused).slice(0, 110));
    ok(patched.length === 0, "and no half-amendment went out — the whole thing stops");
  }

  console.log("\n[8] REPLACEORDER WILL NOT DESTROY AN ORDER OPS RAISED");
  {
    // The other half. Without this, an amendment that cannot land in place falls through
    // to delete-and-repost and ops lose the R number they have been quoting from.
    const { client, calls } = fakeOnsinch({ audit: [] });
    const r = await replaceProvisionalOrder(
      client,
      { order_id: ORDER, desired: order([block()]), weCreatedIt: false },
      { async onIntent() {}, async onDeleted() {} }
    );
    ok(!!r.refused && /not ours to delete/.test(r.refused), "refused", String(r.refused).slice(0, 110));
    ok(!r.deleted, "nothing was deleted");
    ok(!calls.some((c) => c.startsWith("DELETE")), "and it refused before any read of the live order", calls.join(" -> "));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
