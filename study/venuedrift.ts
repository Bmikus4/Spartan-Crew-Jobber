// ============================================================================
// F1 — WHAT DOES "CREATE WHEN UNRESOLVED" COST, ON REAL MAIL?  (FREE)
// ----------------------------------------------------------------------------
//   npx tsx study/venuedrift.ts
//
// Ben set the target as 1% drift. Drift here means rows added to a venue table
// that already carries 5,567 rows, 3,403 of them with no address at all. So the
// question this answers is not "does the matcher work" — study/venuecompare.ts
// settled that — but "if every unresolved venue now creates a row, how many
// rows appear, and how many of them are duplicates of something already held?"
//
// Measured on the 131 distinct venue wordings clients actually wrote, and the
// 310 times they wrote them, harvested from sweep_labels. Not on invented
// wordings: the whole point is the rate on the real distribution.
//
// THE MECHANISM THAT BOUNDS IT is already in resolvePlace and is the reason the
// answer is a rate per WORDING rather than per booking. A created row is named
// after the client's words, so the next enquiry writing those words matches it
// exactly. Two hundred bookings at "Ally Pally" create one row, not two hundred.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlaces } from "./rig";
import { NO_POSTCODE_GOLD } from "./venuegold";
import { postcodesIn } from "./venuecandidate";
import type { ConversationFacts } from "../app/lib/engine/types";

const ROOT = join(import.meta.dirname, "..");

(async () => {
  const places = loadPlaces() as any[];
  const byId = new Map(places.map((p) => [p.id, p]));
  const wordings: Array<{ text: string; n: number }> =
    JSON.parse(readFileSync(join(ROOT, ".tmp-data", "study", "venue-wordings.json"), "utf8"));
  const { resolvePlace } = await import("../app/lib/engine/compiler") as any;

  const onsinch = { allPlaces: async () => places } as never;
  const go = (location_text: string) =>
    resolvePlace({ requests: [], location_text } as ConversationFacts, undefined, onsinch);

  // Does the tenant already hold this building? Postcode first — it is the one
  // key that is copied rather than remembered — then the hand labels.
  const byPostcode = new Map<string, any[]>();
  for (const p of places) for (const pc of postcodesIn(p.zip)) {
    if (!byPostcode.has(pc)) byPostcode.set(pc, []);
    byPostcode.get(pc)!.push(p);
  }
  function tenantHolds(text: string): number | null {
    const hand = NO_POSTCODE_GOLD[text] ?? NO_POSTCODE_GOLD[text.trim()];
    if (hand) return typeof hand.label === "number" ? hand.label : null;
    const pcs = postcodesIn(text);
    const uniq = [...new Map(pcs.flatMap((pc) => byPostcode.get(pc) ?? []).map((p) => [p.id, p])).values()];
    return uniq.length ? uniq[0].id : null;
  }

  interface Row { text: string; n: number; created: boolean; id?: number; holds: number | null }
  const rows: Row[] = [];
  for (const w of wordings) {
    const r: any = await go(w.text);
    const placeholder =
      String(r?.provision?.name ?? "").trim().toLowerCase() === "no location" ||
      String(byId.get(r?.id)?.name ?? "").trim().toLowerCase() === "no location";
    rows.push({
      text: w.text, n: w.n,
      created: !!r?.provision && !placeholder,
      id: r?.id,
      holds: tenantHolds(w.text),
    });
  }

  const created = rows.filter((r) => r.created);
  const dup = created.filter((r) => r.holds !== null);
  const genuine = created.filter((r) => r.holds === null);
  const mentions = rows.reduce((s, r) => s + r.n, 0);

  const L = (n = 88) => "-".repeat(n);
  console.log(`\n${"=".repeat(88)}`);
  console.log("  F1 — THE COST OF CREATING A VENUE WHENEVER ONE CANNOT BE RESOLVED");
  console.log("=".repeat(88));
  console.log(`\n  distinct wordings clients wrote      ${String(rows.length).padStart(5)}`);
  console.log(`  times they wrote them                ${String(mentions).padStart(5)}`);
  console.log(`  the tenant's venue table today       ${String(places.length).padStart(5)} rows\n`);
  console.log(L());
  console.log(`  resolved to a building the tenant holds  ${String(rows.length - created.length).padStart(4)}   ${(((rows.length - created.length) / rows.length) * 100).toFixed(1)}%`);
  console.log(`  CREATED a new row                        ${String(created.length).padStart(4)}   ${((created.length / rows.length) * 100).toFixed(1)}%`);
  console.log(`     of which duplicate a row already held ${String(dup.length).padStart(4)}   <- the drift`);
  console.log(`     of which are genuinely new venues     ${String(genuine.length).padStart(4)}   <- what the ruling is for`);
  console.log(L());
  console.log(`\n  DRIFT AGAINST THE TABLE  ${dup.length}/${places.length} = ${((dup.length / places.length) * 100).toFixed(2)}%   (Ben's target: 1%)`);
  console.log(`  Per WORDING, not per booking: those ${rows.length} wordings covered ${mentions} mentions, and a`);
  console.log(`  created row is matched exactly by the next client who writes the same thing.`);

  if (dup.length) {
    console.log(`\n${L()}\n  DUPLICATES — these are what a person has to merge\n${L()}`);
    for (const r of dup.sort((a, b) => b.n - a.n)) {
      const p = byId.get(r.holds!);
      const ctx = [p?.address, p?.city, p?.zip].filter(Boolean).join(", ");
      console.log(`  "${r.text.slice(0, 56)}"  (${r.n}x)`);
      console.log(`      already held as #${r.holds} "${String(p?.name).slice(0, 32)}"${ctx ? " — " + ctx.slice(0, 34) : " [NO ADDRESS]"}`);
    }
  }
  if (genuine.length) {
    console.log(`\n${L()}\n  GENUINELY NEW — the address survives onto the job instead of being discarded\n${L()}`);
    for (const r of genuine.sort((a, b) => b.n - a.n)) console.log(`  ${String(r.n).padStart(3)}x  "${r.text.slice(0, 70)}"`);
  }
  console.log("");
})();
