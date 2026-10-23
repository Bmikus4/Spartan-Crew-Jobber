// ============================================================================
// Put n8n/nodes/build-engine-payload.js live as the "Build Engine Payload" node of the
// bookings intake workflow, and change nothing else.
// ----------------------------------------------------------------------------
// install-engine-wiring.mjs also refreshes this node, but it re-imposes its whole 2026-09
// wiring as well: "If" and "Build Engine Payload" through a "Combine all Email Data" node the
// live workflow no longer has (checked 22 Oct). Run today it would cut the intake branch. This
// script touches one field, the node's code, and proves the rest came back as it was.
//
// Safe by construction: a timestamped backup first (n8n/backups, gitignored: the workflow
// holds the webhook secret), one PUT, the active flag put back as it was, then every other
// node's type, parameters and credentials, every connection and the active flag compared
// with the backup. Any difference is reported and the exit code is 1.
//
//   node scripts/install-payload-builder.mjs --dry   # say what would change, send nothing
//   node scripts/install-payload-builder.mjs         # apply
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const DRY = process.argv.includes("--dry");
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const NODE = "Build Engine Payload";
const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };

const get = async () => (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
const wf = await get();
if (!Array.isArray(wf.nodes)) { console.error("could not load the workflow:", JSON.stringify(wf).slice(0, 300)); process.exit(1); }
const node = wf.nodes.find((n) => n.name === NODE);
if (!node) { console.error(`no "${NODE}" node in ${wf.name}; nothing changed`); process.exit(1); }
const src = readFileSync(join(ROOT_DIR, "n8n", "nodes", "build-engine-payload.js"), "utf8");
console.log(`${wf.name}: ${wf.nodes.length} nodes, active=${wf.active}, updated ${wf.updatedAt}`);
if (node.parameters?.jsCode === src) { console.log(`"${NODE}" already runs the repo's code; nothing to do`); process.exit(0); }
if (DRY) { console.log(`(dry) would replace "${NODE}" code: ${String(node.parameters?.jsCode ?? "").length} -> ${src.length} chars; nothing sent`); process.exit(0); }

mkdirSync(join(ROOT_DIR, "n8n", "backups"), { recursive: true });
const backup = join(ROOT_DIR, "n8n", "backups", `bookings-${WF}.${String(wf.updatedAt || "unknown").replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, JSON.stringify(wf, null, 2));
console.log(`backup: ${backup}`);

const nodes = wf.nodes.map((n) => (n.name === NODE ? { ...n, parameters: { ...n.parameters, jsCode: src } } : n));
const ALLOWED = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"];
const settings = Object.fromEntries(ALLOWED.filter((k) => wf.settings?.[k] !== undefined).map((k) => [k, wf.settings[k]]));
const res = await fetch(`${BASE}/workflows/${WF}`, { method: "PUT", headers: h, body: JSON.stringify({ name: wf.name, nodes, connections: wf.connections, settings }) });
if (!res.ok) { console.error(`PUT ${res.status}: ${(await res.text()).slice(0, 600)}\nnothing changed (the PUT is atomic); backup ${backup}`); process.exit(1); }
console.log(`PUT ${res.status}`);
if (wf.active && !(await get()).active) console.log(`re-activated: ${(await fetch(`${BASE}/workflows/${WF}/activate`, { method: "POST", headers: h })).status}`);

// Everything but the one field must be as it was.
const after = await get();
const shape = (n) => JSON.stringify({ type: n.type, typeVersion: n.typeVersion, parameters: n.parameters, credentials: n.credentials ?? null, disabled: !!n.disabled });
const was = new Map(wf.nodes.map((n) => [n.name, n]));
const problems = [];
if (after.nodes.length !== wf.nodes.length) problems.push(`node count ${wf.nodes.length} -> ${after.nodes.length}`);
for (const n of after.nodes) {
  const old = was.get(n.name);
  if (!old) { problems.push(`new node "${n.name}"`); continue; }
  if (n.name === NODE) { if (n.parameters?.jsCode !== src) problems.push(`"${NODE}" code is not the repo's`); continue; }
  if (shape(n) !== shape(old)) problems.push(`"${n.name}" changed`);
}
if (JSON.stringify(after.connections) !== JSON.stringify(wf.connections)) problems.push("connections changed");
if (!!after.active !== !!wf.active) problems.push(`active ${wf.active} -> ${after.active}`);
console.log(problems.length ? `PROBLEMS:\n  ${problems.join("\n  ")}\nbackup ${backup}` : `verified: "${NODE}" runs the repo's code; ${after.nodes.length - 1} other nodes, every connection and active=${after.active} unchanged`);
process.exit(problems.length ? 1 : 0);
