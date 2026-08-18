// ============================================================================
// Which venues the tenant holds many times over, and which single row is worth
// keeping. Reads .tmp-data/places.json (node scripts/pull-places.mjs) — it never
// touches the tenant and never writes anything.
//
// A "duplicate" here is a row that resolves to the same place as a richer row:
// 632 rows named "Excel London, Royal Victoria Dock, 1 Western Gateway, London
// E16 1XL" with every field null are the same building as the one row named
// "ExCeL London" that carries the address, alias, postcode and coordinates.
//
// Rows literally named "placeholder" or "unknown" are NOT collapsed. 210 rows
// share the name "placeholder"; they are 210 venues nobody named, not 210 copies
// of one venue, and merging them would fuse unrelated jobs (Ben, 2026-08-18).
//
// Run: npx tsx scripts/venue-duplicates.ts [topN]
// ============================================================================
import { matchPlace, placeContext, normAddr } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";
import { readFileSync } from "node:fs";

const TOP = Number(process.argv[2] || 10);
const places = JSON.parse(readFileSync(".tmp-data/places.json", "utf8")) as PlaceCandidate[];

/** Names that are a placeholder for "we were never told", not a venue. */
const NOT_A_VENUE = /^(placeholder|unknown|tbc|tba|n\/?a|none|test)$/i;

const groups = new Map<string, PlaceCandidate[]>();
for (const p of places) {
  const k = normAddr(p.name);
  if (!k) continue;
  groups.set(k, [...(groups.get(k) ?? []), p]);
}

const ranked = [...groups.entries()]
  .filter(([, v]) => v.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

const excluded = ranked.filter(([, v]) => NOT_A_VENUE.test((v[0].name || "").trim()));
const real = ranked.filter(([, v]) => !NOT_A_VENUE.test((v[0].name || "").trim()));

console.log(`${places.length} places, ${groups.size} distinct names, ${ranked.length} names held more than once`);
if (excluded.length) {
  console.log(`\nNOT collapsed — a name meaning "we were never told", one row per real venue:`);
  for (const [, v] of excluded) console.log(`  ${String(v.length).padStart(4)}  ${v[0].name}`);
}

console.log(`\nTop ${TOP} duplicated venues — the row that survives is the one carrying the most context:\n`);
let retired = 0;
for (const [, v] of real.slice(0, TOP)) {
  // The survivor is whatever the resolver now picks for this venue's own text —
  // which is the point: the report and the booking path cannot disagree.
  const winnerId = matchPlace(v[0].name, places);
  const winner = places.find((p) => p.id === winnerId);
  const losers = v.filter((p) => p.id !== winnerId);
  retired += losers.length;
  const ctx = winner ? placeContext(winner) : 0;
  console.log(`  ${String(v.length).padStart(4)}x  ${(v[0].name || "").slice(0, 70)}`);
  console.log(`         keep #${winnerId} "${winner?.name}" (${ctx} fields: ${[winner?.address, winner?.city, winner?.zip, winner?.alias].filter(Boolean).join(", ") || "none"})`);
  console.log(`         retire ${losers.length} rows, ids ${losers.slice(0, 4).map((p) => p.id).join(", ")}${losers.length > 4 ? ", …" : ""}`);
  const outside = winner && !v.some((p) => p.id === winner.id);
  if (outside) console.log(`         (the survivor is NOT one of the ${v.length} — it is the properly-named record)`);
}
console.log(`\n${retired} rows would be retired across the top ${TOP}, ${((retired / places.length) * 100).toFixed(1)}% of the place list.`);
console.log(`Nothing was written. Retiring them is a tenant change and needs Ben's word.`);
