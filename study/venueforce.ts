// ============================================================================
// "We don't need an exact match — what if it just takes the best available?"
// ----------------------------------------------------------------------------
// Ben, 2026-09-03. Answered on the same 106 labelled wordings study/venuecompare.ts
// uses, so the two numbers are comparable.
//
// THE SHIPPING RESOLVER ALREADY DOES THIS on most wordings — with no adjudicator
// attached it falls through to "took the best search result". What it does NOT do is
// take the best result when the search returned nothing it liked, or when the city-only
// guard fired. This measures removing that last reservation: always take hits[0], never
// create, never hold at the placeholder.
//
//   npx tsx study/venueforce.ts    FREE, offline, no model
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlaces } from "./rig";
import { NO_POSTCODE_GOLD, type VenueLabel } from "./venuegold";
import { postcodesIn } from "./venuecandidate";
import { buildIndex, searchVenues } from "../app/lib/engine/venueSearch";

const ROOT = join(import.meta.dirname, "..");
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const cover = (a: string[], b: string[]) => (!a.length ? 1 : a.filter((w) => b.includes(w)).length / a.length);

(async () => {
  const places = loadPlaces() as any[];
  const byId = new Map(places.map((p) => [p.id, p]));
  const wordings: Array<{ text: string; n: number }> =
    JSON.parse(readFileSync(join(ROOT, ".tmp-data", "study", "venue-wordings.json"), "utf8"));
  const { resolveVenueV3 } = await import("../app/lib/engine/compiler") as any;
  const index = buildIndex(places);

  const byPostcode = new Map<string, any[]>();
  for (const p of places) for (const pc of postcodesIn(p.zip)) {
    if (!byPostcode.has(pc)) byPostcode.set(pc, []);
    byPostcode.get(pc)!.push(p);
  }
  function truthOf(text: string): VenueLabel | null {
    const hand = NO_POSTCODE_GOLD[text] ?? NO_POSTCODE_GOLD[text.trim()];
    if (hand) return hand.label;
    const pcs = postcodesIn(text);
    if (!pcs.length) return null;
    const uniq = [...new Map(pcs.flatMap((pc) => byPostcode.get(pc) ?? []).map((p) => [p.id, p])).values()];
    if (uniq.length === 1) return uniq[0].id;
    if (!uniq.length) return null;
    const scored = uniq.map((p) => ({ p, s: cover(norm(`${p.name} ${p.alias ?? ""}`).split(" "), norm(text).split(" ")) }))
                       .sort((a, b) => b.s - a.s);
    if (scored[0].s >= 0.5 && (scored.length === 1 || scored[0].s > scored[1].s)) return scored[0].p.id;
    return null;
  }
  const rowOf = (id?: number) => {
    if (id === undefined) return "(create)";
    const p = byId.get(id);
    if (!p) return `#${id}`;
    const ctx = [p.address, p.city, p.zip].filter(Boolean).join(", ");
    return `#${id} "${String(p.name).slice(0, 26)}"${ctx ? " - " + ctx.slice(0, 34) : " [NO ADDR]"}`;
  };

  interface Row { text: string; n: number; truth: VenueLabel; cur?: number; curCreate: boolean; forced?: number }
  const rows: Row[] = [];
  for (const w of wordings) {
    const truth = truthOf(w.text);
    if (truth === null || truth === "AMBIGUOUS") continue;
    let cur: number | undefined, curCreate = false;
    try {
      const r = await resolveVenueV3(w.text, places, null, undefined);
      cur = r?.id;
      const nm = r?.provision?.name ?? (cur !== undefined ? byId.get(cur)?.name : undefined);
      if (String(nm ?? "").trim().toLowerCase() === "no location" || cur === undefined) { curCreate = true; cur = undefined; }
    } catch { curCreate = true; }
    // FORCED: whatever the resolver did, if the search has any hit at all, take the top one.
    const { hits } = searchVenues(w.text, index, 8);
    const forced = curCreate ? hits[0]?.building.place_id : cur;
    rows.push({ text: w.text, n: w.n, truth, cur, curCreate, forced });
  }

  const okCur = (r: Row) => (r.truth === "CREATE" ? r.curCreate : !r.curCreate && r.cur === r.truth);
  const okForced = (r: Row) => (r.truth === "CREATE" ? r.forced === undefined : r.forced === r.truth);
  const wrongCur = (r: Row) => !r.curCreate && r.cur !== undefined && r.cur !== r.truth;
  const wrongForced = (r: Row) => r.forced !== undefined && r.forced !== r.truth;

  const n = rows.length;
  const pc = (k: number) => `${String(k).padStart(3)}/${n}  ${((k / n) * 100).toFixed(1)}%`;
  console.log(`\n${"=".repeat(88)}\n  ALWAYS TAKE THE BEST AVAILABLE MATCH - never decline, never create\n${"=".repeat(88)}\n`);
  console.log(`  labelled wordings                ${n}   (${rows.reduce((a, r) => a + r.n, 0)} mentions)\n`);
  console.log(`${"-".repeat(88)}\n                                    shipping          forced-best\n${"-".repeat(88)}`);
  console.log(`  right answer                    ${pc(rows.filter(okCur).length)}       ${pc(rows.filter(okForced).length)}`);
  console.log(`  WRONG BUILDING                  ${pc(rows.filter(wrongCur).length)}       ${pc(rows.filter(wrongForced).length)}`);
  console.log(`  created a duplicate             ${pc(rows.filter((r) => r.curCreate && r.truth !== "CREATE").length)}       ${pc(rows.filter((r) => r.forced === undefined && r.truth !== "CREATE").length)}`);

  console.log(`\n${"-".repeat(88)}\n  EVERY WRONG BUILDING under forced-best\n${"-".repeat(88)}`);
  for (const r of rows.filter(wrongForced)) {
    console.log(`  "${r.text.trim().slice(0, 46)}"  (${r.n}x)`);
    console.log(`      picked: ${rowOf(r.forced)}`);
    console.log(`      truth:  ${r.truth === "CREATE" ? "CREATE A NEW ONE" : rowOf(r.truth as number)}`);
  }
  console.log(`\n${"-".repeat(88)}\n  CHANGED by forcing (shipping would have created)\n${"-".repeat(88)}`);
  for (const r of rows.filter((x) => x.curCreate)) {
    console.log(`  "${r.text.trim().slice(0, 46)}"  (${r.n}x)  ${okForced(r) ? "OK  " : "BAD "} -> ${rowOf(r.forced)}`);
    console.log(`      truth: ${r.truth === "CREATE" ? "CREATE A NEW ONE" : rowOf(r.truth as number)}`);
  }
  console.log();
})();
