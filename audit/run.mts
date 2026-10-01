// ============================================================================
// THE RUNNER. One command, one scorecard, and the raw rows beside it.
// ----------------------------------------------------------------------------
//   npx tsx audit/run.mts                 every scenario, 3 repetitions
//   npx tsx audit/run.mts --reps=10       more repetitions, for the stability figure
//   npx tsx audit/run.mts --only=S3,R5    a subset while diagnosing
//   npx tsx audit/run.mts --verbose       print every check, not only the failures
//
// A SCENARIO PASSES ONLY IF EVERY CHECK PASSES, its own and the global invariants.
// That is the whole definition of the headline number, and it is why the headline
// number is lower than any per-check rate: a run that books the job correctly and
// leaves a stale label is not a pass, because in the mailbox it is not one.
//
// Repetitions exist to catch what a single green run hides. Everything here is
// deterministic by construction — a fixed clock, a scripted model, no network — so
// a scenario that moves between repetitions is itself a finding and is reported as
// one rather than being retried until it agrees.
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { baseTenant, invariants, SCENARIOS, CLASS_LABEL, type Check, type ClassName, type Ctx } from "./scenarios.mts";
import { buildRig, deliver, type AuditRig } from "./harness.mts";
import type { FakeTenant } from "./tenant.mts";
import type { ThreadMessage } from "../app/lib/engine/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);

/**
 * WHICH VERSION OF THE ENGINE THIS RUN MEASURED.
 *
 * Another session is editing this repo while the audit runs, so "the commit" is not
 * enough — the working tree can differ from HEAD in exactly the files that decide the
 * numbers. So the sha is recorded AND the engine source is hashed directly. Two runs
 * carrying different `engine` hashes did not measure the same system, whatever their
 * commit says, and the report must not put their numbers in one table.
 */
function auditedVersion(): { head: string; dirty: boolean; engine: string; files: number } {
  const root = join(HERE, "..");
  const seen: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".ts")) seen.push(p);
    }
  };
  for (const d of ["app/lib/engine", "app/lib/mail", "app/lib/followup"]) walk(join(root, d));
  seen.push(join(root, "app/lib/deps.ts"), join(root, "app/lib/stateDb.ts"));
  seen.sort();
  const h = createHash("sha256");
  for (const p of seen) h.update(readFileSync(p));
  let head = "unknown";
  let dirty = false;
  try {
    head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    dirty = execSync("git status --porcelain", { cwd: root }).toString().trim().length > 0;
  } catch {
    /* a version we cannot read is reported as unknown, never as clean */
  }
  return { head, dirty, engine: h.digest("hex").slice(0, 16), files: seen.length };
}

const VERSION = auditedVersion();

