# Venue Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the tenant's duplicate venues under human verification, delete the 391 generic-and-bare rows, and close the code path that manufactures new ones — then measure what it did to venue accuracy.

**Architecture:** Read-only classification first, then a published artifact where Ben marks every group, then a single write phase gated on a live order-reference scan, then the engine change, then a before/after measurement on the free study leg. Nothing writes to OnSinch until a mark exists for it.

**Tech Stack:** TypeScript, `tsx` scripts, Next.js app under `app/lib/engine/`, Neon (`@neondatabase/serverless`), OnSinch REST, Artifact for the verification doc.

**Spec:** `docs/VENUE-SWEEP-PLAN-2026-09-18.md` — read it before Task 1. The invariants in its §5 are load-bearing and this plan does not repeat all of them.

## Global Constraints

- **`6922 "No Location"` is exempt from every phase.** Never delete, never deactivate, never merge. It is `PLACEHOLDER_PLACE_NAME` in `compiler.ts:296` and the engine looks it up by name.
- **There must be exactly one row named "No Location".** Any duplicate of it is bucket D.
- **Never overwrite a populated field** in a union PATCH. Merging adds information only.
- **An in-use venue is not automatically kept.** Usage never exempts a row from duplicate analysis. `classify` cannot see reference count at all — it is not a parameter. A busy row can be a loser; its usage only forces deactivate instead of delete.
- **Zero references is permission to delete, never a reason to.** A row is removed only when every condition holds: its bucket's action is removal, a person marked it, it is not the survivor, and it is not the sentinel. Only then does the reference count choose between delete and deactivate. Default is keep. Most of the tenant is unreferenced and most of it is fine.
- **Reference count, not OnSinch's refusal, separates delete from deactivate.** `DELETE /places` has been caught reporting success without deleting (`4f0f795`).
- **`with=Job` returns Job as an ARRAY.** `order.Job.min_beginning` is undefined on every order in this tenant.
- **Similarity is never the merge test.** Use the leave-one-out resolver test from the spec §3.
- **Batch size 50, stop after 5 unexpected failures, log every write before sending it.**
- **"Already gone" counts as done, not as a refusal** (the August stop-guard tripped on this).
- Test runner is `tsx`. A single test file runs as `npx tsx test/<name>.ts`; the whole suite is `npm test`.
- New scripts go in `scripts/`, new tests in `test/`, and a new test must be added to `test/all.ts`.
- Output directory for this run is `.tmp-data/venue-sweep-2026-09-18/`. **Never write to `.tmp-data/place-dedupe/snapshot.json`** — it is the only way back from the August deletion.

---

### Task 1: Snapshot and the order-reference scan

**Files:**
- Create: `scripts/venue-sweep.ts`
- Modify: `app/lib/engine/onsinch.ts` — add a public `allOrders()`
- Test: `test/venueReferenceScan.ts`

**Note:** `listAll` is `private` (`onsinch.ts:728`), so `client.listAll(...)` will not
compile. Add a public wrapper beside `allPlaces()`, matching that pattern:

```typescript
/** Every order with its Jobs, for the venue reference scan. ~7,066 today, paged. */
async allOrders() {
  return this.listAll("/orders", { with: "Job" });
}
```

**Interfaces:**
- Produces: `scanReferences(orders: any[]): Map<number, number>` — place id -> count of live order references. Exported from `scripts/venue-sweep.ts` for the test.
- Produces: `.tmp-data/venue-sweep-2026-09-18/snapshot.json` (all places) and `references.json` (`{ [placeId]: count }`).

- [ ] **Step 1: Write the failing test**

