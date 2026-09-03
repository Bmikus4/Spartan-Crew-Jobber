// ============================================================================
// F1 VERDICT — the shipping resolver against the candidate, same labels.
// ----------------------------------------------------------------------------
//   npx tsx study/venuecompare.ts           the headline — FREE
//   npx tsx study/venuecompare.ts --detail  every wording, both answers
//
// The question Ben set: can a deterministic change be VERIFIED to raise venue
// accuracy? This answers it or it does not, and if it does not, nothing in app/
// gets touched.
//
// Scored on 117 real client wordings from the bookings mailbox: 50 where a
// postcode settles the answer, and 67 hand-labelled against the tenant's rows,
// of which 9 are marked ambiguous and excluded from both sides.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlaces } from "./rig";
import { NO_POSTCODE_GOLD, type VenueLabel } from "./venuegold";
import { resolveCandidate, postcodesIn } from "./venuecandidate";

const DETAIL = process.argv.includes("--detail");
const ROOT = join(import.meta.dirname, "..");

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const cover = (a: string[], b: string[]) => (!a.length ? 1 : a.filter((w) => b.includes(w)).length / a.length);

(async () => {
  const places = loadPlaces() as any[];
  const byId = new Map(places.map((p) => [p.id, p]));
  const wordings: Array<{ text: string; n: number }> =
    JSON.parse(readFileSync(join(ROOT, ".tmp-data", "study", "venue-wordings.json"), "utf8"));
  const { resolveVenueV3 } = await import("../app/lib/engine/compiler") as any;

  // ------------------------------------------------ truth
  const byPostcode = new Map<string, any[]>();
  for (const p of places) for (const pc of postcodesIn(p.zip)) {
    if (!byPostcode.has(pc)) byPostcode.set(pc, []);
    byPostcode.get(pc)!.push(p);
  }
  function truthOf(text: string): { label: VenueLabel | null; why: string } {
    const hand = NO_POSTCODE_GOLD[text] ?? NO_POSTCODE_GOLD[text.trim()];
    if (hand) return { label: hand.label, why: hand.why };
    const pcs = postcodesIn(text);
    if (!pcs.length) return { label: null, why: "no postcode and no hand label" };
    const uniq = [...new Map(pcs.flatMap((pc) => byPostcode.get(pc) ?? []).map((p) => [p.id, p])).values()];
    if (uniq.length === 1) return { label: uniq[0].id, why: "one tenant row at this postcode" };
    if (!uniq.length) return { label: null, why: "postcode not in the tenant" };
    const scored = uniq
      .map((p) => ({ p, s: cover(norm(`${p.name} ${p.alias ?? ""}`).split(" "), norm(text).split(" ")) }))
      .sort((a, b) => b.s - a.s);
    if (scored[0].s >= 0.5 && (scored.length === 1 || scored[0].s > scored[1].s)) return { label: scored[0].p.id, why: "postcode + name agreement" };
    return { label: null, why: `${uniq.length} rows share the postcode; unscored` };
  }

  const rowOf = (id?: number) => {
    if (id === undefined) return "(create)";
    const p = byId.get(id);
    if (!p) return `#${id}`;
    const ctx = [p.address, p.city, p.zip].filter(Boolean).join(", ");
    return `#${id} "${String(p.name).slice(0, 28)}"${ctx ? " — " + ctx.slice(0, 30) : " [NO ADDR]"}`;
  };

  // ------------------------------------------------ run both
  interface Row { text: string; n: number; truth: VenueLabel; cur?: number; curCreate: boolean; cand?: number; candCreate: boolean }
  const rows: Row[] = [];
  for (const w of wordings) {
    const { label } = truthOf(w.text);
    if (label === null || label === "AMBIGUOUS") continue;

    let cur: number | undefined, curCreate = false;
    try {
      const r = await resolveVenueV3(w.text, places, null, undefined);
      cur = r?.id;
      const nm = r?.provision?.name ?? (cur !== undefined ? byId.get(cur)?.name : undefined);
      // The placeholder and "no answer" are the same outcome for this question:
      // no building was identified, so under the new policy a venue is created.
      if (String(nm ?? "").trim().toLowerCase() === "no location" || cur === undefined) { curCreate = true; cur = undefined; }
    } catch { curCreate = true; }

    const c = resolveCandidate(w.text, places);
    rows.push({ text: w.text, n: w.n, truth: label, cur, curCreate, cand: c.id, candCreate: !!c.create });
  }

  const ok = (r: Row, which: "cur" | "cand") => {
    const create = which === "cur" ? r.curCreate : r.candCreate;
    const id = which === "cur" ? r.cur : r.cand;
    if (r.truth === "CREATE") return create;
    return !create && id === r.truth;
  };
  const wrongBuilding = (r: Row, which: "cur" | "cand") => {
    const create = which === "cur" ? r.curCreate : r.candCreate;
    const id = which === "cur" ? r.cur : r.cand;
    return !create && id !== undefined && r.truth !== "CREATE" && id !== r.truth;
  };

  const curOk = rows.filter((r) => ok(r, "cur")), candOk = rows.filter((r) => ok(r, "cand"));
  const curWrong = rows.filter((r) => wrongBuilding(r, "cur")), candWrong = rows.filter((r) => wrongBuilding(r, "cand"));
  const ambiguous = wordings.filter((w) => (NO_POSTCODE_GOLD[w.text] ?? NO_POSTCODE_GOLD[w.text.trim()])?.label === "AMBIGUOUS");

  const pct = (k: number) => `${((k / rows.length) * 100).toFixed(1).padStart(5)}%`;
  const L = (n = 92) => "-".repeat(n);
  console.log(`\n${"=".repeat(92)}`);
  console.log("  F1 — DOES A DETERMINISTIC CHANGE VERIFIABLY RAISE VENUE ACCURACY?");
  console.log("=".repeat(92));
  console.log(`\n  scored wordings                 ${rows.length}   (${rows.reduce((s, r) => s + r.n, 0)} mentions in the mailbox)`);
  console.log(`  excluded as genuinely ambiguous ${ambiguous.length}   (${ambiguous.map((a) => JSON.stringify(a.text.slice(0, 18))).join(", ")})`);

  console.log(`\n${L()}`);
  console.log(`  ${"".padEnd(30)} ${"shipping".padStart(16)} ${"candidate".padStart(16)}`);
  console.log(L());
  console.log(`  ${"right building / right to create".padEnd(30)} ${(curOk.length + "/" + rows.length).padStart(10)} ${pct(curOk.length)} ${(candOk.length + "/" + rows.length).padStart(10)} ${pct(candOk.length)}`);
  console.log(`  ${"WRONG BUILDING".padEnd(30)} ${String(curWrong.length).padStart(10)} ${pct(curWrong.length)} ${String(candWrong.length).padStart(10)} ${pct(candWrong.length)}`);
  const curCre = rows.filter((r) => r.curCreate && r.truth !== "CREATE");
  const candCre = rows.filter((r) => r.candCreate && r.truth !== "CREATE");
  console.log(`  ${"would create a DUPLICATE".padEnd(30)} ${String(curCre.length).padStart(10)} ${pct(curCre.length)} ${String(candCre.length).padStart(10)} ${pct(candCre.length)}`);

  const fixed = rows.filter((r) => !ok(r, "cur") && ok(r, "cand"));
  const broke = rows.filter((r) => ok(r, "cur") && !ok(r, "cand"));
  console.log(`\n  net change  ${candOk.length - curOk.length >= 0 ? "+" : ""}${candOk.length - curOk.length}   (${fixed.length} fixed, ${broke.length} regressed)`);

  if (fixed.length) {
    console.log(`\n${L()}\n  FIXED by the candidate\n${L()}`);
    for (const r of fixed) {
      console.log(`  "${r.text.slice(0, 58)}"  (${r.n}x)`);
      console.log(`      was:  ${r.curCreate ? "(create)" : rowOf(r.cur)}`);
      console.log(`      now:  ${r.candCreate ? "(create)" : rowOf(r.cand)}      truth: ${r.truth === "CREATE" ? "CREATE" : rowOf(r.truth as number)}`);
    }
  }
  if (broke.length) {
    console.log(`\n${L()}\n  REGRESSED by the candidate — these decide whether it ships\n${L()}`);
    for (const r of broke) {
      console.log(`  "${r.text.slice(0, 58)}"  (${r.n}x)`);
      console.log(`      was:  ${r.curCreate ? "(create)" : rowOf(r.cur)}`);
      console.log(`      now:  ${r.candCreate ? "(create)" : rowOf(r.cand)}      truth: ${r.truth === "CREATE" ? "CREATE" : rowOf(r.truth as number)}`);
    }
  }
  if (candWrong.length) {
    console.log(`\n${L()}\n  STILL WRONG under the candidate\n${L()}`);
    for (const r of candWrong) {
      console.log(`  "${r.text.slice(0, 58)}"  -> ${rowOf(r.cand)}   truth ${rowOf(r.truth as number)}`);
    }
  }
  if (DETAIL) {
    console.log(`\n${L()}\n  EVERY SCORED WORDING\n${L()}`);
    for (const r of rows) {
      const a = ok(r, "cur") ? "ok  " : "MISS", b = ok(r, "cand") ? "ok  " : "MISS";
      console.log(`  ${a} ${b}  "${r.text.slice(0, 52).padEnd(52)}"  ship=${(r.curCreate ? "create" : String(r.cur)).padEnd(8)} cand=${(r.candCreate ? "create" : String(r.cand)).padEnd(8)} truth=${r.truth}`);
    }
  }
  console.log("");
})();
