// ============================================================================
// The venue-deduplication PROTOCOL, executed. This one writes to the tenant.
// ----------------------------------------------------------------------------
//   npx tsx scripts/place-dedupe-run.ts --snapshot     phase 1, read-only
//   npx tsx scripts/place-dedupe-run.ts --enrich       phase 2, PATCH zip
//   npx tsx scripts/place-dedupe-run.ts --plan         phases 3-4, read-only
//   npx tsx scripts/place-dedupe-run.ts --repoint      phase 5, Neon only
//   npx tsx scripts/place-dedupe-run.ts --deactivate   phase 6, reversible
//   npx tsx scripts/place-dedupe-run.ts --delete       phase 7, PERMANENT
//   npx tsx scripts/place-dedupe-run.ts --reactivate   undo phase 6
//
// Every phase is gated on the snapshot existing, batches at 50 with a read-back,
// and writes what it did to .tmp-data/place-dedupe/ before doing it. The order is
// the safety property: enrich before grouping, because a postcode makes "the same
// building" provable rather than inferred; deactivate before deleting, because the
// tenant cannot be asked which venues its historical orders point at.
//
// WHY NOT --all. There is no flag that runs the whole thing. Phase 6 is meant to be
// followed by a wait, and a script that can do everything in one command is a script
// somebody runs in one command.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "./_env.mjs";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { buildIndex, searchVenues, type Building } from "../app/lib/engine/venueSearch";
import { matchedOnCityAlone, isAShell, postcodesIn } from "../app/lib/engine/venueMatch";
import { matchPlace } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";

loadEnv();
const OUT = path.join(".tmp-data", "place-dedupe");
fs.mkdirSync(OUT, { recursive: true });
const SNAPSHOT = path.join(OUT, "snapshot.json");
const PLAN = path.join(OUT, "plan.json");
const DONE = path.join(OUT, "actions.jsonl");

const BASE = onsinchBase();
const KEY = requireEnv("ONSINCH_API_KEY");
const client = new OnsinchClient(httpTransport({ baseUrl: BASE, apiKey: KEY }));

const BATCH = 50;
const arg = (n: string) => process.argv.includes(`--${n}`);
const log = (s: string) => console.log(s);
const record = (row: unknown) => fs.appendFileSync(DONE, JSON.stringify(row) + "\n");