```typescript
// test/venueReferenceScan.ts
import { scanReferences } from "../scripts/venue-sweep";

let fails = 0;
const ok = (c: boolean, label: string) => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); };

// Job is an ARRAY. An implementation that reads order.Job.place_id sees undefined
// on every row and returns an empty map, which would licence deleting the pool.
const ORDERS = [
  { id: 1, place_id: 49, Job: [{ id: 11, SlotTeam: [{ id: 101, place_id: 49 }, { id: 102, place_id: 57 }] }] },
  { id: 2, place_id: 57, Job: [{ id: 12, SlotTeam: [{ id: 103, slotlocation_id: 226 }] }] },
  { id: 3, place_id: null, Job: [] },
];

const refs = scanReferences(ORDERS);
ok(refs.get(49) === 2, "49 counted from both the order and its slot team");
ok(refs.get(57) === 2, "57 counted from a slot team and an order");
ok(refs.get(226) === 1, "slotlocation_id counts as a reference");
ok(refs.get(999) === undefined, "an unreferenced place has no entry");
ok(refs.size === 3, "no phantom entries from the null place_id");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx test/venueReferenceScan.ts`
Expected: FAIL — `scanReferences` is not exported from `scripts/venue-sweep.ts` (module not found or undefined).

- [ ] **Step 3: Write the minimal implementation**

```typescript
// scripts/venue-sweep.ts
import fs from "node:fs";
import path from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "./_env.mjs";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";

export const OUT = path.join(".tmp-data", "venue-sweep-2026-09-18");

/**
 * Live references to each place. `with=Job` returns Job as an ARRAY — reading it as an
 * object yields undefined everywhere and an empty map, which reads as "nothing is
 * referenced" and would licence deleting the whole pool. Hence the array walk and the
 * non-zero assertion at the call site.
 */
export function scanReferences(orders: any[]): Map<number, number> {
  const refs = new Map<number, number>();
  const bump = (v: unknown) => {
    const id = Number(v);
    if (!Number.isInteger(id) || id <= 0) return;
    refs.set(id, (refs.get(id) ?? 0) + 1);
  };
  for (const o of orders) {
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

async function snapshot() {
  loadEnv();
  fs.mkdirSync(OUT, { recursive: true });
  const client = new OnsinchClient(httpTransport({ baseUrl: onsinchBase(), apiKey: requireEnv("ONSINCH_API_KEY") }));

  const places = await client.allPlaces();
  fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify(places, null, 1));
  console.log(`snapshot: ${places.length} places`);

  const orders = await client.allOrders();
  const refs = scanReferences(orders);
  if (refs.size === 0) {
    console.log("FATAL: scanned " + orders.length + " orders and found zero place references — refusing to write a reference file that would licence deleting everything");
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUT, "references.json"), JSON.stringify(Object.fromEntries(refs), null, 1));
  console.log(`references: ${orders.length} orders -> ${refs.size} places referenced`);
  console.log(`  unreferenced places: ${places.filter((p: any) => !refs.has(Number(p.id))).length}`);
}

if (process.argv.includes("--snapshot")) snapshot();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx test/venueReferenceScan.ts`
Expected: PASS on all five assertions.

- [ ] **Step 5: Run it against the live tenant (read-only)**

Run: `npx tsx scripts/venue-sweep.ts --snapshot`
Expected: ~5,649 places, a non-zero reference count, and a printed count of unreferenced places. This is slow (~7,066 orders, paged) and free. If it prints FATAL, stop and diagnose — do not proceed.

- [ ] **Step 6: Register the test and commit**

Add `venueReferenceScan` to `test/all.ts` alongside the existing entries, then:

```bash
git add scripts/venue-sweep.ts test/venueReferenceScan.ts test/all.ts
git commit -m "Deleting a venue is gated on who points at it, not on OnSinch's refusal"
```

---

### Task 2: Classification into the six buckets

**Files:**
- Modify: `scripts/venue-sweep.ts`
- Test: `test/venueClassify.ts`

**Interfaces:**
- Consumes: `.tmp-data/venue-sweep-2026-09-18/snapshot.json` **only**. It deliberately does NOT consume `references.json`.
- Produces: `classify(places: any[]): Classified` where

```typescript
export type Bucket = "identical" | "same-name-diff-postcode" | "shell-into-locatable" | "generic-bare" | "generic-with-data" | "sentinel" | "untouched";
export interface Group { bucket: Bucket; survivor: number; members: number[]; }
export interface Classified { groups: Group[]; deletions: number[]; byId: Map<number, Bucket>; }
```

- [ ] **Step 1: Write the failing test**

