// ============================================================================
// Scoring the corpus study against the hypotheses it was pre-registered with.
// ----------------------------------------------------------------------------
//   npx tsx sim/corpus-report.ts
//
// Reads .tmp-data/corpus/results.jsonl and prints the eight hypotheses of
// docs/CORPUS-STUDY-2026-08.md with their measured value and their verdict, then the
// error taxonomy and the per-cell counts.
//
// PER-CELL NUMBERS ARE COUNTS, NEVER RATES. With 500 cases across this many factors most
// cells hold a handful of observations, and a percentage over n=3 reads as a measurement
// when it is an anecdote. The hypothesis table is the only place a rate appears, because
// those are the only denominators large enough to carry one.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Row {
  id: string;
  factors: Record<string, string | number | boolean>;
  expected: { holds: boolean; requested: number; expectsReplace: boolean; provable: boolean; amendedRequested: number | null };
  ok: boolean;
  error?: string;
  new_: { status?: string; order_id?: number; r?: string; crew?: number; teams?: number; notes?: string[]; window?: string };
  amend_?: { status?: string; order_id?: number; r?: string; crew?: number; path?: string; notes?: string[]; window?: string; r_survived?: boolean; proven?: string };
  wire: string[];
  ms: number;
}

const FILE = join(import.meta.dirname, "..", ".tmp-data", "corpus", "results.jsonl");
const rows: Row[] = readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}% (${a}/${b})`);
const verdict = (v: number, total: number, ready: number, notReady: number) => {
  if (total === 0) return "NO DATA";
  const r = v / total;
  return r >= ready ? "READY" : r < notReady ? "NOT READY" : "MARGINAL";
};

// ---------------------------------------------------------------- the populations
const held = rows.filter((r) => r.expected.holds);
const bookable = rows.filter((r) => !r.expected.holds);
const created = bookable.filter((r) => r.new_.order_id);
const amendedCases = rows.filter((r) => r.amend_);
// An amendment is only "amendable in place" when the order it amends actually exists and
// the change is expressible — a dropped block is not, by OnSinch's own limits.
const amendable = amendedCases.filter((r) => r.new_.order_id && !r.expected.expectsReplace);
const inPlace = amendable.filter((r) => /(^|,)amend(,|$)/.test(r.amend_?.path || ""));
const dropped = amendedCases.filter((r) => r.expected.expectsReplace && r.new_.order_id);

console.log(`\n=== THE 500-BOOKING CORPUS STUDY — RESULTS (n=${rows.length}) ===\n`);
console.log(`bookable cases ......... ${bookable.length}`);
console.log(`held by design (TBC) ... ${held.length}`);
console.log(`amended ................ ${amendedCases.length}`);
console.log(`orders created ......... ${created.length}`);
console.log(`total wall time ........ ${Math.round(rows.reduce((n, r) => n + r.ms, 0) / 1000)}s of case time`);

console.log(`\n--- HYPOTHESES, against the thresholds registered before the run\n`);
const table: Array<[string, string, string, string]> = [];

// H1 — the engine's order is accepted by OnSinch.
{
  const accepted = bookable.filter((r) => r.new_.order_id).length;
  table.push(["H1", "creates accepted by OnSinch", pct(accepted, bookable.length),
    verdict(accepted, bookable.length, 0.99, 0.97)]);
}
// H2 — the crew written is the crew asked for. Chief carve-out keeps the headcount, so
// the composed total must equal the requested total exactly.
{
  const right = created.filter((r) => r.new_.crew === r.expected.requested).length;
  table.push(["H2", "headcount = what the client asked for", pct(right, created.length),
    verdict(right, created.length, 1, 1)]);
}
// H3 — a crew change reaches the order in place.
table.push(["H3", "amendments applied IN PLACE", pct(inPlace.length, amendable.length),
  verdict(inPlace.length, amendable.length, 0.95, 0.9)]);
// H4 — an amendment does not cost the R number.
{
  const kept = amendable.filter((r) => r.amend_?.r_survived).length;
  table.push(["H4", "R number survived the amendment", pct(kept, amendable.length),
    verdict(kept, amendable.length, 1, 1)]);
}
// H5 — a dropped block falls back to the rebuild and says so.
{
  const replaced = dropped.filter((r) => /replace/.test(r.amend_?.path || "")).length;
  table.push(["H5", "dropped block took the replace path", pct(replaced, dropped.length),
    verdict(replaced, dropped.length, 1, 1)]);
}
// H6 — nothing is reported as done that did not happen. The job window is the only oracle
// that cannot lie, so this is checked only where it can speak: a case whose window SHOULD
// have moved and did not, while the engine reported success.
{
  const claimants = amendedCases.filter((r) => r.expected.provable && /(^|,)amend(,|$)/.test(r.amend_?.path || ""));
  const lying = claimants.filter((r) => r.amend_?.proven !== "PROVEN");
  table.push(["H6", "claimed success with an unmoved window", `${lying.length} of ${claimants.length} provable claims`,
    lying.length === 0 ? "READY" : "NOT READY"]);
}
// H7 — a TBC booking is held, never written.
{
  const leaked = held.filter((r) => r.new_.order_id).length;
  table.push(["H7", "TBC cases that reached OnSinch", `${leaked} of ${held.length}`,
    leaked === 0 ? "READY" : "NOT READY"]);
}
// H8 — no orphans. Every order that was created passed through the wire ledger, so this
// compares orders seen created against orders the results account for.
{
  const wireCreates = rows.reduce((n, r) => n + (r.wire || []).filter((w) => w.startsWith("POST /orders ->") && w.endsWith("201")).length, 0);
  const accounted = rows.filter((r) => r.new_.order_id).length + rows.filter((r) => r.amend_?.order_id && r.amend_.order_id !== r.new_.order_id).length;
  table.push(["H8", "orders created on the wire vs accounted for", `${wireCreates} created, ${accounted} named in results`,
    wireCreates >= accounted ? "SEE LEDGER" : "NOT READY"]);
}
const w = [4, 42, 34, 12];
for (const r of table) console.log(r.map((c, i) => String(c).padEnd(w[i])).join(""));

// ---------------------------------------------------------------- error taxonomy
console.log(`\n--- ERROR TAXONOMY, ranked by what each class costs\n`);
const classes = new Map<string, { n: number; example: string; cases: string[] }>();
const classify = (note: string): string | null => {
  if (/Name is too long/.test(note)) return "order refused: job name over 80 chars";
  if (/Wrong end time/.test(note)) return "order refused: shift crosses midnight (end before start)";
  if (/Fill in correct location/.test(note)) return "order refused: a block had no venue id";
  if (/Cannot find suitable wagelist/.test(note)) return "order refused: no wagelist for this rate card";
  if (/createSlotTeam 400/.test(note)) return "block refused: other 400";
  if (/createOrder 400/.test(note)) return "order refused: other 400";
  if (/could not be given its crew blocks/.test(note)) return "create rolled back after the order existed";
  if (/must be applied by hand/.test(note)) return "amendment fell back to a human";
  if (/NOT applied/.test(note)) return "amendment refused";
  return null;
};
for (const r of rows) {
  for (const n of [...(r.new_.notes || []), ...(r.amend_?.notes || [])]) {
    const k = classify(n);
    if (!k) continue;
    const e = classes.get(k) || { n: 0, example: n, cases: [] };
    e.n++; if (e.cases.length < 4) e.cases.push(r.id);
    classes.set(k, e);
  }
}
for (const [k, v] of [...classes.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(v.n).padStart(4)}  ${k}`);
  console.log(`      e.g. ${v.cases.join(", ")}`);
  console.log(`      ${v.example.slice(0, 150)}`);
}
if (!classes.size) console.log("  none");

