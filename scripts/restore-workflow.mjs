// Restore the live workflow from one of the timestamped backups in n8n/backups/.
// The escape hatch for scripts/install-engine-wiring.mjs. Atomic PUT, then
// re-activates if the workflow was active.
//
//   node scripts/restore-workflow.mjs                     # list backups
//   node scripts/restore-workflow.mjs <path-to-backup>    # restore it
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };
const dir = join(ROOT_DIR, "n8n", "backups");

const arg = process.argv[2];
if (!arg) {
  console.log(`backups in ${dir}:`);
  for (const f of readdirSync(dir)) console.log("  " + join(dir, f));
  console.log("\npass one of these paths to restore it.");
  process.exit(0);
}

const saved = JSON.parse(readFileSync(arg, "utf8"));
if (!Array.isArray(saved.nodes)) { console.error("that file has no nodes[] - not a workflow backup."); process.exit(1); }
console.log(`restoring "${saved.name}" (${saved.nodes.length} nodes) from ${arg}`);

const live = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
const wasActive = live.active;

const ALLOWED = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"];
const settings = {};
for (const k of ALLOWED) if (saved.settings?.[k] !== undefined) settings[k] = saved.settings[k];

const res = await fetch(`${BASE}/workflows/${WF}`, {
  method: "PUT", headers: h,
  body: JSON.stringify({ name: saved.name, nodes: saved.nodes, connections: saved.connections, settings }),
});
if (!res.ok) { console.error(`PUT failed ${res.status}: ${(await res.text()).slice(0, 600)}`); process.exit(1); }
console.log(`PUT ${res.status}`);

if (wasActive) {
  const chk = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
  if (!chk.active) console.log(`re-activated: ${(await fetch(`${BASE}/workflows/${WF}/activate`, { method: "POST", headers: h })).status}`);
}
const after = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
console.log(`restored: nodes=${after.nodes.length} active=${after.active}`);
