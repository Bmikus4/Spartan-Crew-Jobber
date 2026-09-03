// ============================================================================
// A BLOCK'S OWN VENUE IS RESOLVED PROPERLY, AND NEVER MERGES INTO ANOTHER ONE.
// ----------------------------------------------------------------------------
// Ben, 2026-09-03 (F2): a block must not inherit another block's venue and then
// merge into it.
//
// It did exactly that. The per-block venue was resolved with `matchPlace` and
// nothing else — the weakest of the six things resolvePlace tries, with no alias
// store, no adjudicator, no fuzzy second pass and no shell rules. A block naming
// a venue the JOB's own text would have resolved fine came back null, and null
// meant "keep the order's place". That is not a hold: the merge key includes the
// place, so the block then merged into whichever venue the job was booked at.
//
// Six crew at ExCeL and four at the Banqueting House became ten at ExCeL, under
// a note reading "a block named its own venue but it did not resolve" that said
// nothing about where the other four had gone.
//
// FREQUENCY, measured on 100 real client threads (2026-09-03): 5 name a block
// venue at all, and 2 of those 5 inherited silently. One of them — "Tate Modern"
// as the job with "banqueting house" and "bloomberg offices ec4n 4tq" as blocks —
// is three genuinely different buildings in one booking.
//
// THE LIMIT THIS FILE ALSO PINS: an OnSinch order carries ONE `provision_place`,
// so at most one new venue per order. A second unheld venue cannot be created,
// and the rule is that it is announced and flagged, never merged in silence.
//
// Run: npx tsx test/blockVenueResolves.ts
// ============================================================================
import { resolveBlockVenues } from "../app/lib/engine/compiler";
import { matchPlace } from "../app/lib/engine/resolve";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationFacts, PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PLACES: PlaceCandidate[] = [
  { id: 49, name: "ExCel London", alias: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 57, name: "Olympia London", alias: "Olympia", address: "Hammersmith Road", city: "London", zip: "W14 8UX", active: true },
  { id: 12, name: "The British Museum", alias: undefined, address: "Great Russell Street", city: "London", zip: "WC1B 3DG", active: true },
  { id: 900, name: "No Location", alias: undefined, address: undefined, city: undefined, zip: undefined, active: true },
] as unknown as PlaceCandidate[];

const client = new OnsinchClient((async (method: string, path: string) => {
  if (method === "GET" && path.startsWith("/places")) {
    return { status: 200, data: { data: PLACES, pagination: { count: PLACES.length, pageCount: 1, nextPage: false } } };
  }
  return { status: 200, data: { data: [], pagination: { count: 0, pageCount: 1, nextPage: false } } };
}) as never);

const block = (size: number, location_text?: string) => ({
  date: "2026-03-09", start_time: "08:00", end_time: "18:00", size,
  ...(location_text ? { location_text } : {}),
});

const run = (requests: unknown[], job: { place_id?: number; provision?: unknown; location_text?: string }) =>
  resolveBlockVenues({ requests } as ConversationFacts, job as never, client);

const placeOf = (r: { facts: ConversationFacts }, i: number) =>
  (r.facts.requests as Array<{ place_id?: number }>)[i]?.place_id;

