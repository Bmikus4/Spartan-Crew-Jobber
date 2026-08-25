// ============================================================================
// The venue-deduplication SURVEY. Read-only. Writes a report, changes nothing.
// ----------------------------------------------------------------------------
// 4,889 of the tenant's 6,859 places carry their own name as their address, and
// this engine created them: a venue it failed to match was provisioned from the
// client's own text. 801 of them are ExCeL, in 21 spellings, and exactly one of
// those 801 carries a postcode.
//
// THE FIRST VERSION OF THIS SCRIPT WAS DANGEROUSLY WRONG AND THE WAY IT WAS WRONG
// IS THE MAIN FINDING. It clustered rows by "neither contradicts the other" —
// postcode districts agree, and one row's identifying words are a subset of the
// other's — and joined them transitively. That is the obvious algorithm and it put
// the Royal Albert Hall, the British Museum, Oxford Circus, Finsbury Park and 3,405
// other unrelated venues into ONE cluster of 3,409, because subset-of chains: a row
// naming several venues bridges all of them, and a row with no postcode contradicts
// nothing. Run as a deletion it would have destroyed 3,408 real venues and kept the
// Albert Hall. Every summary statistic looked reasonable; only printing the largest
// cluster showed it.
//
// So clustering is not the test. THIS is:
//
//     A row is a duplicate only if, with that row REMOVED from the list, the live
//     resolver takes the row's own name and returns a different row that can
//     actually locate a job.
//
// Nothing is inferred about what "the same building" means. The question asked is
// the only one that matters operationally — "if this row were gone, would the work
// still land in the right place?" — and it is asked of the production resolver, so
// the survey and the engine cannot disagree. A row that answers its own name and
// nothing else answers it is not a duplicate, whatever it looks like.
//
// Run: node scripts/place-dedupe-analyse.mjs
// Out: .tmp-data/place-dedupe/{report,edge-cases,deletions,keepers}.json
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./_env.mjs";
import { matchPlace } from "../app/lib/engine/resolve";
import { matchPlaceV2, matchedOnCityAlone, isAShell } from "../app/lib/engine/venueMatch";

loadEnv();
const OUT = path.join(".tmp-data", "place-dedupe");
fs.mkdirSync(OUT, { recursive: true });
const places = JSON.parse(fs.readFileSync(path.join(".tmp-data", "places.json"), "utf8"));
const byId = new Map(places.map((p) => [Number(p.id), p]));

const normAddr = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const locatable = (p) => !!(p && (p.zip || (p.lat && p.lng)));
const richness = (p) => [p.address, p.city, p.zip, p.alias, p.lat, p.lng, p.note, p.region].filter(Boolean).length;

/** Engine sentinels, looked up BY NAME. Deleting one makes the next enquiry create
 *  another, and every job standing on the old one becomes unexplainable. */
const SENTINEL = /^(no location|placeholder|unknown|tbc|n\/a|none|test)\b/i;

/** Words that name a PART of a venue. "Hall S3" is not a duplicate of ExCeL; it is
 *  the only record of which hall the crew were sent to. */
const SUBVENUE = /\b(hall|unit|suite|floor|level|gate|door|stand|bay|wing|block|entrance|annexe|annex|pavilion|marquee|loading|stage|s\d|n\d)\b/i;

/**
 * THE ENGINE'S OWN RESOLUTION PATH, in the order compiler.ts runs it. Copied here
 * rather than imported because resolvePlace also does alias lookups and provisioning;
 * this is the pure matching half, and the four steps are the four the compiler takes.
 */
function resolve(text, list) {
  const raw = matchPlace(text, list);
  const row = raw ? list.find((p) => Number(p.id) === Number(raw)) : undefined;
  if (raw && !isAShell(row) && !matchedOnCityAlone(text, row)) return { id: raw, how: "matchPlace" };
  if (raw && matchedOnCityAlone(text, row)) return { id: null, how: "city-only" };
  const v2 = matchPlaceV2(text, list);
  if (v2.decision === "match" && v2.place_id) return { id: v2.place_id, how: "second-pass" };
  if (raw && isAShell(row)) return { id: raw, how: "shell-kept" };
  return { id: null, how: v2.decision };
}

// ---------------------------------------------------------------- edge-case ledger
const edge = {};
const flag = (key, p, why, extra = {}) => {
  (edge[key] ??= []).push({ id: Number(p.id), name: String(p.name ?? "").trim(), why, ...extra });
};