```typescript
// test/venueClassify.ts
import { classify } from "../scripts/venue-sweep";

let fails = 0;
const ok = (c: boolean, label: string) => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); };

const P = [
  // identical: same normalised name, same postcode. Survivor is the richest; ties -> lowest id.
  { id: 9,    name: "Fairmont Windsor Park", zip: "TW20 0YL", city: "Egham", active: true },
  { id: 6835, name: "Fairmont Windsor Park", zip: "TW20 0YL", active: true },
  { id: 6837, name: "Fairmont Windsor Park", zip: "TW20 0YL", active: true },
  // same name, different postcode -> never auto-merged
  { id: 8,   name: "Battersea Power Station", zip: "SW11 8DD", active: true },
  { id: 312, name: "Battersea Power Station", zip: "SW11 8BZ", active: true },
  // generic AND bare -> delete
  { id: 1809, name: "Placeholder", active: true },
  { id: 2100, name: "Unknown", active: true },
  { id: 2069, name: "London", active: true },
  // generic WITH data -> kept, never deleted
  { id: 60, name: "Private Residence", zip: "N10 1NT", active: true },
  // the sentinel -> exempt
  { id: 6922, name: "No Location", active: true },
  // ordinary row -> untouched
  { id: 49, name: "ExCel London", zip: "E16 1XL", address: "1 Western Gateway", active: true },
];

const c = classify(P);

ok(c.byId.get(6922) === "sentinel", "No Location is the sentinel");
ok(!c.deletions.includes(6922), "the sentinel is never deleted");
ok(c.byId.get(60) === "generic-with-data", "Private Residence carries a postcode, so it is not bare");
ok(!c.deletions.includes(60), "a generic row with data is never deleted");
ok(c.deletions.includes(1809) && c.deletions.includes(2100) && c.deletions.includes(2069), "generic AND bare rows are deletions");
ok(c.byId.get(49) === "untouched", "an ordinary locatable row is untouched");

const fair = c.groups.find((g) => g.members.includes(6835));
ok(fair?.bucket === "identical", "same name + same postcode is the identical bucket");
ok(fair?.survivor === 9, "survivor is the richest row (9 has a city), not the lowest id by accident");
ok(fair?.members.length === 3, "all three Fairmont rows are in one group");

const bat = c.groups.find((g) => g.members.includes(312));
ok(bat?.bucket === "same-name-diff-postcode", "different postcodes never land in identical");

// An in-use venue is not automatically kept — it is still examined for duplicates, and
// it may lose. Row 6835 below stands in for a heavily-booked duplicate: classification
// never sees usage, so it is grouped like any other row. What its usage decides is only
// HOW it is removed, and removalFor (Task 4) answers "deactivate", never "delete".
ok(fair?.members.includes(6835), "a busy duplicate is still grouped for merging");
ok(fair?.survivor === 9, "the survivor is the row with the most data, not the one most booked");
// classify's signature takes no reference map, so usage CANNOT gate this. The guarantee
// is structural, not a promise in a comment. If someone later adds a refs parameter,
// this line stops compiling, which is the alarm.
ok(classify.length === 1, "classify takes exactly one argument and cannot see usage");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx test/venueClassify.ts`
Expected: FAIL — `classify` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/venue-sweep.ts`:

```typescript
export type Bucket = "identical" | "same-name-diff-postcode" | "shell-into-locatable" | "shell-group" | "generic-bare" | "generic-with-data" | "sentinel" | "untouched";
export interface Group { bucket: Bucket; survivor: number; members: number[]; }
export interface Classified { groups: Group[]; deletions: number[]; byId: Map<number, Bucket>; }

const n = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The ONLY name the engine looks up. compiler.ts:296. Not a regex — the August
 *  sentinel guard was a regex and it protected 381 rows the engine has no use for. */
export const SENTINEL_NAME = "no location";

/** Defined here for now; **Task 6 moves it to `venueMatch.ts`** and imports it back, so
 *  the sweep and the live resolver cannot disagree about what "generic" means. Do not
 *  fork a second copy in the meantime. */
export const GENERIC = /^(london|uk|england|britain|location|no location|venue|site|warehouse|office|home|house|various|tbc|tba|unknown|n a|none|test|placeholder|private residence|client site|customer site|on site|onsite|city|central london|central|studio|hotel|church|school|hall|park|the venue|address|tbd)$/;

