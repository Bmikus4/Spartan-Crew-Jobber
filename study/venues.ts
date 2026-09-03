// ============================================================================
// THE VENUE TABLE. Every gold venue, every way a client says it, resolved twice.
// ----------------------------------------------------------------------------
//   npx tsx study/venues.ts             deterministic only — FREE
//   npx tsx study/venues.ts --judge     with the adjudicator — COSTS MONEY (~$0.40)
//
// Venue is where every failure in this study lives, and the corpus can only say
// how OFTEN it fails. This says WHICH WORDING fails and WHY, one row per
// phrasing, which is the difference between a number and a fix.
//
// It is run twice on purpose. The corpus's free leg has no adjudicator — it
// must stay free, and the adjudicator is a model call — so its venue figure is
// the DETERMINISTIC spine's, not production's. Production builds the judge
// whenever OPENROUTER_API_KEY is set. Reporting one number for both would be
// wrong in whichever direction the reader guessed, so both are measured and the
// difference is the adjudicator's worth, stated rather than assumed.
// ============================================================================
import { GOLD_VENUES, PLACEHOLDER_PLACE_NAME } from "./gold";
import { loadPlaces } from "./rig";

const withJudge = process.argv.includes("--judge");

(async () => {
  const places = loadPlaces();
  const { resolvePlace } = await import("../app/lib/engine/compiler") as any;

  /**
   * THE WHOLE VENUE DECISION, not one stage of it.
   *
   * This called resolveVenueV3 directly for three days and under-reported the
   * engine: v3 returns null when its own search finds nothing, and production
   * treats that as "keep going" — matchPlace, then the shell rules, then
   * matchPlaceV2, then create. Measuring v3 alone scored the fall-through as a
   * blank, so "Ally Pally" and "Thornbury Assembly Rooms" read as no-answers
   * when production creates a venue for both.
   *
   * resolvePlace needs exactly one thing off the client here, so it gets exactly
   * that. No alias store: a wording Spartan resolved once must not be able to
   * carry this benchmark, or it measures the store rather than the matcher.
   */
  const onsinch = { allPlaces: async () => places } as any;
  const resolve = (said: string) =>
    resolvePlace({ location_text: said } as any, undefined, onsinch, undefined, judge ? { venueJudge: judge } : undefined);
  let judge: any = null;
  if (withJudge) {
    const { loadEnv, requireEnv } = await import("../scripts/_env.mjs");
    const { createVenueJudge } = await import("../app/lib/engine/reason");
    loadEnv();
    judge = createVenueJudge({ apiKey: requireEnv("OPENROUTER_API_KEY"), model: process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6" });
  }

  const byId = new Map(places.map((p: any) => [p.id, p]));
  const rowOf = (id: number | undefined) => {
    if (!id) return "(none)";
    const p: any = byId.get(id);
    if (!p) return `#${id} (not in cache)`;
    const ctx = [p.address, p.city, p.zip].filter(Boolean).join(", ");
    return `#${id} "${p.name}"${ctx ? " — " + ctx : "  [NO ADDRESS]"}`;
  };

  console.log(`\nvenue resolution — ${withJudge ? "WITH the adjudicator (production path)" : "DETERMINISTIC ONLY (no model)"}`);
  console.log(`${places.length} places in the tenant\n`);
  console.log(`${"client's words".padEnd(46)} ${"gold".padEnd(6)} ${"got".padEnd(7)} verdict`);
  console.log("-".repeat(118));

  let total = 0, right = 0;
  const misses: Array<{ said: string; gold: string; got: string; why: string }> = [];

  for (const v of GOLD_VENUES) {
    for (const said of v.said) {
      total++;
      let got: any = null, note = "";
      try {
        got = await resolve(said);
      } catch (e) {
        note = "THREW " + String((e as Error).message).slice(0, 60);
      }
      const id: number | undefined = got?.id;
      const provisioning = got?.provision?.name;
      note = note || String(got?.note ?? "");

      // THREE outcomes, not two, and which one is correct changed on 2026-09-03.
      //
      // Until then the engine parked an unresolved venue on the "No Location"
      // placeholder — commit b0b3422, written after 18 of 19 provisions turned
      // out to duplicate rows the tenant already had. Ben has now ruled the
      // other way: a venue that cannot be resolved is CREATED from the client
      // words, because a booking that carries the client's own address is a
      // booking a human can act on, and a placeholder is not. So NEW is the
      // right answer where the tenant holds no such building, and the
      // placeholder is now only correct when the client named no venue at all.
      const isPlaceholder =
        provisioning === PLACEHOLDER_PLACE_NAME ||
        (id !== undefined && String((byId.get(id) as any)?.name ?? "").trim().toLowerCase() === PLACEHOLDER_PLACE_NAME.toLowerCase());
      const created = !isPlaceholder && id === undefined && !!provisioning;

      const ok = v.gold === null ? created : id === v.gold && !isPlaceholder && !created;
      if (ok) right++;
      else misses.push({
        said,
        gold: v.gold === null ? `a NEW venue named "${said}"` : rowOf(v.gold),
        got: isPlaceholder ? `"${PLACEHOLDER_PLACE_NAME}" placeholder` : created ? `NEW venue "${provisioning}"` : rowOf(id),
        why: note.slice(0, 150),
      });

      const shown = isPlaceholder ? "PH" : created ? "NEW" : String(id ?? "-");
      console.log(
        `${(`"${said}"`).padEnd(46)} ${String(v.gold ?? "NEW").padEnd(6)} ${shown.padEnd(7)} ${ok ? "ok" : "MISS"}`
      );
    }
  }

  console.log("\n" + "=".repeat(118));
  console.log(`resolved correctly: ${right}/${total}  (${((right / total) * 100).toFixed(1)}%)`);
  if (misses.length) {
    console.log("\nMISSES — what the client wrote, where the crew should go, where they would go\n");
    for (const m of misses) {
      console.log(`  "${m.said}"`);
      console.log(`      should: ${m.gold}`);
      console.log(`      would:  ${m.got}`);
      if (m.why) console.log(`      why:    ${m.why}`);
    }
  }
  console.log("");
})();
