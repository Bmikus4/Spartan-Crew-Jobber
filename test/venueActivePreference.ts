// ============================================================================
// An active row is preferred over a retired one — and a retired row elsewhere in
// the tenant has no say in it.
// ----------------------------------------------------------------------------
// `anyActive` was computed over the WHOLE place list at venueMatch.ts:294 and
// resolve.ts:270, then used to gate a preference between two CANDIDATES. The
// comment at resolve.ts:267-268 states the intent — "Only when there is an active
// alternative, though: an inactive place is still a better answer than inventing a
// duplicate of a venue that already exists" — and the implementation could never
// deliver it: on a pool of 2,533 rows with 2,396 active, `anyActive` is true on
// every call that has ever been made.
//
// It is also redundant rather than merely broken, which is the part worth pinning.
// `b.evidence.active && anyActive` is true exactly when `b.evidence.active` is
// true, because an active candidate IS an active alternative. The term reduces to
// a plain active preference in all four cases: no active row anywhere (nobody is
// boosted either way), active rows in the pool but none among the candidates
// (nobody is boosted either way), some candidates active (they win), all
// candidates active (they tie and fall through to richness).
//
// So the guard never fired, and removing it cannot change an answer. These cases
// are what make that claim checkable instead of merely argued — case [1] is the
// one that would have failed had `anyActive` been doing anything at all.
//
// THIS IS NOT THE RETIRED-ONLY CHANGE. A retired row that is the only candidate
// still wins here and still gets booked. That is deliberate: making `active` a
// filter changes live behaviour on every thread and belongs in its own commit
// with its own measurement, not smuggled in beside a simplification that provably
// changes nothing.
//
// Run: npx tsx test/venueActivePreference.ts
// ============================================================================
import { matchPlaceV2 } from "../app/lib/engine/venueMatch";
import { matchPlace } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const place = (
  id: number,
  name: string,
  zip: string | null,
  address: string | null,
  active: boolean
): PlaceCandidate => ({ id, name, zip, address, city: "London", active } as PlaceCandidate);

/** Two rows for one building, both retired. Nothing else in the pool matches them. */
const RETIRED_A = place(9001, "Battersea Evolution", "SW11 4NJ", "Queenstown Road", false);
const RETIRED_B = place(9002, "Battersea Evolution", "SW11 4NJ", null, false);

/** An ACTIVE row for a completely unrelated building, far from the query. */
const UNRELATED_ACTIVE = place(9100, "Woolwich Works", "SE18 6HD", "11 Royal Arsenal", true);

/** An active row for the SAME building as the retired pair. */
const RELATED_ACTIVE = place(9003, "Battersea Evolution", "SW11 4NJ", "Queenstown Road", true);

const QUERY = "Battersea Evolution, Queenstown Road, SW11 4NJ";

(async () => {
  console.log("\n[1] an unrelated active row does not change which retired row wins");
  {
    /**
     * THE CASE THE OLD CODE GOT WRONG IN PRINCIPLE. Under a tenant-wide `anyActive`,
     * adding Woolwich Works — a building the query never mentions — flipped the flag
     * that decided whether the Battersea rows' own active-ness counted. Both orders
     * must give the same answer, and that answer must not depend on a row that lost.
     */
    const without = matchPlaceV2(QUERY, [RETIRED_A, RETIRED_B]);
    const with_ = matchPlaceV2(QUERY, [RETIRED_A, RETIRED_B, UNRELATED_ACTIVE]);
    ok(without.place_id === with_.place_id,
      "matchPlaceV2 answers the same with and without an unrelated active row",
      `${without.place_id} vs ${with_.place_id}`);
    ok(with_.place_id !== UNRELATED_ACTIVE.id,
      "and never answers with the unrelated row itself", String(with_.place_id));

    const v1Without = matchPlace(QUERY, [RETIRED_A, RETIRED_B]);
    const v1With = matchPlace(QUERY, [RETIRED_A, RETIRED_B, UNRELATED_ACTIVE]);
    ok(v1Without === v1With,
      "matchPlace answers the same with and without an unrelated active row",
      `${v1Without} vs ${v1With}`);
    ok(v1With !== UNRELATED_ACTIVE.id,
      "and never answers with the unrelated row itself", String(v1With));
  }

  console.log("\n[2] among candidates for the same building, active beats retired");
  {
    const v2 = matchPlaceV2(QUERY, [RETIRED_A, RETIRED_B, RELATED_ACTIVE]);
    ok(v2.place_id === RELATED_ACTIVE.id,
      "matchPlaceV2 elects the active row as the group's head", String(v2.place_id));

    const v1 = matchPlace(QUERY, [RETIRED_A, RETIRED_B, RELATED_ACTIVE]);
    ok(v1 === RELATED_ACTIVE.id, "matchPlace picks the active row", String(v1));
  }

  console.log("\n[3] a retired row that is the only candidate still wins — this is NOT the filter");
  {
    /**
     * Pinned deliberately. If a later change makes `active` a hard filter, this case
     * must be edited BY HAND and its edit is the moment somebody decides that a
     * thread naming a retired venue should hold for a human instead of booking. It
     * must never change silently as a side effect of a ranking tweak.
     */
    const v2 = matchPlaceV2(QUERY, [RETIRED_A]);
    ok(v2.place_id === RETIRED_A.id,
      "matchPlaceV2 still books onto a retired-only match", String(v2.place_id));

    const v1 = matchPlace(QUERY, [RETIRED_A]);
    ok(v1 === RETIRED_A.id, "matchPlace still books onto a retired-only match", String(v1));
  }

  console.log("\n[4] with no active row anywhere, richness decides and nothing is boosted");
  {
    /**
     * RETIRED_A carries an address and RETIRED_B does not, so the richer row wins on
     * context alone. Under the old code this pool made `anyActive` false, which was
     * the only input that ever varied — and the answer was the same then too.
     */
    const v2 = matchPlaceV2(QUERY, [RETIRED_B, RETIRED_A]);
    ok(v2.place_id === RETIRED_A.id,
      "the retired row that knows more speaks for the building", String(v2.place_id));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