/** Every write is recorded BEFORE it is sent, so a crash leaves a trail. */
async function api(method: string, pathname: string, body?: unknown) {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { Authorization: `apikey ${KEY}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The 121 real UK postcode areas. "TX12 4RT" passes the format and is not one. */
const AREAS = new Set(`AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY
E EC EH EN EX FK FY G GL GU GY HA HD HG HP HR HS HU HX IG IM IP IV JE KA KT KW KY L LA LD LE LL LN LS LU
M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW
SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO ZE`.split(/\s+/));
const realArea = (pc: string) => AREAS.has(pc.split(" ")[0].replace(/[0-9].*$/, ""));

/** Engine sentinels, found BY NAME. Never touched, in any phase. */
const SENTINEL = /^(no location|placeholder|unknown|tbc|n\/a|none|test)\b/i;
/** Words naming a part of a venue. Never collapsed into the building. */
const SUBVENUE = /\b(hall|unit|suite|floor|level|gate|door|stand|bay|wing|block|entrance|annexe|annex|pavilion|marquee|loading|stage|s\d|n\d)\b/i;

const readSnapshot = (): PlaceCandidate[] => {
  if (!fs.existsSync(SNAPSHOT)) throw new Error("no snapshot — run --snapshot first");
  return JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
};

// ---------------------------------------------------------------- phase 1
async function snapshot() {
  const places = (await client.allPlaces()) as PlaceCandidate[];
  fs.writeFileSync(SNAPSHOT, JSON.stringify(places, null, 1));
  const back = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  log(`phase 1 SNAPSHOT: ${places.length} places -> ${SNAPSHOT}`);
  log(`  read back: ${back.length} ${back.length === places.length ? "OK" : "MISMATCH — STOP"}`);
  if (back.length !== places.length) process.exit(1);
  log(`  shells ${places.filter(isAShell).length}, with a zip field ${places.filter((p) => p.zip).length}`);
}

// ---------------------------------------------------------------- phase 2
/**
 * Backfill the zip field from the postcode already sitting in the name or address.
 * A PATCH, so it is reversible from the snapshot, and it adds information rather
 * than changing any. Refuses to overwrite a populated field, and refuses a code
 * whose area is not real — which holds back the 134 "TX12" rows on its own.
 */
async function enrich(commit: boolean) {
  const places = readSnapshot();
  const todo: Array<{ id: number; zip: string; from: string }> = [];
  const refused: Array<{ id: number; zip: string; why: string }> = [];
  for (const p of places) {
    if (p.zip) continue;
    const pc = postcodesIn(`${p.name ?? ""} ${p.address ?? ""} ${p.city ?? ""}`)[0];
    if (!pc) continue;
    if (!realArea(pc)) { refused.push({ id: Number(p.id), zip: pc, why: "not a real UK postcode area" }); continue; }
    todo.push({ id: Number(p.id), zip: pc, from: String(p.name ?? "").slice(0, 60) });
  }
  log(`phase 2 ENRICH: ${todo.length} rows would gain a postcode, ${refused.length} refused`);
  log(`  distinct postcodes: ${new Set(todo.map((t) => t.zip)).size}`);
  fs.writeFileSync(path.join(OUT, "enrich.json"), JSON.stringify({ todo, refused }, null, 1));
  if (!commit) { log(`  dry run — pass --commit to write`); return; }

  let ok = 0, failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    for (const t of slice) {
      record({ phase: "enrich", id: t.id, zip: t.zip });
      const r = await api("PATCH", "/places", [{ id: t.id, zip: t.zip }]);
      if (r.status === 200 || r.status === 204) ok++;
      else { failed++; log(`  ${t.id} PATCH -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`); if (failed > 5) { log("  too many failures — STOP"); process.exit(1); } }
    }
    log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}  ok=${ok} failed=${failed}`);
  }
}

// ---------------------------------------------------------------- phases 3-4
/**
 * Group, elect, and prove. Read-only: it writes a plan and nothing else.
 *
 * The proof is the same one the survey uses and it is done TWICE, because removing
 * one row and removing the whole batch are different questions: 800 rows resolving
 * to id 49 individually says nothing about 800 resolving to id 49 with 799 gone.
 */
function resolveWith(text: string, list: PlaceCandidate[]) {
  const raw = matchPlace(text, list);
  const row = raw ? list.find((p) => Number(p.id) === Number(raw)) : undefined;
  if (raw && !isAShell(row!) && !matchedOnCityAlone(text, row!)) return raw;
  const index = buildIndex(list);
  const hit = searchVenues(text, index, 1).hits[0];
  return hit ? hit.building.place_id : null;
}