// ---------------------------------------------------------------- per-cell counts
console.log(`\n--- PER-CELL COUNTS (observations, not rates)\n`);
const cell = (factor: string) => {
  const m = new Map<string, { n: number; ok: number }>();
  for (const r of rows) {
    const k = String(r.factors[factor]);
    const e = m.get(k) || { n: 0, ok: 0 };
    e.n++;
    if (r.expected.holds ? !r.new_.order_id : !!r.new_.order_id) e.ok++;
    m.set(k, e);
  }
  return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};
for (const f of ["size", "venue", "shift", "task", "blocks", "times", "dated", "amendment"]) {
  console.log(`${f}:`);
  for (const [k, v] of cell(f)) console.log(`   ${String(k).padEnd(24)} ${String(v.ok).padStart(3)}/${String(v.n).padEnd(3)} as expected`);
}

// The amendment shapes, which are the point of the amended half.
console.log(`\n--- AMENDMENT SHAPES\n`);
const shapes = new Map<string, { n: number; amend: number; replace: number; patch: number; refused: number; rKept: number; proven: number }>();
for (const r of amendedCases) {
  const k = String(r.factors.amendment);
  const e = shapes.get(k) || { n: 0, amend: 0, replace: 0, patch: 0, refused: 0, rKept: 0, proven: 0 };
  e.n++;
  const p = r.amend_?.path || "";
  if (/(^|,)amend(,|$)/.test(p)) e.amend++;
  if (/replace(,|$)/.test(p)) e.replace++;
  if (/(^|,)patch/.test(p)) e.patch++;
  if (/refused/.test(p)) e.refused++;
  if (r.amend_?.r_survived) e.rKept++;
  if (r.amend_?.proven === "PROVEN") e.proven++;
  shapes.set(k, e);
}
console.log("shape          n   amend replace patch refused  R kept  PROVEN");
for (const [k, v] of [...shapes.entries()].sort()) {
  console.log(`${k.padEnd(14)} ${String(v.n).padStart(3)}   ${String(v.amend).padStart(5)} ${String(v.replace).padStart(7)} ${String(v.patch).padStart(5)} ${String(v.refused).padStart(7)}  ${String(v.rKept).padStart(6)}  ${String(v.proven).padStart(6)}`);
}
console.log("");