/** No postcode, no coordinates, no city, no alias, no note, and an address that is
 *  either empty or a copy of the name. Nothing here locates a job. */
export const isBare = (p: any) =>
  !p.zip && !p.lat && !p.lng && !n(p.city) && !n(p.alias) && !n(p.note) &&
  (!n(p.address) || n(p.address) === n(p.name));

export const richness = (p: any) =>
  [p.address, p.city, p.zip, p.alias, p.lat, p.lng, p.note, p.region].filter(Boolean).length;

/** Richest row wins; ties break to the lowest id, which is the oldest and the one
 *  most orders already point at. */
function elect(members: any[]): number {
  return [...members].sort((a, b) => richness(b) - richness(a) || Number(a.id) - Number(b.id))[0].id;
}

/**
 * REFERENCE COUNT IS NOT A PARAMETER HERE, AND THAT IS THE POINT.
 *
 * Ben, 2026-09-18: "an in use venue is not automatically kept. instead, we must still
 * look at it for duplicates."
 *
 * A venue being booked says nothing about whether it is a duplicate — the tenant's most
 * heavily used ExCeL row and its 800 clones are all "in use". If this function could see
 * usage it would eventually be tempted to skip the busy rows, which are exactly the rows
 * where a duplicate costs the most. It cannot see usage, so it cannot skip them.
 * Reference count enters in exactly one place, `removalFor`, where all it may decide is
 * delete versus deactivate.
 */