// ---------------------------------------------------------------- pass 1: leave-one-out
const proposal = new Map(); // id -> target id
let tested = 0;
for (const p of places) {
  const id = Number(p.id);
  const name = String(p.name ?? "").trim();

  if (SENTINEL.test(name)) {
    flag("engine_sentinel", p, "the engine looks this row up BY NAME — deleting it makes the next enquiry create another");
    continue;
  }
  if (!p.active) {
    flag("deliberately_retired", p, "already inactive — a retired venue is a fact somebody recorded, not a duplicate");
    continue;
  }
  if (locatable(p)) {
    // A row that can locate a job is never deleted by this protocol, whatever it
    // duplicates. Merging two locatable rows means choosing which address is right,
    // and that is a decision about the world rather than about the data.
    flag("locatable_never_deleted", p, "carries a postcode or coordinates — kept regardless, merging two real records is a judgement about the world", { zip: p.zip ?? null });
    continue;
  }

  const without = places.filter((x) => Number(x.id) !== id);
  const r = resolve(name, without);
  tested++;

  if (r.id === null) {
    flag(`answers_only_to_itself__${r.how}`, p,
      `with this row gone the resolver returns nothing for its own name (${r.how}) — it is the tenant's ONLY answer for this venue`);
    continue;
  }
  const target = byId.get(Number(r.id));
  if (!locatable(target)) {
    flag("would_point_at_another_shell", p,
      "resolves to a row that ALSO cannot locate a job — deleting it tidies the list and moves the problem",
      { target: Number(r.id), targetName: String(target?.name ?? "").trim() });
    continue;
  }
  // The address, when the row states one that is not merely its own name.
  const addrText = normAddr(p.address) && normAddr(p.address) !== normAddr(p.name)
    ? `${name} ${p.address}` : null;
  if (addrText) {
    const ra = resolve(addrText, without);
    if (Number(ra.id) !== Number(r.id)) {
      flag("name_and_address_disagree", p,
        "its NAME and its ADDRESS resolve to different rows — one of the two is wrong and this row is the only place that says so",
        { byName: Number(r.id), byAddress: ra.id ?? null });
      continue;
    }
  }
  if (SUBVENUE.test(name) && !SUBVENUE.test(String(target.name ?? ""))) {
    flag("names_a_part_of_the_venue", p,
      "names a hall, unit, floor or gate — not a duplicate of the building but the only record of where inside it",
      { target: Number(r.id), targetName: String(target.name ?? "").trim() });
    continue;
  }
  if (normAddr(p.alias) && normAddr(p.alias) !== normAddr(target.alias)) {
    flag("alias_would_be_lost", p,
      "carries an ALIAS the survivor does not — delete it and a client's shorthand stops resolving",
      { alias: p.alias, target: Number(r.id), targetAlias: target.alias ?? null });
    continue;
  }
  if (richness(p) > richness(target)) {
    flag("knows_more_than_its_target", p,
      "carries more detail than the row it would collapse into",
      { target: Number(r.id), rich: richness(p), targetRich: richness(target) });
    continue;
  }
  proposal.set(id, Number(r.id));
}

// ---------------------------------------------------------------- pass 2: fixed point
// A deletion is only valid if its TARGET survives. Two rows that each resolve to the
// other would otherwise both be deleted and the venue lost with them.
const keep = new Set(places.map((p) => Number(p.id)).filter((id) => !proposal.has(id)));
let moved = true;
while (moved) {
  moved = false;
  for (const [id, target] of [...proposal]) {
    if (!keep.has(target)) {
      // Its survivor is itself scheduled to go. Keep this one and let the other side
      // collapse into it instead of losing both.
      flag("mutual_or_chained", byId.get(id),
        "the row it would collapse into is itself scheduled for deletion — kept, so a chain cannot delete a venue entirely",
        { target });
      proposal.delete(id);
      keep.add(id);
      moved = true;
    }
  }
}

// ---------------------------------------------------------------- pass 3: batch proof
// The row-level test removed ONE row at a time. The deletion removes them all at
// once, and that is a different question: 800 rows resolving to row 49 individually
// says nothing about 800 rows resolving to row 49 with the other 799 already gone.
const survivors = places.filter((p) => keep.has(Number(p.id)));
const batchFailures = [];
for (const [id, target] of proposal) {
  const p = byId.get(id);
  const r = resolve(String(p.name ?? "").trim(), survivors);
  if (Number(r.id) !== Number(target)) {
    batchFailures.push({ id, name: String(p.name ?? "").trim(), expected: target, gotAfterBatch: r.id ?? null, how: r.how });
  }
}
for (const f of batchFailures) {
  flag("batch_changes_the_answer", byId.get(f.id),
    "resolves to the right row when removed ALONE, but to something else once the whole batch is gone",
    { expected: f.expected, afterBatch: f.gotAfterBatch, how: f.how });
  proposal.delete(f.id);
  keep.add(f.id);
}

// ---------------------------------------------------------------- report
const targets = new Map();
for (const [, t] of proposal) targets.set(t, (targets.get(t) ?? 0) + 1);
const report = {
  places: places.length,
  shells: places.filter(isAShell).length,
  withPostcode: places.filter((p) => p.zip).length,
  withCoords: places.filter((p) => p.lat).length,
  inactive: places.filter((p) => p.active === false).length,
  rowsTestedByLeaveOneOut: tested,
  proposedDeletions: proposal.size,
  survivorsAbsorbingThem: targets.size,
  rowsKept: keep.size,
  batchProofFailures: batchFailures.length,
  edgeCases: Object.fromEntries(Object.entries(edge).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1])),
  edgeCaseRowsHeldBack: Object.values(edge).reduce((a, v) => a + v.length, 0),
  biggestAbsorbers: [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([id, n]) => ({ id, name: String(byId.get(id)?.name ?? "").trim(), zip: byId.get(id)?.zip ?? null, absorbs: n })),
};

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, "edge-cases.json"), JSON.stringify(edge, null, 2));
fs.writeFileSync(path.join(OUT, "deletions.json"), JSON.stringify(
  [...proposal].map(([id, target]) => ({
    id, name: String(byId.get(id)?.name ?? "").trim(),
    target, targetName: String(byId.get(target)?.name ?? "").trim(), targetZip: byId.get(target)?.zip ?? null,
  })), null, 2));
fs.writeFileSync(path.join(OUT, "keepers.json"), JSON.stringify([...keep].sort((a, b) => a - b), null, 2));

console.log(JSON.stringify(report, null, 2));
