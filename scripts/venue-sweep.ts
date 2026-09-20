// ============================================================================
// The venue sweep: snapshot, reference scan, classification.
// ----------------------------------------------------------------------------
//   npx tsx scripts/venue-sweep.ts --snapshot   phase 0-1, read-only, slow
//   npx tsx scripts/venue-sweep.ts --classify   phase 2, read-only, offline
//
// Design: docs/VENUE-SWEEP-PLAN-2026-09-18.md. Tasks: docs/VENUE-SWEEP-TASKS-2026-09-18.md.
//
// This file WRITES NOTHING to OnSinch. The apply phase is deliberately a separate
// concern and does not exist yet; nothing here can be run in one command by mistake.
//
// It also never touches .tmp-data/place-dedupe/snapshot.json, which is the only way
// back from the August 2026 deletion of 1,293 rows.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "./_env.mjs";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";

export const OUT = path.join(".tmp-data", "venue-sweep-2026-09-18");

// ---------------------------------------------------------------- reference scan

/**
 * Live references to each place id, counted across every order and every slot team.
 *
 * `with=Job` returns Job as an ARRAY. Reading it as an object yields undefined on
 * every order and therefore an empty map — which reads as "no venue is referenced by
 * anything" and would licence deleting the whole pool. The array walk is pinned by
 * test/venueReferenceScan.ts, and the caller asserts the total is non-zero before any
 * of this is used.
 */
export function scanReferences(orders: any[]): Map<number, number> {
  const refs = new Map<number, number>();
  const bump = (v: unknown) => {
    const id = Number(v);
    if (!Number.isInteger(id) || id <= 0) return;
    refs.set(id, (refs.get(id) ?? 0) + 1);
  };
  for (const o of orders ?? []) {
    bump(o?.place_id);
    for (const j of Array.isArray(o?.Job) ? o.Job : []) {
      bump(j?.place_id);
      for (const t of Array.isArray(j?.SlotTeam) ? j.SlotTeam : []) {
        bump(t?.place_id);
        bump(t?.slotlocation_id);
      }
    }
  }
  return refs;
}

// ---------------------------------------------------------------- classification

export type Bucket =
  | "identical"
  | "same-name-diff-postcode"
  | "shell-into-locatable"
  | "shell-group"
  | "generic-bare"
  | "generic-with-data"
  | "sentinel"
  | "untouched";

export interface Group {
  bucket: Bucket;
  survivor: number;
  members: number[];
}

export interface Classified {
  groups: Group[];
  deletions: number[];
  byId: Map<number, Bucket>;
}

const n = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The ONLY name the engine looks up (compiler.ts, PLACEHOLDER_PLACE_NAME).
 *
 * August's guard was a regex matching placeholder|unknown|test and it held back 384
 * rows on the grounds that "the engine looks this row up BY NAME". It does — for one
 * string. The rule was protecting 210 rows named "Placeholder" and 171 named
 * "Unknown", every one bare, active, and a live match target for any vague wording.
 */
export const SENTINEL_NAME = "no location";

/** Names that identify no building. Task 6 moves this into venueMatch.ts and imports
 *  it back, so the sweep and the live resolver cannot disagree about what is generic. */
export const GENERIC =
  /^(london|uk|england|britain|location|no location|venue|site|warehouse|office|home|house|various|tbc|tba|unknown|n a|none|test|placeholder|private residence|client site|customer site|on site|onsite|city|central london|central|studio|hotel|church|school|hall|park|the venue|address|tbd)$/;

/** Nothing here locates a job: no postcode, no coordinates, no city, no alias, no
 *  note, and an address that is either absent or a second copy of the name. */
export const isBare = (p: any) =>
  !p.zip && !p.lat && !p.lng && !n(p.city) && !n(p.alias) && !n(p.note) &&
  (!n(p.address) || n(p.address) === n(p.name));

export const richness = (p: any) =>
  [p.address, p.city, p.zip, p.alias, p.lat, p.lng, p.note, p.region].filter(Boolean).length;

/** Richest row wins; ties break to the lowest id — the oldest, and the one the most
 *  orders already stand on. Usage is NOT consulted: see the note on classify. */
function elect(members: any[]): number {
  return [...members].sort((a, b) => richness(b) - richness(a) || Number(a.id) - Number(b.id))[0].id;
}

/**
 * REFERENCE COUNT IS NOT A PARAMETER HERE, AND THAT IS THE POINT.
 *
 * Ben, 2026-09-18: "an in use venue is not automatically kept. instead, we must still
 * look at it for duplicates."
 *
 * A venue being booked says nothing about whether it is a duplicate — the tenant's
 * busiest ExCeL row and its 800 clones were all "in use". If this function could see
 * usage it would eventually be tempted to skip the busy rows, which are exactly the
 * rows where a duplicate costs most. It cannot see usage, so it cannot skip them.
 * Usage enters in one place only, the apply phase, where all it may decide is delete
 * versus deactivate.
 */