export function classify(places: any[]): Classified {
  const byId = new Map<number, Bucket>();
  const groups: Group[] = [];
  const deletions: number[] = [];
  const claimed = new Set<number>();

  for (const p of places) {
    if (n(p.name) === SENTINEL_NAME) { byId.set(Number(p.id), "sentinel"); claimed.add(Number(p.id)); }
  }
  // Exactly one sentinel survives. Any further "No Location" row is an ordinary duplicate.
  const sentinels = places.filter((p) => n(p.name) === SENTINEL_NAME).sort((a, b) => Number(a.id) - Number(b.id));
  for (const extra of sentinels.slice(1)) {
    byId.set(Number(extra.id), "generic-bare");
    deletions.push(Number(extra.id));
    // NOTE: it stays in `claimed`. Un-claiming it here would let the name-grouping pass
    // below pick it up again and put the sentinel's duplicate into a merge group, which
    // is the one row that must never be a merge member.
  }

  for (const p of places) {
    const id = Number(p.id);
    if (claimed.has(id) || byId.has(id)) continue;
    if (GENERIC.test(n(p.name))) {
      if (isBare(p)) { byId.set(id, "generic-bare"); deletions.push(id); }
      else byId.set(id, "generic-with-data");
      claimed.add(id);
    }
  }

  const byName = new Map<string, any[]>();
  for (const p of places) {
    const id = Number(p.id);
    if (claimed.has(id)) continue;
    const k = n(p.name);
    if (!k) continue;
    const g = byName.get(k);
    if (g) g.push(p); else byName.set(k, [p]);
  }

  for (const members of byName.values()) {
    if (members.length < 2) { byId.set(Number(members[0].id), "untouched"); continue; }
    const zips = new Set(members.map((m) => String(m.zip ?? "").replace(/\s+/g, "").toUpperCase()).filter(Boolean));
    const locatable = members.filter((m) => m.zip || m.lat);
    /**
     * The no-locatable-member case is NOT "different postcodes" — it is August's
     * `would_point_at_another_shell` class, 2,130 rows, the second largest thing this
     * sweep exists to fix. Several rows share a name and not one of them can locate a
     * job. Collapsing them to the oldest is right (it is the tenant's only record of
     * that name), but it does not make the survivor locatable, so the group is marked
     * as such and the doc shows it that way.
     */
    const bucket: Bucket =
      locatable.length > 1 && zips.size > 1 ? "same-name-diff-postcode"
      : locatable.length > 1 ? "identical"
      : locatable.length === 1 ? "shell-into-locatable"
      : "shell-group";
    const survivor = elect(members);
    groups.push({ bucket, survivor, members: members.map((m) => Number(m.id)) });
    for (const m of members) byId.set(Number(m.id), bucket);
  }

  for (const p of places) if (!byId.has(Number(p.id))) byId.set(Number(p.id), "untouched");
  return { groups, deletions, byId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx test/venueClassify.ts`
Expected: PASS on all eleven assertions.

- [ ] **Step 5: Run the classifier over the live snapshot**

Add a `--classify` branch that loads the snapshot and references from Task 1, runs `classify`, writes `classification.json`, and prints a per-bucket count. Run it.

Expected, from the 2026-09-18 census: roughly 391 in `generic-bare`, 69 groups with two or more locatable members split across `identical` and `same-name-diff-postcode`, and exactly 1 `sentinel`. **If `generic-bare` is materially above 392 or the sentinel count is not 1, stop.**

- [ ] **Step 6: Register the test and commit**

```bash
git add scripts/venue-sweep.ts test/venueClassify.ts test/all.ts
git commit -m "The sentinel is one row named No Location, not a regex matching its clones"
```

---

### Task 3: The verification artifact

**Files:**
- Create: `scripts/venue-sweep-doc.ts` (renders the artifact HTML from `classification.json`)
- Create: `.tmp-data/venue-sweep-2026-09-18/verify.html` (generated, not committed)

**Interfaces:**
- Consumes: `classification.json` from Task 2, `snapshot.json` and `references.json` from Task 1.
- Produces: a published Artifact whose stored decisions are readable as `{ groupKey: "merge" | "keep-separate" | "delete" | "skip" }`.

- [ ] **Step 1: Read the capabilities skill**

The page must persist Ben's marks so the apply step can read them back. Load the `artifact-capabilities` skill **before** writing the page, and declare the `db` capability. Do not invent the API from memory.

- [ ] **Step 2: Generate the page**

One entry per group in buckets `identical`, `same-name-diff-postcode`, `shell-into-locatable`, and one per row in `generic-bare`. Each entry shows, and shows nothing else:

- every member row: `id`, `name`, `zip`, populated-field count, **live reference count**
- the elected survivor, marked
- the exact fields the union PATCH would move onto the survivor
- the action buttons: `merge` / `keep-separate` / `delete` / `skip`

Sort so the highest-reference-count groups come first — those are the ones where a wrong call costs the most.

- [ ] **Step 3: Publish it and give Ben the link**

Publish via the Artifact tool. Do not proceed to Task 4 until marks exist.

- [ ] **Step 4: Commit the generator**

```bash
git add scripts/venue-sweep-doc.ts
git commit -m "Every venue merge is marked by a person before anything is written"
```

---

### Task 4: Apply — the only phase that writes to OnSinch

**Files:**
- Modify: `scripts/venue-sweep.ts`
- Test: `test/venueApplyGuards.ts`

**Interfaces:**
- Consumes: the marks from Task 3, `classification.json`, `references.json`.
- Produces: `.tmp-data/venue-sweep-2026-09-18/actions.jsonl`, one line per write, appended **before** the write is sent.

- [ ] **Step 1: Write the failing test**

```typescript
// test/venueApplyGuards.ts
import { unionPatch, removalFor } from "../scripts/venue-sweep";

let fails = 0;
const ok = (c: boolean, label: string) => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); };

const survivor = { id: 9, name: "Fairmont Windsor Park", zip: "TW20 0YL", city: "Egham" };
const losers = [
  { id: 6835, name: "Fairmont Windsor Park", zip: "TW20 0YL", address: "Bishopsgate Rd" },
  { id: 6837, name: "Fairmont Windsor Park", zip: "TW99 9ZZ", note: "gate code 1234" },
];

const patch = unionPatch(survivor, losers);
ok(patch.address === "Bishopsgate Rd", "a field the survivor lacks is taken from a loser");
ok(patch.note === "gate code 1234", "notes are carried across too");
ok(patch.zip === undefined, "a POPULATED field is never overwritten, even by a different value");
ok(patch.city === undefined, "an unchanged populated field is not re-sent");

// Zero references is PERMISSION to delete, never a reason. Every other condition must
// pass first, and the default is to keep the row.
const R = (o: Partial<Parameters<typeof removalFor>[0]>) =>
  removalFor({ id: 1, bucket: "identical", mark: "merge", isSurvivor: false, refs: new Map(), ...o } as any);

