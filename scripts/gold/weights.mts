// ============================================================================
// Step 4 of the matcher plan: the weight table, fitted from the gold set, and how well the score
// alone does, cross-validated so no email is scored by weights that saw it.
// ----------------------------------------------------------------------------
// One weight per level of each family (and per density bucket for time, coverage and size), a
// null level adding nothing, exactly as the plan's table. Fitted JOINTLY as a conditional logit:
// one softmax over an email's candidates and "none of these", maximising the chance of the
// gold answer. Counted separately (Fellegi-Sunter m/u), correlated families were added twice:
// "no asked day" under time and again under coverage, so emails it called 99% sure were right
// 96.3% of the time (22 Oct, gold v1). The m/u counts are still written beside each weight.
//
// Which emails count: firm labels only (strong, medium, or adjudicated by hand in
// data/gold/adjudications.jsonl, which also marks the emails no one can settle: those are left
// out). An inherited label is defined by the
// thread's earlier email, which the thread family also reads, so scoring it would grade the
// matcher on its own input. A link email is right when the top choice is an order staff acted on
// for it (several, for an email about several jobs); a new-job email when it is "none of these".
// Folds are by thread. --without precedent,thread repeats it with those families removed: in
// replay they read gold labels, a perfect past production will not have, so the two runs bound
// what production can expect. --keys unique,pairs measures extra keys and writes no table.
//
//   npx tsx scripts/gold/weights.mts [--dir .tmp-data/gold] [--table out.md] [--without a,b] [--keys unique,pairs] [--export rows.jsonl] [--measure]
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { FAMILIES, type Family } from "../../app/lib/match/match";
import { score, densityBucket, type Weights, type LevelWeight } from "../../app/lib/match/score";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir", ".tmp-data/gold");
const WITHOUT = new Set(arg("--without", "").split(",").filter(Boolean));
// Extra keys, measured against the per-level table and not used by the live scorer (score.ts reads
// levels only): "unique" = a level only this candidate of the email shows, "pairs" = every two levels
// a candidate shows together. Measured 23 Oct: pairs bought 4.5 points of coverage at 0.95 for 1,272
// parameters; trees on the same rows (scripts/gold/trees.py) lost to both.
const KEYS = new Set(arg("--keys", "").split(",").filter(Boolean));
const USED = FAMILIES.filter((f) => !WITHOUT.has(f));
const STRATIFIED: Family[] = ["time", "coverage", "size"];
const FOLDS = 5;
const STAFF = /^staff (created|acted on|last changed) it \(day match\)$/;

