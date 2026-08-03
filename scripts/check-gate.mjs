// ============================================================================
// Production invariant: the n8n AI gate must NOT drop mail.
// ----------------------------------------------------------------------------
// The workflow looks like it filters. "Determine if Order" produces is_job, and
// an If node sits between it and the engine. It does not filter: the If's
// condition is EMPTY, so it evaluates "" equals "" -> true, and every item takes
// output 0. Everything reaches the engine.
//
// That accident is the only reason bookings are not being lost. Graded against
// the engine's own classification over the first 41 real threads, the gate called
// 7 of them not-a-job that the engine judged to be real jobs - 17%, including
// thread 19fb237ffe62ff48, which produced a staged patch of real order 13632.
// Wire that If up "properly" and one booking in six starts disappearing silently.
//
// So the engine is the authority on what is a job, and the gate's verdict is
// carried as context only. This script asserts that, and can make the accidental
// pass-through explicit so nobody mistakes it for an unfinished filter.
//
//   node scripts/check-gate.mjs          # assert only, exits 1 if mail can be dropped
//   node scripts/check-gate.mjs --fix    # make the pass-through explicit
//
// Production safety: GETs the whole workflow to a timestamped backup before any
// write, PUTs the full object, and never sends `active`.
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const FIX = process.argv.includes("--fix");
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };
const GATE = "If";
const TAP = "Combine all Email Data";

const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
if (!Array.isArray(wf.nodes)) { console.error("could not load workflow"); process.exit(1); }

const node = wf.nodes.find((n) => n.name === GATE);
if (!node) { console.error(`"${GATE}" not found — the delivery path has changed; re-read it before trusting this check.`); process.exit(1); }

const conds = node.parameters?.conditions?.conditions ?? [];
const emptyPassThrough = conds.every(
  (c) => String(c.leftValue ?? "") === "" && String(c.rightValue ?? "") === ""
);
const explicitTrue = conds.length === 1 && String(conds[0].leftValue) === "={{ true }}" && String(conds[0].rightValue) === "={{ true }}";
const passesEverything = emptyPassThrough || explicitTrue;

// Where does each branch go? Output 0 must reach the tap; output 1 must not be
// the only path for anything we care about.
const edges = (wf.connections[GATE]?.main ?? []).map((outs) => (outs ?? []).map((e) => e.node));
console.log(`gate "${GATE}": ${conds.length} condition(s)`);
console.log(`  passes everything: ${passesEverything}  (${explicitTrue ? "explicit true" : emptyPassThrough ? "EMPTY condition — accidental" : "CONFIGURED — it filters"})`);
console.log(`  output 0 -> ${edges[0]?.join(", ") || "(nothing)"}`);
console.log(`  output 1 -> ${edges[1]?.join(", ") || "(nothing)"}`);

const reachesEngine = (edges[0] ?? []).includes(TAP);
if (!reachesEngine) console.log(`  WARNING: output 0 does not reach "${TAP}"`);

if (!passesEverything) {
  console.error("\nFAIL: the gate is configured to filter.");
  console.error("On the graded corpus that drops ~17% of real jobs. The engine is the");
  console.error("authority on what is a job — the gate's verdict is context only.");
  console.error("Either revert the condition, or route output 1 to the tap as well.");
  process.exit(1);
}

if (!FIX) {
  if (emptyPassThrough) {
    console.log("\nOK: no mail is dropped — but the pass-through is an EMPTY condition,");
    console.log("which reads as an unfinished filter. Run with --fix to make it explicit.");
  } else {
    console.log("\nOK: explicit pass-through. No mail is dropped.");
  }
  process.exit(0);
}

if (explicitTrue) { console.log("\nalready explicit — nothing to do."); process.exit(0); }

const dir = join(ROOT_DIR, "n8n", "backups");
mkdirSync(dir, { recursive: true });
const backup = join(dir, `bookings-${WF}.${String(wf.updatedAt).replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, JSON.stringify(wf, null, 2));
console.log(`\nbackup: ${backup}`);

node.parameters.conditions.conditions = [
  {
    id: conds[0]?.id ?? "gate-pass-through",
    leftValue: "={{ true }}",
    rightValue: "={{ true }}",
    operator: { type: "boolean", operation: "equals" },
  },
];
node.parameters.conditions.options = { ...(node.parameters.conditions.options ?? {}), typeValidation: "loose" };

const ALLOWED = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"];
const settings = {};
for (const k of ALLOWED) if (wf.settings?.[k] !== undefined) settings[k] = wf.settings[k];

// FULL replace, and never send `active`.
const res = await fetch(`${BASE}/workflows/${WF}`, {
  method: "PUT", headers: h,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
if (!res.ok) { console.error(`PUT failed ${res.status}: ${(await res.text()).slice(0, 500)}`); console.error(`No change committed. Backup: ${backup}`); process.exit(1); }
console.log(`PUT ${res.status}`);

const after = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
const c = after.nodes.find((n) => n.name === GATE)?.parameters?.conditions?.conditions ?? [];
console.log(`verify: condition now ${JSON.stringify(c[0]?.leftValue)} ${c[0]?.operator?.operation} ${JSON.stringify(c[0]?.rightValue)}`);
console.log(`        active=${after.active} (untouched)`);