ok(R({}) === "delete", "a marked loser with no references is deleted");
ok(R({ refs: new Map([[1, 3]]) }) === "deactivate", "a marked loser WITH references is deactivated, never deleted");
ok(R({ mark: undefined }) === "keep", "an unmarked row is kept however many zero references it has");
ok(R({ mark: "skip" }) === "keep", "a skipped row is kept");
ok(R({ mark: "keep-separate" }) === "keep", "keep-separate means keep");
ok(R({ isSurvivor: true }) === "keep", "the survivor of a merge is never removed");
ok(R({ bucket: "sentinel", mark: "delete" }) === "keep", "the sentinel is kept even if marked for deletion");
ok(R({ bucket: "generic-with-data", mark: "delete" }) === "keep", "a generic row carrying data is never deleted");
ok(R({ bucket: "untouched", mark: "delete" }) === "keep", "an untouched row is not in scope at all");
ok(R({ bucket: "generic-bare", mark: "delete" }) === "delete", "generic AND bare AND marked AND unreferenced");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx test/venueApplyGuards.ts`
Expected: FAIL — `unionPatch` and `removalFor` are not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
/** Adds information, never chooses between two facts. A field the survivor already
 *  holds is left alone even when a loser disagrees — that disagreement is a question
 *  for a person, and the losing row is about to stop being consulted anyway. */
export function unionPatch(survivor: any, losers: any[]): Record<string, unknown> {
  const FIELDS = ["address", "city", "zip", "alias", "lat", "lng", "note", "region"] as const;
  const patch: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (survivor[f]) continue;
    const donor = losers.find((l) => l[f]);
    if (donor) patch[f] = donor[f];
  }
  return patch;
}

export type Mark = "merge" | "keep-separate" | "delete" | "skip";
export type Removal = "keep" | "deactivate" | "delete";

/**
 * ZERO REFERENCES IS PERMISSION TO DELETE, NOT A REASON TO.
 *
 * Most of the tenant is unreferenced — a venue nobody has booked yet is unreferenced,
 * and it is a perfectly good row. Deletion needs EVERY condition: the row is in a
 * bucket whose action is removal, a person marked it, it is not the survivor, it is not
 * the sentinel, and only then does the reference count choose between delete and
 * deactivate. The default is keep, and anything unrecognised falls through to it.
 *
 * Reference count, not OnSinch's refusal, is what separates delete from deactivate —
 * DELETE /places has been caught reporting success on rows it did not delete (4f0f795).
 */
export function removalFor(args: {
  id: number;
  bucket: Bucket;
  mark: Mark | undefined;
  isSurvivor: boolean;
  refs: Map<number, number>;
}): Removal {
  const { id, bucket, mark, isSurvivor, refs } = args;

  if (bucket === "sentinel") return "keep";
  if (bucket === "generic-with-data") return "keep";
  if (bucket === "untouched") return "keep";
  if (isSurvivor) return "keep";
  if (mark === undefined || mark === "skip" || mark === "keep-separate") return "keep";

  const removable =
    (mark === "delete" && bucket === "generic-bare") ||
    (mark === "merge" && (bucket === "identical" || bucket === "same-name-diff-postcode" ||
                          bucket === "shell-into-locatable" || bucket === "shell-group"));
  if (!removable) return "keep";

  return (refs.get(Number(id)) ?? 0) > 0 ? "deactivate" : "delete";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx test/venueApplyGuards.ts`
Expected: PASS on all seven assertions.

- [ ] **Step 5: Wire the apply branch**

Add `--apply` (dry by default, writes only with `--commit`). In this order, and no other:

1. Repoint `entity_aliases`: for every marked merge, `UPDATE entity_aliases SET entity_id = <survivor> WHERE kind = 'place' AND entity_id = <loser>`. Also correct the poisoned row: `rg jones sound engineering` -> company **457 "RG Jones"**, not 146.
2. PATCH each survivor with `unionPatch`, skipping empty patches.
3. Remove each loser per `removalFor`, **reading the row back afterwards** with `searchPlaces({ id })` and recording what actually happened. A row that is still present after a `delete` is recorded as `delete-failed` and then deactivated.