type Row = { id: string; thread: string; kind: "link" | "new"; truth: Set<number>; accept: Set<number>; context: any; candidates: Array<{ order_id: number; cmp: Record<Family, string | null> }> };
const raw = readFileSync(`${DIR}/features.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rows: Row[] = [];
for (const r of raw) {
  const L = r.label;
  if (!["strong", "medium", "adjudicated"].includes(L.confidence) || L.kind === "unsure") continue;
  const existing = new Set<number>(L.candidates.filter((c: any) => L.orders.includes(c.id) && !c.new).map((c: any) => c.id));
  const made = L.candidates.filter((c: any) => L.orders.includes(c.id) && c.new).length;
  // Also right: any other existing order staff acted on for this email, on a day it names.
  const accept = new Set<number>([...existing, ...L.candidates.filter((c: any) => !c.new && c.sig.some((s: string) => STAFF.test(s))).map((c: any) => c.id)]);
  const cands = r.candidates.map((c: any) => ({ order_id: c.order_id, cmp: Object.fromEntries(FAMILIES.map((f) => [f, USED.includes(f) ? c.cmp[f] : null])) }));
  // "None of these" is right for a new job and for an email that is not about a job at all.
  const noneOfThese = L.kind === "not-a-job" || (L.confidence === "adjudicated" && L.kind === "new-job");
  if (existing.size && !noneOfThese) rows.push({ id: r.message_id, thread: r.thread_id, kind: "link", truth: existing, accept, context: r.context, candidates: cands });
  else if (noneOfThese || (made && L.kind !== "existing")) rows.push({ id: r.message_id, thread: r.thread_id, kind: "new", truth: new Set(), accept: new Set(), context: r.context, candidates: cands });
}
const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const foldOf = (r: Row) => hash(r.thread) % FOLDS;

// ---- the conditional logit ---------------------------------------------------------------------
const keyOf = (f: Family, lvl: string, density: number) => (STRATIFIED.includes(f) ? `${f}@${densityBucket(density)}=${lvl}` : `${f}=${lvl}`);
const noneKey = (r: Row) => (r.context.asks_new ? "none:new_work" : "none:other");
type Opt = { keys: string[]; good: boolean; id: number | null };
const optionsOf = (r: Row): Opt[] => {
  const shown = new Map<string, number>();
  for (const c of r.candidates) for (const f of USED) if (c.cmp[f] != null) shown.set(`${f}=${c.cmp[f]}`, (shown.get(`${f}=${c.cmp[f]}`) ?? 0) + 1);
  return [
    { keys: [noneKey(r)], good: r.kind === "new", id: null },
    ...r.candidates.map((c) => {
      const lv = USED.filter((f) => c.cmp[f] != null).map((f) => `${f}=${c.cmp[f]}`);
      const keys = USED.filter((f) => c.cmp[f] != null).map((f) => keyOf(f, c.cmp[f]!, r.context.density));
      if (KEYS.has("unique")) { for (const k of lv) if (shown.get(k) === 1 && r.candidates.length > 1) keys.push(`${k}!`); if (r.candidates.length === 1) keys.push("only candidate"); }
      if (KEYS.has("pairs")) for (let i = 0; i < lv.length; i++) for (let j = i + 1; j < lv.length; j++) keys.push(`${lv[i]}&${lv[j]}`);
      return { keys, good: r.truth.has(c.order_id), id: c.order_id };
    }),
  ];
};

function fitTheta(train: Row[], lambda: number, iters = 600): Map<string, number> {
  const opts = train.map(optionsOf);
  const theta = new Map<string, number>();
  const g2 = new Map<string, number>();
  for (let it = 0; it < iters; it++) {
    const grad = new Map<string, number>();
    for (const os of opts) {
      const s = os.map((o) => o.keys.reduce((a, k) => a + (theta.get(k) ?? 0), 0));
      const hi = Math.max(...s);
      const e = s.map((x) => Math.exp(x - hi));
      const z = e.reduce((a, b) => a + b, 0);
      const zg = e.reduce((a, x, i) => a + (os[i].good ? x : 0), 0);
      if (!zg) continue;
      os.forEach((o, i) => { const d = (o.good ? e[i] / zg : 0) - e[i] / z; if (d) for (const k of o.keys) grad.set(k, (grad.get(k) ?? 0) + d); });
    }
    for (const k of new Set([...grad.keys(), ...theta.keys()])) {
      const g = (grad.get(k) ?? 0) - lambda * (theta.get(k) ?? 0);
      g2.set(k, (g2.get(k) ?? 0) + g * g);
      theta.set(k, (theta.get(k) ?? 0) + (0.5 * g) / (Math.sqrt(g2.get(k)!) + 1e-8));
    }
  }
  return theta;
}

/** The fitted parameters in the scorer's shape: bits per level, with the counts beside them. */
function toWeights(theta: Map<string, number>, train: Row[], note: string): Weights {
  const counts = new Map<string, [number, number]>();
  for (const r of train) for (const c of r.candidates) for (const f of USED) {
    const lvl = c.cmp[f];
    if (lvl == null) continue;
    for (const k of new Set([keyOf(f, lvl, r.context.density), `${f}=${lvl}`])) { const x = counts.get(k) ?? [0, 0]; x[r.truth.has(c.order_id) ? 1 : 0]++; counts.set(k, x); }
  }
  const levels: Weights["levels"] = {};
  const bits = (k: string) => (theta.get(k) ?? 0) / Math.LN2;
  const lw = (k: string, w: number): LevelWeight => { const [n0, n1] = counts.get(k) ?? [0, 0]; return { w, m: 0, u: 0, n1, n0 }; };
  for (const [k] of counts) {
    const m = /^([a-z]+)(?:@([^=]+))?=(.*)$/.exec(k)!;
    const f = m[1] as Family, stratum = m[2], lvl = m[3];
    const t = ((levels[f] ??= {}) as Record<string, Record<string, LevelWeight>>);
    if (STRATIFIED.includes(f)) {
      if (stratum) (t[stratum] ??= {})[lvl] = lw(k, bits(k));
    } else if (!stratum) (t.all ??= {})[lvl] = lw(k, bits(k));
  }
  // For a stratified family, "all" shows the weight averaged over its buckets by how often each occurs.
  for (const f of STRATIFIED) {
    const t = levels[f];
    if (!t) continue;
    const all: Record<string, LevelWeight> = {};
    for (const [s, lv] of Object.entries(t)) for (const [lvl, x] of Object.entries(lv)) {
      const n = x.n0 + x.n1, a = all[lvl] ?? { w: 0, m: 0, u: 0, n1: 0, n0: 0 };
      a.w += x.w * n; a.n0 += x.n0; a.n1 += x.n1; all[lvl] = a; void s;
    }
    for (const x of Object.values(all)) x.w /= Math.max(1, x.n0 + x.n1);
    t.all = all;
  }
  for (const t of Object.values(levels)) for (const lv of Object.values(t!)) for (const x of Object.values(lv)) {
    const tot1 = Object.values(lv).reduce((a, y) => a + y.n1, 0), tot0 = Object.values(lv).reduce((a, y) => a + y.n0, 0);
    x.m = tot1 ? x.n1 / tot1 : 0; x.u = tot0 ? x.n0 / tot0 : 0;
  }
  return { version: "gold-v1-clogit", fitted_on: note, stratified: STRATIFIED, levels, none: { new_work: bits("none:new_work"), other: bits("none:other") } };
}

// ---- cross-validation ------------------------------------------------------------------------
type Res = { r: Row; ok: boolean; p: number; pick: number | null; wrongLink: boolean };
function crossValidate(lambda: number): { res: Res[]; logloss: number } {
  const res: Res[] = [];
  let ll = 0;
  for (let k = 0; k < FOLDS; k++) {
    const train = rows.filter((r) => foldOf(r) !== k);
    // Extra keys have no place in the scorer's table, so those variants are scored from the fit itself.
    const theta = fitTheta(train, lambda), W = KEYS.size ? null : toWeights(theta, train, "fold");
    for (const r of rows.filter((x) => foldOf(x) === k)) {
      let p: number[], ids: Array<number | null>;
      if (W) { const sc = score(r, W); p = [sc.none.p, ...sc.candidates.map((c) => c.p)]; ids = [null, ...sc.candidates.map((c) => c.order_id)]; }
      else {
        const os = optionsOf(r), s = os.map((o) => o.keys.reduce((a, key) => a + (theta.get(key) ?? 0), 0));
        const hi = Math.max(...s), e = s.map((x) => Math.exp(x - hi)), z = e.reduce((a, b) => a + b, 0);
        p = e.map((x) => x / z); ids = os.map((o) => o.id);
      }
      const pGood = r.kind === "new" ? p[0] : ids.reduce((a: number, id, i) => a + (id !== null && r.truth.has(id) ? p[i] : 0), 0);
      ll += Math.log(Math.max(pGood, 1e-9));
      const t = p.indexOf(Math.max(...p)), pick = ids[t];
      const ok = r.kind === "new" ? pick === null : pick !== null && r.accept.has(pick);
      res.push({ r, ok, p: p[t], pick, wrongLink: pick !== null && !r.accept.has(pick) });
    }
  }
  return { res, logloss: -ll / rows.length };
}
const exportTo = arg("--export", "");
if (exportTo) {
  // The same options, one line each, for the tree comparison (scripts/gold/trees.py).
  writeFileSync(exportTo, rows.flatMap((r, e) => optionsOf(r).map((o, j) => JSON.stringify({
    e, fold: foldOf(r), good: o.good ? 1 : 0, ok: o.id === null ? (r.kind === "new" ? 1 : 0) : (r.accept.has(o.id) ? 1 : 0), none: o.id === null ? 1 : 0,
    asks_new: r.context.asks_new ? 1 : 0, density: r.context.density ?? 0, n: r.candidates.length, cmp: j ? r.candidates[j - 1].cmp : null,
  }))).join("\n") + "\n");
  console.log(`exported the options of ${rows.length} emails to ${exportTo}`);
  process.exit(0);
}
let best = { lambda: 0, logloss: Infinity, res: [] as Res[] };
for (const lambda of KEYS.size ? [1, 2, 4] : [0.1, 0.5, 1, 2, 4]) {
  const cv = crossValidate(lambda);
  console.log(`lambda ${lambda}: cv log-loss ${cv.logloss.toFixed(4)}, right ${cv.res.filter((x) => x.ok).length}/${cv.res.length}`);
  if (cv.logloss < best.logloss) best = { lambda, ...cv };
}
const results = best.res;
const wilsonLo = (k: number, n: number, z = 1.96) => { if (!n) return 0; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return (c - s) / d; };
const pct = (k: number, n: number) => `${k}/${n} (${n ? (100 * k / n).toFixed(1) : "0"}%)`;
const link = results.filter((x) => x.r.kind === "link"), neu = results.filter((x) => x.r.kind === "new");
const variant = [WITHOUT.size ? `without_${[...WITHOUT].join("_")}` : "", KEYS.size ? `with_${[...KEYS].join("_")}` : ""].filter(Boolean).join("_");
console.log(`\n${WITHOUT.size ? `WITHOUT ${[...WITHOUT].join(", ")}; ` : ""}${KEYS.size ? `WITH ${[...KEYS].join(", ")} keys; ` : ""}lambda ${best.lambda}; emails scored ${results.length}: link ${link.length}, new job ${neu.length}`);
console.log(`score alone: ${pct(results.filter((x) => x.ok).length, results.length)}; link emails right order ${pct(link.filter((x) => x.ok).length, link.length)}; new jobs called new ${pct(neu.filter((x) => x.ok).length, neu.length)}; wrong order picked ${pct(results.filter((x) => x.wrongLink).length, results.length)}`);
const reliability: string[] = [];
for (const [lo, hi] of [[0, 0.5], [0.5, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.95], [0.95, 0.99], [0.99, 1.01]]) {
  const b = results.filter((x) => x.p >= lo && x.p < hi);
  reliability.push(`${lo}-${Math.min(hi, 1)}: ${pct(b.filter((x) => x.ok).length, b.length)}`);
}
console.log("calibration, top probability -> right:", reliability.join(" | "));
const coverage: any[] = [];
for (const t of [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99]) {
  const auto = results.filter((x) => x.p >= t);
  const right = auto.filter((x) => x.ok).length;
  coverage.push({ threshold: t, coverage: Number((auto.length / results.length).toFixed(3)), accuracy: Number((right / Math.max(1, auto.length)).toFixed(4)), lower95: Number(wilsonLo(right, auto.length).toFixed(4)), wrong_links: auto.filter((x) => x.wrongLink).length });
}
console.log("threshold: coverage accuracy lower95 wrong-links\n  " + coverage.map((c) => `${c.threshold}: ${c.coverage} ${c.accuracy} ${c.lower95} ${c.wrong_links}`).join("\n  "));
writeFileSync(`${DIR}/score-misses${variant ? `-${variant}` : ""}.jsonl`, results.filter((x) => !x.ok).map((x) => JSON.stringify({ id: x.r.id, kind: x.r.kind, truth: [...x.r.truth], pick: x.pick, p: Number(x.p.toFixed(3)) })).join("\n") + "\n");

// ---- the table, fitted on every scored email ---------------------------------------------------
if (!variant) {
  const W = toWeights(fitTheta(rows, best.lambda, 1200), rows, `gold set v1 firm labels, ${rows.length} emails (${link.length} link, ${neu.length} new job), conditional logit, L2 ${best.lambda}, fitted ${new Date().toISOString().slice(0, 10)}`);
  writeFileSync("app/lib/match/weights.json", JSON.stringify(W, null, 1) + "\n");
  console.log(`none of these: ${W.none.new_work.toFixed(2)} bits when new work is asked, ${W.none.other.toFixed(2)} otherwise; wrote app/lib/match/weights.json`);
  const tableOut = arg("--table", "");
  if (tableOut) {
    const lines = ["| Family | Level | Weight (bits) | True links showing it | Other candidates showing it |", "| --- | --- | --- | --- | --- |"];
    for (const f of USED) {
      const t = W.levels[f]?.all;
      if (!t) continue;
      for (const [lvl, x] of Object.entries(t).sort((a, b) => b[1].w - a[1].w)) lines.push(`| ${f} | ${lvl} | ${x.w >= 0 ? "+" : ""}${x.w.toFixed(1)} | ${x.n1} | ${x.n0} |`);
    }
    lines.push(`| none of these | email asks for new work | ${W.none.new_work >= 0 ? "+" : ""}${W.none.new_work.toFixed(1)} | | |`, `| none of these | any other email | ${W.none.other >= 0 ? "+" : ""}${W.none.other.toFixed(1)} | | |`);
    writeFileSync(tableOut, lines.join("\n") + "\n");
    console.log(`table: ${tableOut}`);
  }
}
if (process.argv.includes("--measure")) {
  const { recordMeasurement } = await import("../_gateMeasure.mjs");
  recordMeasurement(`matcher_score_alone${variant ? `_${variant}` : ""}`, {
    dataset: `gold set v1 firm labels (strong, medium, adjudicated): ${results.length} emails (${link.length} link, ${neu.length} new job), ${FOLDS}-fold by thread`,
    instrument: `scripts/gold/weights.mts${WITHOUT.size ? ` --without ${[...WITHOUT].join(",")}` : ""}${KEYS.size ? ` --keys ${[...KEYS].join(",")}` : ""}`,
    log_loss: Number(best.logloss.toFixed(4)),
    denominator: "firm-labelled emails; a link email is right when the top choice is an order staff acted on for it, a new-job email when it is none of these",
    lambda: best.lambda, right: results.filter((x) => x.ok).length, of: results.length, link_right: link.filter((x) => x.ok).length, link_of: link.length,
    new_right: neu.filter((x) => x.ok).length, new_of: neu.length, wrong_links: results.filter((x) => x.wrongLink).length, coverage,
  });
}
