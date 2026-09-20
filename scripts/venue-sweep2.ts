// ============================================================================
// Venue sweep v2 — provenance first.
// ----------------------------------------------------------------------------
//   npx tsx scripts/venue-sweep2.ts --provenance   n8n executions -> venue strings
//   npx tsx scripts/venue-sweep2.ts --snapshot     places + usage map (live read)
//   npx tsx scripts/venue-sweep2.ts --plan         -> decisions.json (offline)
//
// Design: docs/VENUE-SWEEP2-PLAN-2026-09-20.md.
//
// NOTHING HERE WRITES TO ONSINCH. The apply phase lives in scripts/venue-review.mjs
// behind an approval file, so no single command can be run by mistake and mutate the
// tenant. This file also never touches .tmp-data/place-dedupe/snapshot.json, which is
// the only way back from the August 2026 deletion of 1,293 rows.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "./_env.mjs";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { GENERIC, SENTINEL_NAME } from "./venue-sweep";

export const OUT = path.join(".tmp-data", "venue-sweep2");

/** The one workflow of 113 that generates and sends mail to spartancrew.co.uk. */
export const STRESS_WF = "ePmN0J3jma6WFLwj";

// ---------------------------------------------------------------- primitives

export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Text before the first comma. The collapse key, and the name half of an address. */
export const lead = (s: unknown) => norm(String(s ?? "").split(",")[0]);

const PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;
export function postcodes(s: unknown): string[] {
  const out: string[] = [];
  for (const m of String(s ?? "").matchAll(PC)) out.push((m[1] + m[2]).toUpperCase());
  return out;
}

/**
 * The fabrication SHAPE, not proof of fabrication. `unresolvedVenue` produces the
 * identical shape from real client enquiries (handoff §3), which is why this is only
 * ever used to narrow an n8n family match and never on its own.
 */
export function addressShaped(name: unknown): boolean {
  const s = String(name ?? "");
  if (!s.includes(",")) return false;
  if (postcodes(s).length) return true;
  return s.split(",").some((seg) => /^\s*\d+[a-z]?\s+\S/i.test(seg));
}

const INFO_FIELDS = ["address", "city", "zip", "alias", "lat", "lng", "note", "region"] as const;

export const richness = (p: any) => INFO_FIELDS.filter((f) => p?.[f]).length;

/** No field locates or describes anything. An address echoing the name is not data. */
export function isBare(p: any): boolean {
  if (p?.city || p?.zip || p?.lat || p?.lng || p?.alias || p?.note || p?.region) return false;
  return !p?.address || norm(p.address) === norm(p.name);
}

// ---------------------------------------------------------------- provenance

export interface N8nVenue {
  raw: string;
  lead: string;
  execs: string[];
  dates: string[];
}

