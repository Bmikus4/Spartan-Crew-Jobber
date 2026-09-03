// ============================================================================
// F1 — CAN DETERMINISTIC MATCHING DO BETTER? Measured before anything is changed.
// ----------------------------------------------------------------------------
//   npx tsx study/venuebench.ts            measure the current resolver — FREE
//   npx tsx study/venuebench.ts --detail   every wording, one line each
//
// Ben's condition on F1: only touch the venue path if it can be VERIFIED that a
// deterministic fix raises accuracy. So this measures first, on 131 real venue
// wordings harvested from the bookings mailbox — not on the 33 hand-written
// gold wordings, which were chosen by the person writing the fix.
//
// THE TRUTH SET IS BUILT FROM POSTCODES, NOT FROM OPINION. Half of what clients
// write carries a full UK postcode, and a postcode is the strongest key there
// is: it names a building, it is copied rather than remembered, and it cannot be
// paraphrased. Where a wording carries one and exactly one tenant row shares it,
// that row is the answer and nobody has to be asked. That subset is the ruler.
//
// The rest are reported but not scored, because a ruler you invent for the
// wordings you are about to fix is not a ruler.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlaces } from "./rig";

const DETAIL = process.argv.includes("--detail");
const ROOT = join(import.meta.dirname, "..");

interface Wording { text: string; n: number }