(async () => {
  console.log("\n[1] a block naming a venue the tenant holds goes to that venue");
  {
    const r = await run([block(6), block(4, "Olympia London")], { place_id: 49, location_text: "ExCeL London" });
    ok(placeOf(r, 0) === undefined, "the block with no venue of its own stays on the job's", String(placeOf(r, 0)));
    ok(placeOf(r, 1) === 57, "the block that named Olympia goes to Olympia", String(placeOf(r, 1)));
    ok(r.notes.some((n) => /staffed as separate teams/.test(n)), "and it says so", r.notes.join(" | "));
    ok(!r.review, "nothing to review");
  }

  console.log("\n[2] THE DEFECT — a block venue matchPlace cannot reach no longer merges");
  {
    // Both of these return NULL from matchPlace on this very fixture, and both are
    // resolved by the chain behind it — the fuzzy second pass and the shell rules.
    // Under the old code null meant "keep the order's place", so the blocks merged
    // into the job's venue and the crew went to one building.
    ok(matchPlace("Excel Docklands", PLACES) === null,
       "matchPlace cannot reach \"Excel Docklands\"", String(matchPlace("Excel Docklands", PLACES)));
    ok(matchPlace("Great Russell Street", PLACES) === null,
       "nor a venue named by its street", String(matchPlace("Great Russell Street", PLACES)));

    const r = await run(
      [block(6), block(4, "Excel Docklands"), block(2, "Great Russell Street")],
      { place_id: 12, location_text: "The British Museum" }
    );
    ok(placeOf(r, 1) === 49, "\"Excel Docklands\" resolves to ExCeL", String(placeOf(r, 1)));
    ok(placeOf(r, 1) !== 12, "and above all it is NOT the job's venue", String(placeOf(r, 1)));
    ok(placeOf(r, 2) === undefined, "the street IS the job's venue, so that block merges", String(placeOf(r, 2)));
  }

  console.log("\n[3] a block venue the tenant does not hold is CREATED, not inherited");
  {
    const r = await run([block(6), block(4, "The Glass House")], { place_id: 49, location_text: "ExCeL London" });
    ok(r.provision?.name === "The Glass House", "a venue is provisioned from the block's own words", String(r.provision?.name));
    // 0 and not undefined: `compose` reads `r.place_id ?? inp.place_id`, so undefined
    // would inherit the job's venue and merge — which is the bug, restated.
    ok(placeOf(r, 1) === 0, "the block is marked created-on-write, not left to inherit", String(placeOf(r, 1)));
    ok(placeOf(r, 0) === undefined, "and the other block still sits on the job's venue", String(placeOf(r, 0)));
  }

  console.log("\n[4] a block naming the SAME building as the job merges, correctly");
  {
    // The one case where inheriting is right: it is one venue, so it is one team.
    const r = await run([block(6), block(4, "ExCeL London")], { place_id: 49, location_text: "ExCeL London" });
    ok(placeOf(r, 1) === undefined, "no per-block place, so the blocks merge", String(placeOf(r, 1)));
    ok(!r.notes.some((n) => /separate teams/.test(n)), "and it is not reported as a move", r.notes.join(" | "));
  }

  console.log("\n[5] two blocks naming the same unheld venue share the one created row");
  {
    const r = await run(
      [block(6, "The Glass House"), block(4, "the glass house")],
      { place_id: 49, location_text: "ExCeL London" }
    );
    ok(placeOf(r, 0) === 0 && placeOf(r, 1) === 0, "both are created-on-write",
       `${placeOf(r, 0)},${placeOf(r, 1)}`);
    ok(!r.review, "one new venue is within what an order can carry");
  }

  console.log("\n[6] a SECOND unheld venue cannot be created — and says so instead of merging");
  {
    // The hard limit: an OnSinch order carries one provision_place, backfilled onto
    // every team still lacking a place_id. Two new venues is not expressible.
    const r = await run(
      [block(6, "The Glass House"), block(4, "The Old Foundry")],
      { place_id: 49, location_text: "ExCeL London" }
    );
    ok(r.provision?.name === "The Glass House", "the first claims the order's one slot", String(r.provision?.name));
    ok(r.review, "and the thread is flagged for a person");
    ok(r.notes.some((n) => /SECOND NEW VENUE CANNOT BE CREATED/.test(n) && /Old Foundry/.test(n)),
       "the note names the venue that could not be made", r.notes.join(" | "));
  }

  console.log("\n[7] the job's own unheld venue holds the slot, and a block repeating it shares");
  {
    const r = await run(
      [block(6), block(4, "the glass house,")],
      { provision: { name: "The Glass House", country: "GB" }, location_text: "The Glass House" }
    );
    ok(r.provision?.name === "The Glass House", "the job's provision is not overwritten", String(r.provision?.name));
    ok(placeOf(r, 1) === 0, "the block joins it rather than being stranded", String(placeOf(r, 1)));
    ok(!r.review, "a comma is not a second venue");
  }

  console.log("\n[8] no block names a venue — nothing happens at all");
  {
    const r = await run([block(6), block(4)], { place_id: 49, location_text: "ExCeL London" });
    ok(r.notes.length === 0, "no notes", r.notes.join(" | "));
    ok(!r.review, "nothing to review");
    ok(r.provision === undefined, "and no venue is invented");
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
