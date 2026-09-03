// ============================================================================
// Reading the results. Counts, not rates, wherever a cell is small.
// ----------------------------------------------------------------------------
//   npx tsx study/analyse.ts --leg=free
//   npx tsx study/analyse.ts --leg=model
//   npx tsx study/analyse.ts --leg=free --json > out.json
//
// A percentage over n=2 is a lie, so every breakdown prints the denominator
// beside it and the report quotes counts for anything under ten.
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GATES, type Gate } from "./score";

const argv = process.argv.slice(2);
const strOf = (n: string, d: string) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? String(a.split("=")[1]) : d;
};
const LEG = strOf("leg", "free");
const FILE = join(import.meta.dirname, "..", ".tmp-data", "study", `results-${LEG}.jsonl`);
if (!existsSync(FILE)) throw new Error(`no results at ${FILE} — run study/run.ts --leg=${LEG} first`);

const rows = readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const pct = (a: number, b: number) => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1).padStart(5)}%`);
const bar = (a: number, b: number, w = 24) => {
  const n = b === 0 ? 0 : Math.round((a / b) * w);
  return "█".repeat(n) + "·".repeat(w - n);
};

// ---------------------------------------------------------------- headline
const first = rows.filter((r) => r.new_);
const threw = rows.filter((r) => !r.new_);
const firstPass = first.filter((r) => r.new_.scored.pass);
const amends = rows.filter((r) => r.amend_);
const amendPass = amends.filter((r) => r.amend_.scored.pass);

/**
 * THE END-TO-END NUMBER. A thread counts once and passes only if EVERY email in
 * it produced the right outcome — the first request and, where there is one,
 * the follow-up. A booking that is placed correctly and then broken by an
 * amendment is a broken booking, and counting the two emails separately would
 * report it as one success and one failure and average away the client's
 * experience of it.
 */
const threads = rows.map((r) => ({
  id: r.id,
  cell: r.cell,
  ok: !!r.new_?.scored?.pass && (!r.amend_ || !!r.amend_.scored.pass),
  firstFail: !r.new_?.scored?.pass ? r.new_?.scored?.firstFail ?? "threw" : r.amend_?.scored?.firstFail ?? null,
  stage: !r.new_?.scored?.pass ? "enquiry" : r.amend_ && !r.amend_.scored.pass ? "amendment" : null,
}));
const threadsOk = threads.filter((t) => t.ok);

console.log(`\n${"=".repeat(78)}`);
console.log(`  SPARTAN CREW JOBBER — END-TO-END PIPELINE ACCURACY   [leg: ${LEG}]`);
console.log(`${"=".repeat(78)}\n`);
console.log(`  threads run                 ${rows.length}`);
console.log(`  emails processed            ${first.length + amends.length}   (${first.length} enquiries, ${amends.length} follow-ups)`);
console.log(`  threw before producing state ${threw.length}`);
console.log("");
console.log(`  END-TO-END ACCURACY         ${pct(threadsOk.length, threads.length)}   ${threadsOk.length}/${threads.length} threads correct on every email`);
console.log(`    ${bar(threadsOk.length, threads.length, 40)}`);
console.log("");
console.log(`  first enquiry correct       ${pct(firstPass.length, first.length)}   ${firstPass.length}/${first.length}`);
console.log(`  follow-up correct           ${pct(amendPass.length, amends.length)}   ${amendPass.length}/${amends.length}`);

// ---------------------------------------------------------------- per gate
console.log(`\n${"-".repeat(78)}\n  PER-GATE — of the cases where the gate applies\n${"-".repeat(78)}`);
const gateRow = (g: Gate, set: any[], key: "new_" | "amend_") => {
  const applic = set.filter((r) => r[key].scored.gates[g] !== null);
  const ok = applic.filter((r) => r[key].scored.gates[g] === true);
  return { applic: applic.length, ok: ok.length };
};
console.log(`  ${"gate".padEnd(16)} ${"enquiry".padStart(16)}   ${"follow-up".padStart(16)}`);
for (const g of GATES) {
  const a = gateRow(g, first, "new_");
  const b = gateRow(g, amends, "amend_");
  console.log(
    `  ${g.padEnd(16)} ${pct(a.ok, a.applic)} ${String(`(${a.ok}/${a.applic})`).padStart(11)}   ` +
    `${pct(b.ok, b.applic)} ${String(`(${b.ok}/${b.applic})`).padStart(11)}`
  );
}

// ---------------------------------------------------------------- causes
console.log(`\n${"-".repeat(78)}\n  WHAT FAILED FIRST — one cause per failed thread\n${"-".repeat(78)}`);
const causes: Record<string, { n: number; stage: Record<string, number> }> = {};
for (const t of threads) {
  if (t.ok) continue;
  const k = String(t.firstFail ?? "unknown");
  causes[k] ??= { n: 0, stage: {} };
  causes[k].n++;
  causes[k].stage[t.stage ?? "?"] = (causes[k].stage[t.stage ?? "?"] ?? 0) + 1;
}
for (const [k, v] of Object.entries(causes).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(16)} ${String(v.n).padStart(4)}  ${pct(v.n, threads.length)}  ${JSON.stringify(v.stage)}`);
}