Batches of 50. Append to `actions.jsonl` before each write. Stop after 5 unexpected failures; "not found" on a delete counts as done.

- [ ] **Step 6: Dry run, then commit the code**

Run: `npx tsx scripts/venue-sweep.ts --apply`
Expected: a full plan printed, zero writes sent.

```bash
git add scripts/venue-sweep.ts test/venueApplyGuards.ts test/all.ts
git commit -m "A merge adds fields to the survivor and never overwrites one"
```

- [ ] **Step 7: Measure BEFORE, then run for real**

Run `npm run harness` (or the free study leg per `study/`) and record the venue gate. Then `npx tsx scripts/venue-sweep.ts --apply --commit`.

---

### Task 5: One not-found exit, with the address preserved

**Files:**
- Modify: `app/lib/engine/compiler.ts:379-402` (`unresolvedVenue`) and the `resolvePlace` return type at `compiler.ts:657-663`, which must gain `venue_text?: string` or `venue_text` will not survive the call
- Modify: `test/venueCreatesOnUnresolved.ts` (its ruling changes for the third time)
- Test: `test/venueHoldsAndKeepsTheAddress.ts`

**Interfaces:**
- Produces: `unresolvedVenue` never returns a `provision`. It returns `{ id: <placeholder id>, note, venue_text?: string }` where `venue_text` is the client's wording for the slot-team `description`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/venueHoldsAndKeepsTheAddress.ts
// Ben, 2026-09-18: ONE "No Location" resolves in every not-found exit the engine has.
// Ben, 2026-09-03: parking a miss there must not throw the client's address away —
// "a discarded address is a phone call". Both hold: the id goes to the placeholder,
// the wording goes onto the job in the slot-team description.
import { resolvePlace } from "../app/lib/engine/compiler";
import type { ConversationFacts, PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (c: boolean, label: string) => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); };

const PLACES: PlaceCandidate[] = [
  { id: 49,   name: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 6922, name: "No Location", active: true },
];
const go = (location_text?: string) =>
  resolvePlace({ location_text } as ConversationFacts, undefined, { allPlaces: async () => PLACES } as any);