const REPS = Math.max(1, Number(arg("reps") ?? 3));
const ONLY = (arg("only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const VERBOSE = has("verbose");
/**
 * Reproduce the production adapter's dropped `cancellation` field. The audited version
 * shipped with it dropped, so THIS is the faithful posture for that version; the scripted
 * model returning it was more generous than production and scored a hold production
 * could not perform.
 */
const STRIP_CANCELLATION = has("strip-cancellation");

interface RunResult {
  id: string;
  cls: ClassName;
  what: string;
  rep: number;
  pass: boolean;
  checks: Check[];
  error?: string;
  /** A one-line fingerprint of the outcome, for the stability comparison. */
  fingerprint: string;
}

async function runOnce(s: (typeof SCENARIOS)[number], rep: number): Promise<RunResult> {
  const { tenant } = baseTenant();
  let rig: AuditRig = buildRig(tenant, { settings: { replies_enabled: true }, stripCancellation: STRIP_CANCELLATION });
  const checks: Check[] = [];
  const ctx: Ctx = {
    tenant,
    get rig() {
      return rig;
    },
    checks,
    check(label, ok, detail) {
      checks.push({ label, ok, detail });
    },
    say(thread_id: string, m: ThreadMessage[]) {
      return deliver(rig, thread_id, m);
    },
    rebuild(opts) {
      rig = buildRig(tenant, { settings: { replies_enabled: true }, stripCancellation: STRIP_CANCELLATION, ...opts });
    },
  } as Ctx;

  let error: string | undefined;
  try {
    await s.run(ctx);
  } catch (err: any) {
    // A throw is a failure of the scenario, never of the run. It is recorded with its
    // message so a crash and a wrong answer are told apart in the report.
    error = String(err?.stack ?? err?.message ?? err).split("\n").slice(0, 3).join(" | ");
    checks.push({ label: "the scenario ran to completion", ok: false, detail: error });
  }

  try {
    checks.push(...(await invariants(tenant, rig)));
  } catch (err: any) {
    checks.push({ label: "invariants could be evaluated", ok: false, detail: String(err?.message ?? err), invariant: true });
  }

  return {
    id: s.id,
    cls: s.cls,
    what: s.what,
    rep,
    pass: checks.every((x) => x.ok),
    checks,
    error,
    fingerprint: checks.map((x) => (x.ok ? "1" : "0")).join(""),
  };
}

const chosen = ONLY.length ? SCENARIOS.filter((s) => ONLY.includes(s.id)) : SCENARIOS;
const results: RunResult[] = [];

for (const s of chosen) {
  for (let rep = 1; rep <= REPS; rep++) results.push(await runOnce(s, rep));
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`);
const bar = "=".repeat(78);

/** First repetition of each scenario, which is what the per-scenario table reports. */
const firstRep = results.filter((r) => r.rep === 1);

console.log(bar);
console.log("SPARTAN CREW ENQUIRY ENGINE — END-TO-END SCENARIO AUDIT");
console.log(bar);
console.log(`engine source ${VERSION.engine} over ${VERSION.files} files | commit ${VERSION.head.slice(0, 7)}${VERSION.dirty ? " (working tree DIRTY)" : ""}`);
console.log(`${chosen.length} scenarios x ${REPS} repetitions = ${results.length} executions${STRIP_CANCELLATION ? "  |  cancellation STRIPPED at the reasoner, as the audited adapter did" : ""}`);
console.log(`${results.reduce((n, r) => n + r.checks.length, 0)} checks, of which ${results.reduce((n, r) => n + r.checks.filter((c) => c.invariant).length, 0)} are invariant checks`);
console.log("");

// --- scenario table ---
console.log("PER SCENARIO");
console.log("-".repeat(78));
for (const r of firstRep) {
  const reps = results.filter((x) => x.id === r.id);
  const passes = reps.filter((x) => x.pass).length;
  const stable = new Set(reps.map((x) => x.fingerprint)).size === 1;
  const failed = r.checks.filter((c) => !c.ok);
  const mark = passes === REPS ? "PASS" : passes === 0 ? "FAIL" : `${passes}/${REPS}`;
  console.log(`${mark.padEnd(6)} ${r.id.padEnd(4)} ${stable ? " " : "~"} ${r.what}`);
  for (const c of failed) console.log(`            - ${c.invariant ? "[invariant] " : ""}${c.label}${c.detail ? `  (${c.detail})` : ""}`);
  if (VERBOSE) for (const c of r.checks.filter((x) => x.ok)) console.log(`            ok ${c.label}`);
}

// --- class rollup ---
console.log("");
console.log("PER SCENARIO CLASS  (fully correct end-to-end runs / runs executed)");
console.log("-".repeat(78));
const classes = [...new Set(chosen.map((s) => s.cls))];
const classRows: Array<{ cls: ClassName; label: string; pass: number; total: number }> = [];
for (const cls of classes) {
  const rows = results.filter((r) => r.cls === cls);
  const p = rows.filter((r) => r.pass).length;
  classRows.push({ cls, label: CLASS_LABEL[cls], pass: p, total: rows.length });
  console.log(`${CLASS_LABEL[cls].padEnd(30)} ${String(p).padStart(3)}/${String(rows.length).padEnd(4)} ${pct(p, rows.length)}`);
}

// --- headline ---
const passed = results.filter((r) => r.pass).length;
console.log("");
console.log(bar);
console.log(`END-TO-END SUCCESS: ${pct(passed, results.length)}  (${passed}/${results.length} fully correct runs)`);
const checksTotal = results.reduce((n, r) => n + r.checks.length, 0);
const checksOk = results.reduce((n, r) => n + r.checks.filter((c) => c.ok).length, 0);
console.log(`CHECK-LEVEL:        ${pct(checksOk, checksTotal)}  (${checksOk}/${checksTotal} individual expectations)`);
const invTotal = results.reduce((n, r) => n + r.checks.filter((c) => c.invariant).length, 0);
const invOk = results.reduce((n, r) => n + r.checks.filter((c) => c.invariant && c.ok).length, 0);
console.log(`INVARIANTS HELD:    ${pct(invOk, invTotal)}  (${invOk}/${invTotal})`);
const unstable = [...new Set(results.map((r) => r.id))].filter(
  (id) => new Set(results.filter((r) => r.id === id).map((r) => r.fingerprint)).size > 1
);
console.log(`REPEATABILITY:      ${pct(chosen.length - unstable.length, chosen.length)}  (${chosen.length - unstable.length}/${chosen.length} scenarios identical across ${REPS} runs${unstable.length ? `; unstable: ${unstable.join(", ")}` : ""})`);
console.log(bar);

// --- failure clustering by check label ---
const byLabel = new Map<string, { n: number; ids: Set<string>; detail: string }>();
for (const r of results) {
  for (const c of r.checks) {
    if (c.ok) continue;
    const e = byLabel.get(c.label) ?? { n: 0, ids: new Set<string>(), detail: c.detail ?? "" };
    e.n++;
    e.ids.add(r.id);
    byLabel.set(c.label, e);
  }
}
if (byLabel.size) {
  console.log("");
  console.log("FAILING EXPECTATIONS, most scenarios first");
  console.log("-".repeat(78));
  for (const [label, e] of [...byLabel].sort((a, b) => b[1].ids.size - a[1].ids.size)) {
    console.log(`${String(e.ids.size).padStart(2)} scenario(s)  ${label}`);
    console.log(`               ${[...e.ids].join(", ")}`);
  }
}

mkdirSync(join(HERE, "out"), { recursive: true });
const raw = {
  generated: new Date().toISOString(),
  version: VERSION,
  reps: REPS,
  strip_cancellation: STRIP_CANCELLATION,
  scenarios: chosen.length,
  executions: results.length,
  headline: { passed, total: results.length },
  classes: classRows,
  unstable,
  results: results.map((r) => ({
    id: r.id,
    cls: r.cls,
    what: r.what,
    rep: r.rep,
    pass: r.pass,
    error: r.error ?? null,
    fingerprint: r.fingerprint,
    failed: r.checks.filter((c) => !c.ok).map((c) => ({ label: c.label, detail: c.detail ?? null, invariant: !!c.invariant })),
    checks: r.checks.length,
  })),
};
const after = auditedVersion();
(raw as { version_after?: unknown }).version_after = after;
if (after.engine !== VERSION.engine) {
  console.log("");
  console.log("!! THE ENGINE CHANGED DURING THIS RUN — these numbers span two versions and must not be quoted as one.");
  console.log(`   ${VERSION.engine} -> ${after.engine}`);
}
writeFileSync(join(HERE, "out", "results.json"), JSON.stringify(raw, null, 2));
console.log(`\nraw rows: audit/out/results.json`);
process.exit(0);