function plan() {
  const places = readSnapshot();
  const index = buildIndex(places);
  const byId = new Map(places.map((p) => [Number(p.id), p]));
  const locatable = (p?: PlaceCandidate) => !!(p && (p.zip || ((p as { lat?: unknown }).lat)));

  const deletions: Array<{ id: number; name: string; keep: number; keepName: string }> = [];
  const held: Record<string, Array<{ id: number; name: string; why: string }>> = {};
  const hold = (k: string, p: PlaceCandidate, why: string) =>
    (held[k] ??= []).push({ id: Number(p.id), name: String(p.name ?? "").trim(), why });

  for (const b of index) {
    if (b.members.length === 1) continue;
    const head = byId.get(b.place_id)!;
    for (const id of b.members) {
      if (id === b.place_id) continue;
      const p = byId.get(id)!;
      const name = String(p.name ?? "").trim();
      if (SENTINEL.test(name)) { hold("engine_sentinel", p, "looked up by name; deleting it makes the next enquiry create another"); continue; }
      if (p.active === false) { hold("deliberately_retired", p, "a retired venue is a fact, not a duplicate"); continue; }
      if (locatable(p)) { hold("locatable", p, "carries a postcode or coordinates — merging two real records is a judgement about the world"); continue; }
      if (SUBVENUE.test(name) && !SUBVENUE.test(String(head.name ?? ""))) { hold("names_a_part_of_the_venue", p, "the only record of where inside the building"); continue; }
      if (norm(p.alias) && norm(p.alias) !== norm(head.alias)) { hold("alias_would_be_lost", p, `alias ${JSON.stringify(p.alias)} is not on the survivor`); continue; }
      if (b.unlocatable) { hold("survivor_cannot_locate_a_job", p, "the whole building has no postcode — collapsing moves the problem rather than fixing it"); continue; }
      deletions.push({ id, name, keep: b.place_id, keepName: b.name });
    }
  }

  // Proof: with the WHOLE batch gone, does each row's own name still reach its survivor?
  const doomed = new Set(deletions.map((d) => d.id));
  const survivors = places.filter((p) => !doomed.has(Number(p.id)));
  const kept: typeof deletions = [];
  for (const d of deletions) {
    const got = resolveWith(d.name, survivors);
    if (Number(got) === Number(d.keep)) kept.push(d);
    else hold("batch_changes_the_answer", byId.get(d.id)!, `expected ${d.keep}, got ${got ?? "nothing"} once the batch was removed`);
  }

  fs.writeFileSync(PLAN, JSON.stringify({ deletions: kept, held }, null, 1));
  log(`phase 3-4 PLAN: ${kept.length} deletions proven, ${deletions.length - kept.length} dropped by the batch proof`);
  log(`  survivors absorbing them: ${new Set(kept.map((d) => d.keep)).size}`);
  for (const [k, v] of Object.entries(held).sort((a, b) => b[1].length - a[1].length)) log(`  held ${String(v.length).padStart(5)}  ${k}`);
  log(`  -> ${PLAN}`);
}

// ---------------------------------------------------------------- phase 5
/**
 * Repoint the engine's own memory. Place ids live in two places OnSinch knows
 * nothing about, and nothing fails until an order is written.
 */
async function repoint(commit: boolean) {
  const { deletions } = JSON.parse(fs.readFileSync(PLAN, "utf8")) as { deletions: Array<{ id: number; keep: number }> };
  const target = new Map(deletions.map((d) => [Number(d.id), Number(d.keep)]));
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) { log("phase 5 REPOINT: no database configured — nothing to do"); return; }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);

  const aliasRows = (await sql`SELECT alias_norm, entity_id, source FROM entity_aliases WHERE kind = 'place'`) as unknown as Array<{ alias_norm: string; entity_id: number; source: string }>;
  const aliasHits = aliasRows.filter((r) => target.has(Number(r.entity_id)));
  log(`phase 5 REPOINT: ${aliasHits.length} alias row(s) point at a doomed record`);
  for (const h of aliasHits) log(`  ${h.entity_id} -> ${target.get(Number(h.entity_id))}  ${JSON.stringify(h.alias_norm).slice(0, 50)} (${h.source})`);

  const stateRows = (await sql`SELECT thread_id, state FROM conversation_state`) as unknown as Array<{ thread_id: string; state: unknown }>;
  const stateHits: string[] = [];
  for (const r of stateRows) {
    const s = (typeof r.state === "string" ? JSON.parse(r.state) : r.state) as { place_id?: number; desired_order?: { slot_teams?: Array<{ place_id?: number }> } };
    const ids = new Set<number>();
    if (s?.place_id) ids.add(Number(s.place_id));
    for (const t of s?.desired_order?.slot_teams ?? []) if (t?.place_id) ids.add(Number(t.place_id));
    if ([...ids].some((i) => target.has(i))) stateHits.push(r.thread_id);
  }
  log(`  ${stateHits.length} staged order(s) point at a doomed record: ${stateHits.join(", ") || "(none)"}`);
  if (!commit) { log(`  dry run — pass --commit to repoint`); return; }

  for (const h of aliasHits) {
    const to = target.get(Number(h.entity_id))!;
    record({ phase: "repoint-alias", alias: h.alias_norm, from: h.entity_id, to });
    await sql`UPDATE entity_aliases SET entity_id = ${to} WHERE kind = 'place' AND alias_norm = ${h.alias_norm}`;
  }
  log(`  ${aliasHits.length} alias row(s) repointed`);
  if (stateHits.length) log(`  staged orders are NOT rewritten — they are re-compiled on the next message, and editing stored JSON is a worse risk than letting them recompile`);
}