export function classify(places: any[]): Classified {
  const byId = new Map<number, Bucket>();
  const groups: Group[] = [];
  const deletions: number[] = [];
  const claimed = new Set<number>();

  // Exactly one sentinel survives; any further "No Location" row is an ordinary
  // duplicate. It stays in `claimed` — un-claiming it would let the name-grouping
  // pass below put the sentinel's clone into a merge group.
  const sentinels = places
    .filter((p) => n(p.name) === SENTINEL_NAME)
    .sort((a, b) => Number(a.id) - Number(b.id));
  sentinels.forEach((p, i) => {
    const id = Number(p.id);
    claimed.add(id);
    if (i === 0) byId.set(id, "sentinel");
    else {
      byId.set(id, "generic-bare");
      deletions.push(id);
    }
  });

  for (const p of places) {
    const id = Number(p.id);
    if (claimed.has(id)) continue;
    if (!GENERIC.test(n(p.name))) continue;
    if (isBare(p)) {
      byId.set(id, "generic-bare");
      deletions.push(id);
    } else {
      byId.set(id, "generic-with-data");
    }
    claimed.add(id);
  }

  const byName = new Map<string, any[]>();
  for (const p of places) {
    const id = Number(p.id);
    if (claimed.has(id)) continue;
    const k = n(p.name);
    if (!k) continue;
    const g = byName.get(k);
    if (g) g.push(p);
    else byName.set(k, [p]);
  }

  for (const members of byName.values()) {
    if (members.length < 2) {
      byId.set(Number(members[0].id), "untouched");
      continue;
    }
    const zips = new Set(
      members.map((m) => String(m.zip ?? "").replace(/\s+/g, "").toUpperCase()).filter(Boolean)
    );
    const locatable = members.filter((m) => m.zip || m.lat);
    /**
     * The no-locatable-member case is NOT "different postcodes" — it is August's
     * `would_point_at_another_shell` class, 2,130 rows, the second largest population
     * in this sweep. Several rows share a name and not one of them can locate a job.
     * Collapsing them to the oldest is right; it does not make the survivor locatable,
     * so the bucket says so and the review doc shows it that way.
     */
    const bucket: Bucket =
      locatable.length > 1 && zips.size > 1 ? "same-name-diff-postcode"
      : locatable.length > 1 ? "identical"
      : locatable.length === 1 ? "shell-into-locatable"
      : "shell-group";
    groups.push({ bucket, survivor: elect(members), members: members.map((m) => Number(m.id)) });
    for (const m of members) byId.set(Number(m.id), bucket);
  }

  for (const p of places) if (!byId.has(Number(p.id))) byId.set(Number(p.id), "untouched");
  return { groups, deletions, byId };
}

// ---------------------------------------------------------------- phases

async function snapshot() {
  loadEnv();
  fs.mkdirSync(OUT, { recursive: true });
  const client = new OnsinchClient(
    httpTransport({ baseUrl: onsinchBase(), apiKey: requireEnv("ONSINCH_API_KEY") })
  );

  const places = await client.allPlaces();
  fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify(places, null, 1));
  console.log(`phase 0 SNAPSHOT: ${places.length} places -> ${OUT}/snapshot.json`);

  const orders = await client.allOrders();
  const refs = scanReferences(orders);
  if (refs.size === 0) {
    console.log(
      `FATAL: scanned ${orders.length} orders and found zero place references. ` +
        `Refusing to write a reference file that would read as "nothing is in use".`
    );
    process.exit(1);
  }
  fs.writeFileSync(
    path.join(OUT, "references.json"),
    JSON.stringify(Object.fromEntries(refs), null, 1)
  );
  const unreferenced = places.filter((p: any) => !refs.has(Number(p.id))).length;
  console.log(`phase 1 REFERENCES: ${orders.length} orders -> ${refs.size} places referenced`);
  console.log(`  unreferenced places: ${unreferenced} of ${places.length}`);
}

function classifyPhase() {
  const places = JSON.parse(fs.readFileSync(path.join(OUT, "snapshot.json"), "utf8"));
  const c = classify(places);
  const counts: Record<string, number> = {};
  for (const b of c.byId.values()) counts[b] = (counts[b] ?? 0) + 1;
  const groupCounts: Record<string, number> = {};
  for (const g of c.groups) groupCounts[g.bucket] = (groupCounts[g.bucket] ?? 0) + 1;

  fs.writeFileSync(
    path.join(OUT, "classification.json"),
    JSON.stringify({ groups: c.groups, deletions: c.deletions }, null, 1)
  );
  console.log(`phase 2 CLASSIFY: ${places.length} places`);
  console.log(`  rows by bucket:   ${JSON.stringify(counts)}`);
  console.log(`  groups by bucket: ${JSON.stringify(groupCounts)}`);
  console.log(`  generic+bare deletions: ${c.deletions.length}`);
  console.log(`  HUMAN DECISIONS: ${c.groups.length} groups + generic-bare, by name`);

  const sentinels = [...c.byId.entries()].filter(([, b]) => b === "sentinel");
  if (sentinels.length !== 1) {
    console.log(`  FATAL: expected exactly 1 sentinel, found ${sentinels.length}`);
    process.exit(1);
  }
  console.log(`  sentinel: id ${sentinels[0][0]} — exempt from every phase`);
}

/**
 * Guarded on the ENTRY file, not just on the flags.
 *
 * venue-sweep2.ts imports GENERIC and SENTINEL_NAME from here so the two sweeps
 * cannot disagree about what is generic. Without this guard that import re-ran this
 * file's dispatch: `npx tsx scripts/venue-sweep2.ts --snapshot` fired BOTH snapshots,
 * and the v1 one overwrote the 09-18 snapshot on its way to exiting non-zero.
 */
if (/venue-sweep\.[tj]s$/.test(process.argv[1] ?? "")) {
  if (process.argv.includes("--snapshot")) snapshot();
  else if (process.argv.includes("--classify")) classifyPhase();
  else console.log("pick a phase: --snapshot (live, read-only) or --classify (offline)");
}