(async () => {
  const miss = await go("The Tithe Barn, Somewhere Lane");
  ok(miss.id === 6922, "an unmatched venue holds at the one placeholder");
  ok(miss.provision === undefined, "no venue row is created, ever");
  ok(String(miss.venue_text) === "The Tithe Barn, Somewhere Lane", "the client's wording is kept for the job");

  const silent = await go(undefined);
  ok(silent.id === 6922, "a thread naming no venue holds at the same row");
  ok(silent.venue_text === undefined, "there is nothing to carry from silence");

  const city = await go("Birmingham");
  ok(city.id === 6922, "a city identifies no building, so it holds too");

  const hit = await go("ExCeL London");
  ok(hit.id === 49, "a real match is unaffected");

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx test/venueHoldsAndKeepsTheAddress.ts`
Expected: FAIL on the first miss case — it currently returns a `provision` and no `id`.

- [ ] **Step 3: Change `unresolvedVenue`**

Replace the provisioning branch at `compiler.ts:389-401` so all three exits return `holdAtPlaceholder`, and carry the wording:

```typescript
function unresolvedVenue(
  places: PlaceCandidate[],
  locationText: string,
  why: string,
  missingVenue: boolean
): { id?: number; provision?: DesiredOrder["provision_place"]; note: string; venue_text?: string } {
  if (missingVenue) return holdAtPlaceholder(places, why);
  if (!namesAPlace(locationText)) {
    return holdAtPlaceholder(places, `${why} — and it names no building, so no venue was created; set the real venue in OnSinch`);
  }
  /**
   * THE ROW IS NOT CREATED, THE ADDRESS IS NOT LOST, AND BOTH HALVES MATTER.
   *
   * Ben ruled twice on this branch and the second ruling was right about the cost it
   * named: "a duplicate is a row a person merges; a discarded address is a phone call"
   * (2026-09-03). What the two rulings had entangled is that keeping the address and
   * owning a venue row are separable. The wording rides onto the job in the slot-team
   * description, which is the field a job sheet prints, and the tenant gains nothing.
   *
   * Of 19 rows this branch once provisioned, 1 was genuinely new.
   */
  const held = holdAtPlaceholder(places, `${why} — held at the placeholder; the venue the client wrote is on the job, set the real one in OnSinch`);
  return { ...held, venue_text: locationText };
}
```

Then thread `venue_text` through to the slot-team `description` where `compose.ts` builds teams, appending rather than replacing any existing description.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx test/venueHoldsAndKeepsTheAddress.ts`
Expected: PASS on all seven assertions.

- [ ] **Step 5: Update the file that owns the old ruling**

`test/venueCreatesOnUnresolved.ts` asserts the behaviour just removed. Rewrite its header to carry the **third** ruling and the reason the second one survives inside it, and change its assertions to the new shape. Do not delete the file — it is the record of how this decision moved.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: green. `test/venueResolution.ts` pins the four branches of `resolvePlace` and will need its provisioning branch updated too.

- [ ] **Step 7: Commit**

```bash
git add app/lib/engine/compiler.ts app/lib/engine/compose.ts test/
git commit -m "An unmatched venue holds at the one placeholder and keeps the client's address on the job"
```

---

### Task 6: `active` becomes a filter, and generic rows stop being targets

**Files:**
- Modify: `app/lib/engine/venueMatch.ts:383`, `app/lib/engine/resolve.ts:292`
- Test: `test/venuePoolExcludes.ts`

**Interfaces:**
- Produces: no signature change. Deactivated rows and generic-named rows cease to be candidates.

- [ ] **Step 1: Write the failing test**

```typescript
// test/venuePoolExcludes.ts
import { matchPlaceV2 } from "../app/lib/engine/venueMatch";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (c: boolean, label: string) => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); };

const PLACES: PlaceCandidate[] = [
  { id: 49,  name: "ExCel London", zip: "E16 1XL", address: "1 Western Gateway", active: true },
  { id: 600, name: "Old Hall", zip: "E16 1XL", active: false },
  { id: 60,  name: "Private Residence", zip: "N10 1NT", active: true },
];

const retired = matchPlaceV2("Old Hall", PLACES);
ok(retired.place_id !== 600, "a deactivated row is not a candidate, even as the only match");

const generic = matchPlaceV2("private residence", PLACES);
ok(generic.place_id !== 60, "a generic name never resolves to a specific house");

const real = matchPlaceV2("ExCeL London", PLACES);
ok(real.place_id === 49, "an ordinary match is unaffected");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx test/venuePoolExcludes.ts`
Expected: FAIL on the first two — `active` is currently only a ranking nudge and generic names match freely.

- [ ] **Step 3: Implement**

In both `venueMatch.ts` and `resolve.ts`, filter the candidate list before ranking rather than boosting within it. Export the `GENERIC` pattern from one place (`venueMatch.ts`) and have `scripts/venue-sweep.ts` import it, so the sweep and the resolver cannot disagree about what "generic" means.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx test/venuePoolExcludes.ts`
Expected: PASS on all three.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`

```bash
git add app/lib/engine/venueMatch.ts app/lib/engine/resolve.ts scripts/venue-sweep.ts test/venuePoolExcludes.ts test/all.ts
git commit -m "A retired venue and a generic name are not answers the resolver may give"
```

---

### Task 7: Measure

**Files:**
- Modify: `docs/VENUE-SWEEP-PLAN-2026-09-18.md` (add a results section)

- [ ] **Step 1: Run the free study leg**

Run: `npm run harness` — deterministic, offline, ~17s for 500 threads, zero model calls. Record the venue gate against the before figure from Task 4 Step 7.

- [ ] **Step 2: Re-derive the live venue numbers**

Re-run the 09-15 query that produced "290 threads resolved a place, 59 (20.3%) on a shell, 25 (8.6%) on a place naming no venue". Compare.

- [ ] **Step 3: Write the result into the spec and commit**

Record both numbers, before and after, and whether the `active` filter cost any bookings. If venue accuracy did not move, say so plainly — the spec's §8 names that risk and the measurement is what settles it.

```bash
git add docs/VENUE-SWEEP-PLAN-2026-09-18.md
git commit -m "Venue accuracy after the sweep: <before> -> <after> on the free leg"
```