// ---------------------------------------------------------------- phases 6-7
async function setActive(ids: number[], active: boolean, phase: string) {
  let ok = 0, failed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    for (const id of slice) {
      record({ phase, id, active });
      const r = await api("PATCH", "/places", [{ id, active }]);
      if (r.status === 200 || r.status === 204) ok++;
      else { failed++; log(`  ${id} -> ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`); if (failed > 5) { log("  too many failures — STOP"); process.exit(1); } }
    }
    log(`  ${Math.min(i + BATCH, ids.length)}/${ids.length}  ok=${ok} failed=${failed}`);
  }
  return { ok, failed };
}

async function deactivate(commit: boolean) {
  const { deletions } = JSON.parse(fs.readFileSync(PLAN, "utf8")) as { deletions: Array<{ id: number }> };
  const ids = deletions.map((d) => Number(d.id));
  log(`phase 6 DEACTIVATE: ${ids.length} record(s), reversible with --reactivate`);
  if (!commit) { log(`  dry run — pass --commit`); return; }
  const r = await setActive(ids, false, "deactivate");
  log(`  deactivated ${r.ok}, failed ${r.failed}`);
}

async function reactivate() {
  const rows = fs.existsSync(DONE) ? fs.readFileSync(DONE, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const ids = [...new Set(rows.filter((r) => r.phase === "deactivate").map((r) => Number(r.id)))];
  log(`UNDO: reactivating ${ids.length} record(s) from the action log`);
  const r = await setActive(ids, true, "reactivate");
  log(`  reactivated ${r.ok}, failed ${r.failed}`);
}

async function del(commit: boolean) {
  const { deletions } = JSON.parse(fs.readFileSync(PLAN, "utf8")) as { deletions: Array<{ id: number; name: string }> };
  const ids = deletions.map((d) => Number(d.id));
  log(`phase 7 DELETE: ${ids.length} record(s). THIS IS PERMANENT.`);
  log(`  the snapshot at ${SNAPSHOT} is the only way back`);
  if (!commit) { log(`  dry run — pass --commit`); return; }
  let gone = 0, stuck = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const id of ids.slice(i, i + BATCH)) {
      record({ phase: "delete", id });
      try { await client.deletePlaces([id]); gone++; }
      catch (e) {
        const msg = (e as Error).message;
        // ALREADY GONE IS DONE, NOT REFUSED. A resumed run, or a probe batch that
        // ran first, leaves ids the tenant no longer has — and counting those as
        // refusals tripped the stop-after-5 guard on a run that was working
        // perfectly. The guard exists to catch OnSinch protecting a referenced row;
        // "not found" is the opposite of that.
        if (/not found/i.test(msg)) { gone++; continue; }
        stuck++; log(`  ${id} refused: ${msg.slice(0, 110)}`);
        if (stuck > 5) { log("  too many refusals — STOP"); process.exit(1); }
      }
    }
    log(`  ${Math.min(i + BATCH, ids.length)}/${ids.length}  gone=${gone} refused=${stuck}`);
  }
  log(`  deleted ${gone}, refused ${stuck}`);
}

// ---------------------------------------------------------------- run
(async () => {
  const commit = arg("commit");
  if (arg("snapshot")) return snapshot();
  if (arg("enrich")) return enrich(commit);
  if (arg("plan")) return plan();
  if (arg("repoint")) return repoint(commit);
  if (arg("deactivate")) return deactivate(commit);
  if (arg("reactivate")) return reactivate();
  if (arg("delete")) return del(commit);
  log("pick a phase: --snapshot --enrich --plan --repoint --deactivate --delete --reactivate  (add --commit to write)");
})();