/** Pull "Venue: ..." / "Full Venue Address: ..." out of a generated email body. */
export function venuesFromBody(body: string): string[] {
  const re = /(?:Full\s+Venue\s+Address|Venue\s+Address|Venue)\s*:\s*(.+)/gi;
  const out: string[] = [];
  for (const m of String(body ?? "").matchAll(re)) {
    const v = m[1].replace(/^[*\s]+/, "").replace(/[*\s]+$/, "").trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * The 121 real UK postcode areas. A code that parses but names no real area was never
 * an address. Same check August's --enrich used; it held back the 134 TX12 rows alone.
 */
const AREAS = new Set(
  `AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY
E EC EH EN EX FK FY G GL GU GY HA HD HG HP HR HS HU HX IG IM IP IV JE KA KT KW KY L LA LD LE LL LN LS LU
M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW
SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO ZE`.split(/\s+/)
);

/** Postcodes used in documentation and examples the world over. A venue carrying one
 *  was written by a machine following an example, not by a person filling in a form. */
const DUMMY = new Set(["EC1A1AA", "EC1A1BB", "AB123CD", "SW1A1AA", "SW1A2AA"]);

/** What a language model writes when asked to invent a plausible street. */
const INVENTED =
  /\b(main street|river street|business road|conference street|innovation (drive|way|avenue)|network street|event way|heritage crescent|tech city)\b/i;

/**
 * Structural proof of fabrication, independent of the n8n log.
 *
 * It matters because n8n retention is nine days deep. The generator ran for months;
 * 39 executions survive. Every family it produced before 2026-08-27 is invisible to
 * the execution log and identical in shape to the ones that are not — so without this,
 * `The Grand Metro Hall, 25 Kingsway` ×149 collapses to one surviving fake venue
 * instead of none, which is the outcome the whole sweep exists to avoid.
 */
export function fabricationEvidence(name: unknown): string | null {
  const s = String(name ?? "");
  for (const code of postcodes(s)) {
    if (DUMMY.has(code)) return `${code} is a documentation-example postcode`;
    const area = code.replace(/[0-9].*$/, "");
    if (!AREAS.has(area)) return `${code}: "${area}" is not a real UK postcode area`;
  }
  const m = s.match(INVENTED);
  return m ? `"${m[0]}" is an invented street` : null;
}

export type ProvKind = "n8n-exact" | "n8n-family" | "fabricated-address";
export type ProvHit = { placeId: number; kind: ProvKind; venue: N8nVenue | null; why?: string };

/**
 * Which rows the generator's own output reaches.
 *
 * `lead` must carry two or more tokens and must not be GENERIC. Without that guard a
 * body saying "Venue: London" would claim every row in the tenant whose name starts
 * with London, which is most of it.
 */
export function provenanceHits(places: any[], venues: N8nVenue[]): ProvHit[] {
  const hits = new Map<number, ProvHit>();
  const rows = places.map((p) => ({ p, nn: norm(p.name), shaped: addressShaped(p.name) }));

  for (const v of venues) {
    const vn = norm(v.raw);
    const vl = v.lead;
    const usableLead = vl.split(" ").length >= 2 && !GENERIC.test(vl);

    for (const r of rows) {
      const id = Number(r.p.id);
      if (norm(r.p.name) === SENTINEL_NAME) continue;

      if (r.nn === vn) {
        hits.set(id, { placeId: id, kind: "n8n-exact", venue: v });
        continue;
      }
      if (!usableLead || hits.has(id)) continue;
      if ((r.nn === vl || r.nn.startsWith(vl + " ")) && r.shaped) {
        hits.set(id, { placeId: id, kind: "n8n-family", venue: v });
      }
    }
  }

  // The structural test runs on every row the n8n log did not already claim. A row
  // whose own name carries an impossible postcode needs no execution to convict it.
  for (const r of rows) {
    const id = Number(r.p.id);
    if (hits.has(id) || norm(r.p.name) === SENTINEL_NAME) continue;
    const why = fabricationEvidence(r.p.name);
    if (why) hits.set(id, { placeId: id, kind: "fabricated-address", venue: null, why });
  }
  return [...hits.values()];
}

// ---------------------------------------------------------------- collapse

export type Action = "keep" | "delete" | "deactivate" | "hold";
export type Stratum = "proven" | "shell" | "absorb" | "merge" | "hold";

export interface Member {
  id: number;
  action: Action;
  reason: string;
  prov?: ProvKind;
  outlier?: boolean;
}

export interface Decision {
  key: string;
  stratum: Stratum;
  survivor: number | null;
  members: Member[];
  /** every non-survivor is field-identical, so one audit discharges all of them */
  homogeneous: boolean;
  /** the elected survivor locates nothing — the highest-risk card in the sweep */
  survivorBare: boolean;
  evidence: string[];
}

const zipKey = (p: any) => String(p?.zip ?? "").replace(/\s+/g, "").toUpperCase();
const cityKey = (p: any) => norm(p?.city);

/** Modal value with at least two supporters, else null: a consensus of one is not one. */
function consensus(vals: string[]): string | null {
  const c = new Map<string, number>();
  for (const v of vals) if (v) c.set(v, (c.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, k] of c) if (k > n) { n = k; best = v; }
  return n >= 2 ? best : null;
}

/**
 * Ben, 2026-09-19: "if there's 30 duplicates of a venue and only one has more
 * information, but it also has different information than the other ones, you will
 * not select that one."
 *
 * Richer is not the same as right. A member that contradicts a consensus its peers
 * agree on is excluded from the election AND held — a contradiction is a question,
 * and answering it by deleting one side is how a real address gets destroyed.
 */
export function outliers(members: any[]): Set<number> {
  const out = new Set<number>();
  const zc = consensus(members.map(zipKey));
  const cc = consensus(members.map(cityKey));
  for (const m of members) {
    const z = zipKey(m);
    const c = cityKey(m);
    if (zc && z && z !== zc) out.add(Number(m.id));
    else if (cc && c && c !== cc) out.add(Number(m.id));
  }
  return out;
}

export function elect(members: any[], excluded: Set<number>): number {
  const pool = members.filter((m) => !excluded.has(Number(m.id)));
  const from = pool.length ? pool : members;
  return Number(
    [...from].sort(
      (a, b) => richness(b) - richness(a) || Number(a.id) - Number(b.id)
    )[0].id
  );
}

function fieldsEqual(a: any, b: any): boolean {
  if (norm(a?.name) !== norm(b?.name)) return false;
  return INFO_FIELDS.every((f) => String(a?.[f] ?? "") === String(b?.[f] ?? ""));
}

export interface PlanInput {
  places: any[];
  hits: ProvHit[];
  /** place ids carrying an engine-created order or ticket — a KEEP guard, not a gate */
  referenced: Set<number>;
}

/**
 * The whole ruling, in one pass.
 *
 * The key is `lead(name)` — an equality on a derived string, so groups CANNOT chain.
 * August's transitive similarity join put the Royal Albert Hall, the British Museum
 * and 3,406 others into one cluster and would have destroyed all of them; that class
 * of failure is structurally unavailable here.
 */
export function plan({ places, hits, referenced }: PlanInput): Decision[] {
  const provById = new Map(hits.map((h) => [h.placeId, h]));
  const decisions: Decision[] = [];

  const groups = new Map<string, any[]>();
  for (const p of places) {
    if (norm(p.name) === SENTINEL_NAME) continue; // 6922 is exempt from every stage
    const k = lead(p.name);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }

  for (const [key, all] of groups) {
    // Partition by postcode. Unlocatable rows fold into a single locatable partition;
    // two locatable partitions is a question no field in the snapshot answers.
    const parts = new Map<string, any[]>();
    const loose: any[] = [];
    for (const p of all) {
      const z = zipKey(p);
      if (!z) { loose.push(p); continue; }
      const cur = parts.get(z);
      if (cur) cur.push(p);
      else parts.set(z, [p]);
    }

    const emit = (members: any[], forceHold: boolean) => {
      if (!members.length) return;
      // A lone row is only a decision if it is fabricated or a bare placeholder word.
      // Every other single row is simply a venue, and this sweep has nothing to say
      // about it — most of the tenant is unreferenced and most of it is fine.
      const lone =
        members.length < 2 &&
        !provById.has(Number(members[0]?.id)) &&
        !(GENERIC.test(key) && isBare(members[0]));
      if (lone) return;
      decisions.push(build(key, members, forceHold, provById, referenced));
    };

    if (parts.size <= 1) {
      emit([...(parts.values().next().value ?? []), ...loose], false);
    } else {
      // Same name, several postcodes. Each postcode collapses internally; the loose
      // rows cannot be assigned to one of them, so they stay their own held group.
      for (const members of parts.values()) emit(members, false);
      if (loose.length) emit(loose, true);
      if (parts.size > 1) {
        decisions.push({
          key,
          stratum: "hold",
          survivor: null,
          members: [...parts.values()].map((g) => ({
            id: Number(g[0].id),
            action: "hold" as Action,
            reason: `same name, postcode ${zipKey(g[0])} — no field settles which building this is`,
          })),
          homogeneous: false,
          survivorBare: false,
          evidence: [`${parts.size} distinct postcodes share the name "${key}"`],
        });
      }
    }
  }
  return decisions;
}

function build(
  key: string,
  members: any[],
  forceHold: boolean,
  provById: Map<number, ProvHit>,
  referenced: Set<number>
): Decision {
  const bare = members.every(isBare);
  const provs = members.map((m) => provById.get(Number(m.id))).filter(Boolean) as ProvHit[];
  const out = outliers(members);

  /**
   * A group in which EVERY row is bare and EVERY row is the generator's own output
   * has no real venue in it to elect. Ben, 2026-09-19: "if the N8N derivation is an
   * exact match but it has a duplicate with no information other than the name, you'll
   * delete both of them."
   *
   * The guard that makes this safe is `bare`. One member carrying so much as a postcode
   * takes the group out of this branch and into an ordinary election, so a fabricated
   * name that somebody later filled in is a venue record now and survives as one.
   */
  const allFabricated = bare && provs.length === members.length && members.length > 0;

  /**
   * Generic AND bare is the 391-row class the 09-18 handoff settled: 210 rows named
   * "Placeholder", 171 named "Unknown", every one bare and every one a live match
   * target for any vague wording. Electing a survivor here keeps one of them alive as
   * a magnet. Nothing real can be standing on "Placeholder" in a way that matters —
   * and if something is, that job has no venue recorded anyway.
   *
   * The sentinel is NOT reachable from here: `plan` drops it before grouping.
   */
  const genericName = GENERIC.test(key) && bare;
  const survivor = forceHold || allFabricated || genericName ? null : elect(members, out);

  const ev = new Set<string>();
  for (const p of provs) {
    if (p.kind === "fabricated-address") ev.add(`the name's own address is impossible: ${p.why}`);
    else
      ev.add(
        `the stress-test generator emitted "${p.venue!.raw}" ` +
          `(n8n ${p.kind}, execution ${p.venue!.execs[0]}, ${p.venue!.dates[0]?.slice(0, 10)})`
      );
  }
  if (bare) ev.add(`all ${members.length} rows are bare: no address, city, postcode or coordinate`);
  if (genericName) ev.add(`"${key}" names no building — it is a placeholder word, not a venue`);
  const evidence: string[] = [...ev];

  /**
   * The stratum follows the OUTCOME, not the inputs. An earlier cut labelled a group
   * "proven" whenever any member was fabricated, including groups that still elected
   * a survivor — so a card reading "proven fabricated" sat next to a row being kept,
   * which is the one thing a reviewer must never be shown.
   *
   * `proven` now means exactly one thing: nobody survives.
   */
  let stratum: Stratum;
  if (survivor === null && (allFabricated || genericName)) stratum = "proven";
  else if (forceHold || out.size || survivor === null) stratum = "hold";
  else if (bare) stratum = "shell";
  else if (members.filter((m) => richness(m) > 0).length >= 2) stratum = "merge";
  else stratum = "absorb";

  const list: Member[] = members.map((m) => {
    const id = Number(m.id);
    const prov = provById.get(id)?.kind;
    if (allFabricated || genericName)
      return {
        id,
        action: referenced.has(id) ? "deactivate" : "delete",
        reason: referenced.has(id)
          ? "no building has this name, but an engine order stands on the row — deactivated"
          : genericName
            ? "a placeholder word, bare and unreferenced: it names no building"
            : "fabricated, bare and unreferenced: no building has this name",
        prov,
      };
    if (survivor === null)
      return { id, action: "hold", reason: "held: nothing in the snapshot settles this group", prov };
    if (id === survivor)
      return {
        id,
        action: "keep",
        reason: richness(m) > 0
          ? `richest row in the group (${richness(m)} fields populated)`
          : `oldest row in the group — the one the most orders already stand on`,
        prov,
      };
    if (out.has(id))
      return {
        id,
        action: "hold",
        reason: "contradicts the group's postcode or city — richer, but not the same place",
        prov,
        outlier: true,
      };
    if (referenced.has(id))
      return {
        id,
        action: "deactivate",
        reason: "an engine order or ticket stands on this row — deactivated, never deleted",
        prov,
      };
    if (isBare(m))
      return {
        id,
        action: "delete",
        reason: prov
          ? "bare, unreferenced, and the generator's own output"
          : "bare, unreferenced duplicate — carries nothing the survivor does not",
        prov,
      };
    return {
      id,
      action: "deactivate",
      reason: "carries data the survivor may not — deactivated so nothing is lost",
      prov,
    };
  });

  const losers = members.filter((m) => Number(m.id) !== survivor);
  const homogeneous =
    losers.length > 0 && losers.every((m) => fieldsEqual(m, losers[0]));

  /**
   * The riskiest shape in the whole sweep: a survivor that locates nothing.
   *
   * "National Gallery" ×72, all bare, is a real venue with an empty address and
   * collapsing it is right. "The Grand Metro Hall, 25 Kingsway, London WC2B 6UN"
   * ×149, all bare, is the same shape and is almost certainly the generator — real
   * street, real postcode area, so the structural test cannot convict it (handoff §3
   * calls this one out by name as Ben's call). Nothing in the snapshot separates the
   * two, so both are flagged and sampled first rather than guessed at.
   */
  const survivorBare = survivor !== null && isBare(members.find((m) => Number(m.id) === survivor));
  if (survivorBare)
    evidence.push(
      `the survivor carries no address, postcode or coordinate — if this family is ` +
        `fabricated, keeping one row keeps one fake venue`
    );

  return { key, stratum, survivor, members: list, homogeneous, survivorBare, evidence };
}

// ---------------------------------------------------------------- the bound

/** Cumulative log-factorial. Row counts reach 5,655 and 5655! is not a double. */
const LN_FACT: number[] = [0, 0];
function lnFact(n: number): number {
  for (let i = LN_FACT.length; i <= n; i++) LN_FACT[i] = LN_FACT[i - 1] + Math.log(i);
  return LN_FACT[n];
}
const lnC = (n: number, k: number) =>
  k < 0 || k > n || n < 0 ? -Infinity : lnFact(n) - lnFact(k) - lnFact(n - k);

/** P(X <= k) for X ~ Hypergeometric(N population, D defects, n drawn). */
export function hyperCdf(N: number, D: number, n: number, k: number): number {
  let s = 0;
  for (let i = 0; i <= Math.min(k, D, n); i++) {
    const lp = lnC(D, i) + lnC(N - D, n - i) - lnC(N, n);
    if (Number.isFinite(lp)) s += Math.exp(lp);
  }
  return Math.min(1, s);
}

/**
 * The largest defect count consistent with `k` defects found in `n` audits of `N` rows,
 * at 95%. With k=0 this is the exact finite-population form of the rule of three, and
 * it is the number the review meter counts down.
 *
 * P(X <= k) is monotonically DECREASING in D, so the set of D satisfying the test is a
 * prefix and a plain bisection on that boundary is exact.
 */
export function upperBound(N: number, n: number, k: number): number {
  if (N <= 0) return 0;
  if (n <= 0) return N;
  if (n >= N) return k;
  let lo = k; // k defects were seen, so at least k exist
  let hi = N;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (hyperCdf(N, mid, n, k) > 0.05) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------------------------------------------------------------- phases

async function provenance() {
  loadEnv();
  fs.mkdirSync(OUT, { recursive: true });
  const BASE = requireEnv("N8N_BASE");
  const h = { "X-N8N-API-KEY": requireEnv("N8N_API_KEY") };

  let cursor: string | null = null;
  const ids: any[] = [];
  do {
    const u = new URL(`${BASE}/executions`);
    u.searchParams.set("workflowId", STRESS_WF);
    u.searchParams.set("limit", "250");
    if (cursor) u.searchParams.set("cursor", cursor);
    const b: any = await (await fetch(u, { headers: h })).json();
    if (!Array.isArray(b.data)) break;
    ids.push(...b.data);
    cursor = b.nextCursor ?? null;
  } while (cursor);

  const byRaw = new Map<string, N8nVenue>();
  let emails = 0;
  for (const e of ids) {
    const d: any = await (await fetch(`${BASE}/executions/${e.id}?includeData=true`, { headers: h })).json();
    for (const runs of Object.values(d?.data?.resultData?.runData ?? {}) as any[]) {
      for (const r of runs ?? []) {
        for (const item of r?.data?.main?.[0] ?? []) {
          const c = item?.json?.message?.content ?? item?.json?.choices?.[0]?.message?.content;
          if (!c || typeof c !== "object" || !c.body) continue;
          emails++;
          for (const raw of venuesFromBody(c.body)) {
            const v = byRaw.get(raw) ?? { raw, lead: lead(raw), execs: [], dates: [] };
            v.execs.push(String(e.id));
            v.dates.push(String(e.startedAt ?? ""));
            byRaw.set(raw, v);
          }
        }
      }
    }
  }

  const venues = [...byRaw.values()];
  fs.writeFileSync(path.join(OUT, "provenance.json"), JSON.stringify(venues, null, 1));
  console.log(`phase A PROVENANCE: ${ids.length} executions, ${emails} generated emails`);
  console.log(`  ${venues.length} distinct venue strings -> ${OUT}/provenance.json`);
  if (!venues.length) {
    console.log("  FATAL: zero venue strings. A provenance file that proves nothing would");
    console.log("  read as 'no row is fabricated'. Refusing to leave that on disk as truth.");
    process.exit(1);
  }
}

async function snapshot() {
  loadEnv();
  fs.mkdirSync(OUT, { recursive: true });
  const client = new OnsinchClient(
    httpTransport({ baseUrl: onsinchBase(), apiKey: requireEnv("ONSINCH_API_KEY") })
  );
  const places = await client.allPlaces();
  fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify(places, null, 1));
  console.log(`phase B SNAPSHOT: ${places.length} places -> ${OUT}/snapshot.json`);

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(requireEnv("DATABASE_URL"));
  const a: any[] = await sql`SELECT DISTINCT place_id FROM order_records WHERE place_id IS NOT NULL`;
  const b: any[] = await sql`SELECT DISTINCT place_id FROM tickets WHERE place_id IS NOT NULL`;
  const refs = [...new Set([...a, ...b].map((r) => Number(r.place_id)).filter(Boolean))];
  if (!refs.length) {
    console.log("  FATAL: the usage map came back empty. An empty keep-guard reads as");
    console.log("  'nothing is in use' and would licence deleting rows that are. Refusing.");
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUT, "referenced.json"), JSON.stringify(refs, null, 1));
  console.log(`  usage map: ${refs.length} place ids carry an engine order or ticket`);
}

function planPhase() {
  const places = JSON.parse(fs.readFileSync(path.join(OUT, "snapshot.json"), "utf8"));
  const venues: N8nVenue[] = JSON.parse(fs.readFileSync(path.join(OUT, "provenance.json"), "utf8"));
  const referenced = new Set<number>(
    JSON.parse(fs.readFileSync(path.join(OUT, "referenced.json"), "utf8")).map(Number)
  );

  const hits = provenanceHits(places, venues);
  const decisions = plan({ places, hits, referenced });

  const byId = new Map<number, any>(places.map((p: any) => [Number(p.id), p]));
  const acts: Record<string, number> = {};
  const strata: Record<string, number> = {};
  for (const d of decisions) {
    strata[d.stratum] = (strata[d.stratum] ?? 0) + 1;
    for (const m of d.members) acts[m.action] = (acts[m.action] ?? 0) + 1;
  }

  const sentinels = places.filter((p: any) => norm(p.name) === SENTINEL_NAME);
  if (sentinels.length !== 1) {
    console.log(`  FATAL: expected exactly 1 sentinel, found ${sentinels.length}`);
    process.exit(1);
  }
  const touched = new Set(decisions.flatMap((d) => d.members.map((m) => m.id)));
  if (touched.has(Number(sentinels[0].id))) {
    console.log(`  FATAL: sentinel ${sentinels[0].id} appears in a decision. It is exempt.`);
    process.exit(1);
  }

  fs.writeFileSync(
    path.join(OUT, "decisions.json"),
    JSON.stringify({ built: new Date().toISOString(), decisions, places: [...byId.values()] })
  );

  console.log(`phase C PLAN: ${places.length} places, ${venues.length} n8n venue strings`);
  console.log(`  provenance hits:  ${hits.length} rows (${hits.filter((h) => h.kind === "n8n-exact").length} exact, ${hits.filter((h) => h.kind === "n8n-family").length} family)`);
  console.log(`  decisions:        ${decisions.length} groups covering ${touched.size} rows`);
  console.log(`  by stratum:       ${JSON.stringify(strata)}`);
  console.log(`  by action:        ${JSON.stringify(acts)}`);
  console.log(`  homogeneous:      ${decisions.filter((d) => d.homogeneous).length} groups — one audit discharges each`);
  console.log(`  sentinel ${sentinels[0].id} untouched`);
}

const argv = process.argv;
if (argv.includes("--provenance")) provenance();
else if (argv.includes("--snapshot")) snapshot();
else if (argv.includes("--plan")) planPhase();
else if (argv[1]?.includes("venue-sweep2"))
  console.log("pick a phase: --provenance | --snapshot | --plan");