// ---------------------------------------------------------------- by factor
console.log(`\n${"-".repeat(78)}\n  BY FACTOR — counts, because most cells are small\n${"-".repeat(78)}`);
const FACTORS = ["kind", "size", "role", "venue", "shift", "times", "date", "blocks", "noise", "merge", "task", "amendment"];
for (const f of FACTORS) {
  const cells: Record<string, { n: number; ok: number }> = {};
  for (const t of threads) {
    const v = String(t.cell?.[f] ?? "");
    if (v === "") continue;
    cells[v] ??= { n: 0, ok: 0 };
    cells[v].n++;
    if (t.ok) cells[v].ok++;
  }
  const entries = Object.entries(cells).sort((a, b) => (a[1].ok / a[1].n) - (b[1].ok / b[1].n));
  if (!entries.length) continue;
  console.log(`\n  ${f}`);
  for (const [v, c] of entries) {
    const flag = c.ok === c.n ? "" : "  <-";
    console.log(`    ${v.padEnd(14)} ${String(c.ok).padStart(4)}/${String(c.n).padEnd(4)} ${pct(c.ok, c.n)}  ${bar(c.ok, c.n)}${flag}`);
  }
}

// ---------------------------------------------------------------- posture
console.log(`\n${"-".repeat(78)}\n  WHAT THE ENGINE DID WITH IT\n${"-".repeat(78)}`);
const disp: Record<string, Record<string, number>> = {};
for (const r of first) {
  const e = r.new_.scored.expectedDisposition, a = r.new_.scored.actualDisposition;
  disp[e] ??= {};
  disp[e][a] = (disp[e][a] ?? 0) + 1;
}
console.log(`  ${"oracle says".padEnd(16)} -> engine did`);
for (const [e, row] of Object.entries(disp)) {
  console.log(`  ${e.padEnd(16)} ${Object.entries(row).map(([k, v]) => `${k}:${v}`).join("  ")}`);
}

// ---------------------------------------------------------------- notes
console.log(`\n${"-".repeat(78)}\n  THE ENGINE'S OWN NOTES, by template — every note it emitted\n${"-".repeat(78)}`);
const noteKey = (n: string) =>
  n.replace(/#?\d+/g, "N").replace(/"[^"]*"/g, '"X"').replace(/SlotTeam\[N\]/g, "SlotTeam[i]").slice(0, 96);
const notes: Record<string, { n: number; failed: number; ex: string }> = {};
for (const r of rows) {
  for (const key of ["new_", "amend_"] as const) {
    const o = r[key]; if (!o) continue;
    for (const n of o.observed.notes ?? []) {
      const k = noteKey(n);
      notes[k] ??= { n: 0, failed: 0, ex: n };
      notes[k].n++;
      if (!o.scored.pass) notes[k].failed++;
    }
  }
}
for (const [k, v] of Object.entries(notes).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(5)}  fail:${String(v.failed).padStart(4)}  ${k}`);
}

// ---------------------------------------------------------------- violations
console.log(`\n${"-".repeat(78)}\n  INVARIANT VIOLATIONS — properties that must hold whatever the engine does\n${"-".repeat(78)}`);
const viol: Record<string, { n: number; ex: string }> = {};
for (const r of rows) {
  for (const key of ["new_", "amend_"] as const) {
    const o = r[key]; if (!o) continue;
    for (const v of o.scored.violations ?? []) {
      viol[v.rule] ??= { n: 0, ex: `${r.id}: ${v.detail}` };
      viol[v.rule].n++;
    }
  }
}
if (!Object.keys(viol).length) console.log("  none.");
for (const [k, v] of Object.entries(viol).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(5)}  ${k.padEnd(24)} e.g. ${v.ex.slice(0, 90)}`);
}

// ---------------------------------------------------------------- worked failures
console.log(`\n${"-".repeat(78)}\n  EVERY DISTINCT FAILURE SHAPE, with one worked example\n${"-".repeat(78)}`);
const shapes: Record<string, { n: number; ex: any; id: string; stage: string }> = {};
for (const r of rows) {
  for (const [stage, key] of [["enquiry", "new_"], ["amendment", "amend_"]] as const) {
    const o = r[key]; if (!o || o.scored.pass) continue;
    const k = `${stage}/${o.scored.firstFail}/${(o.scored.detail[0] ?? "").split(":")[0]}`;
    shapes[k] ??= { n: 0, ex: o, id: r.id, stage };
    shapes[k].n++;
  }
}
for (const [k, v] of Object.entries(shapes).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`\n  [${v.n}x] ${k}   e.g. ${v.id}`);
  for (const d of v.ex.scored.detail) console.log(`      ${d.slice(0, 150)}`);
  for (const n of (v.ex.observed.notes ?? []).slice(0, 4)) console.log(`      note: ${n.slice(0, 130)}`);
}
console.log("");