// ---------------------------------------------------------------- keys
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;
function postcodesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of String(s ?? "").matchAll(POSTCODE)) out.push((m[1] + m[2]).toUpperCase());
  return [...new Set(out)];
}
const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Levenshtein, capped — we only care whether two names are near, not how far. */
function lev(a: string, b: string, cap = 6): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How much of the shorter token set the two share. 1 = one contains the other. */
function tokenContainment(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

const hasContext = (p: any) => !!(p.address || p.city || p.zip);

(async () => {
  const places = loadPlaces() as any[];
  const wordings: Wording[] = JSON.parse(readFileSync(join(ROOT, ".tmp-data", "study", "venue-wordings.json"), "utf8"));
  const { resolveVenueV3 } = await import("../app/lib/engine/compiler") as any;

  const byId = new Map(places.map((p) => [p.id, p]));
  // A postcode index over the tenant, built once.
  const byPostcode = new Map<string, any[]>();
  for (const p of places) {
    for (const pc of postcodesIn(p.zip)) {
      if (!byPostcode.has(pc)) byPostcode.set(pc, []);
      byPostcode.get(pc)!.push(p);
    }
  }

  const rowOf = (id?: number) => {
    if (!id) return "(none)";
    const p = byId.get(id);
    if (!p) return `#${id}`;
    const ctx = [p.address, p.city, p.zip].filter(Boolean).join(", ");
    return `#${id} "${String(p.name).slice(0, 34)}"${ctx ? " — " + ctx.slice(0, 42) : " [NO ADDRESS]"}`;
  };

  // ------------------------------------------------ the truth set
  /**
   * A wording is SCORABLE when it carries a postcode and the tenant holds
   * exactly one row at that postcode. Then the answer is not a judgement.
   *
   * Where several rows share the postcode — a big venue entered four times, or
   * a genuine multi-tenant building — the one whose NAME the client's words
   * actually agree with is taken, and only when that is unambiguous. Everything
   * else is left unscored and reported separately.
   */
  interface Row { w: Wording; truth: number | null; truthWhy: string; got?: number; note: string; placeholder: boolean }
  const rows: Row[] = [];

  for (const w of wordings) {
    const pcs = postcodesIn(w.text);
    let truth: number | null = null, truthWhy = "";
    if (pcs.length) {
      const cands = pcs.flatMap((pc) => byPostcode.get(pc) ?? []);
      const uniq = [...new Map(cands.map((p) => [p.id, p])).values()];
      if (uniq.length === 1) { truth = uniq[0].id; truthWhy = "one tenant row at this postcode"; }
      else if (uniq.length > 1) {
        const scored = uniq
          .map((p) => ({ p, s: tokenContainment(w.text, `${p.name} ${p.alias ?? ""}`), ctx: hasContext(p) }))
          .sort((a, b) => b.s - a.s || Number(b.ctx) - Number(a.ctx));
        if (scored[0].s >= 0.5 && (scored.length === 1 || scored[0].s > scored[1].s))
          { truth = scored[0].p.id; truthWhy = `${uniq.length} rows share the postcode; name agreement picked one`; }
        else truthWhy = `${uniq.length} rows share the postcode and no name agreement separates them`;
      }
    }

    let got: number | undefined, note = "", placeholder = false;
    try {
      const r = await resolveVenueV3(w.text, places, null, undefined);
      got = r?.id;
      note = String(r?.note ?? "");
      const nm = r?.provision?.name ?? (got !== undefined ? byId.get(got)?.name : undefined);
      placeholder = String(nm ?? "").trim().toLowerCase() === "no location";
    } catch (e) { note = "THREW " + String((e as Error).message).slice(0, 70); }

    rows.push({ w, truth, truthWhy, got, note, placeholder });
  }

  // ------------------------------------------------ report
  const scorable = rows.filter((r) => r.truth !== null);
  const right = scorable.filter((r) => r.got === r.truth && !r.placeholder);
  const wrongRow = scorable.filter((r) => r.got !== undefined && r.got !== r.truth && !r.placeholder);
  const noAnswer = scorable.filter((r) => r.got === undefined || r.placeholder);

  const line = (n = 96) => "-".repeat(n);
  console.log(`\n${"=".repeat(96)}`);
  console.log("  F1 BENCHMARK — the current deterministic resolver on real client venue wordings");
  console.log("=".repeat(96));
  console.log(`\n  distinct wordings harvested from the mailbox   ${rows.length}   (${rows.reduce((s, r) => s + r.w.n, 0)} mentions)`);
  console.log(`  of those, carrying a full UK postcode          ${rows.filter((r) => postcodesIn(r.w.text).length).length}`);
  console.log(`  SCORABLE (postcode settles the answer)         ${scorable.length}`);

  console.log(`\n${line()}\n  CURRENT RESOLVER, on the scorable set\n${line()}`);
  const pct = (k: number) => `${((k / scorable.length) * 100).toFixed(1).padStart(5)}%`;
  console.log(`  right building              ${String(right.length).padStart(4)} / ${scorable.length}   ${pct(right.length)}`);
  console.log(`  WRONG building              ${String(wrongRow.length).padStart(4)} / ${scorable.length}   ${pct(wrongRow.length)}   <- crew go to the wrong address`);
  console.log(`  no answer / placeholder     ${String(noAnswer.length).padStart(4)} / ${scorable.length}   ${pct(noAnswer.length)}   <- would be CREATED under the new policy`);

  console.log(`\n${line()}\n  WRONG BUILDING — every one\n${line()}`);
  for (const r of wrongRow) {
    console.log(`\n  "${r.w.text.slice(0, 84)}"   (${r.w.n}x)`);
    console.log(`      truth: ${rowOf(r.truth!)}   [${r.truthWhy}]`);
    console.log(`      got:   ${rowOf(r.got)}`);
  }

  console.log(`\n${line()}\n  NO ANSWER — would a new row DUPLICATE something the tenant already has?\n${line()}`);
  let dupRisk = 0;
  for (const r of noAnswer) {
    const t = byId.get(r.truth!);
    console.log(`  "${r.w.text.slice(0, 74)}"`);
    console.log(`      the tenant already holds: ${rowOf(r.truth!)}`);
    dupRisk++;
  }
  console.log(`\n  ${dupRisk} of ${noAnswer.length} would create a DUPLICATE of a row the tenant already has.`);
  console.log(`  That is the cost of "create when unresolved", measured rather than assumed.`);

  // ------------------------------------------------ unscored
  const unscored = rows.filter((r) => r.truth === null);
  const unscoredNoAnswer = unscored.filter((r) => r.got === undefined || r.placeholder);
  console.log(`\n${line()}\n  NOT SCORABLE (no postcode, or the postcode does not settle it): ${unscored.length}\n${line()}`);
  console.log(`  of these the resolver gives no answer on ${unscoredNoAnswer.length}, and would create ${unscoredNoAnswer.length} new rows.`);
  if (DETAIL) for (const r of unscored) {
    console.log(`  ${(r.got === undefined || r.placeholder ? "CREATE" : "match ").padEnd(7)} "${r.w.text.slice(0, 58).padEnd(58)}" -> ${rowOf(r.got)}`);
  }
  console.log("");
})();
