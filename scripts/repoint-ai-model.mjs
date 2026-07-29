// Repoint the workflow's AI classifier nodes at a model that actually exists.
//
// Why: the nodes were pinned to "anthropic/claude-3.5-haiku", which the endpoint
// no longer serves - it is absent from the 367 models the account can see, so
// every call returned "The resource you are requesting could not be found" and
// the order gate could never run. This is a like-for-like restore to the same
// tier (a cheap, fast model for a binary classification gate), not a redesign of
// the classifier.
//
//   node scripts/repoint-ai-model.mjs [--to <modelId>] [--dry]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const i = argv.indexOf("--to");
const TO = i !== -1 ? argv[i + 1] : "anthropic/claude-haiku-4.5";

const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };

// Refuse to set a model the endpoint does not actually serve - that is the exact
// mistake being fixed, so it must not be repeatable.
const orKey = (process.env.OPENROUTER_API_KEY || "").trim();
if (orKey) {
  const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${orKey}` } });
  const ids = ((await r.json()).data || []).map((m) => m.id);
  if (ids.length && !ids.includes(TO)) {
    console.error(`"${TO}" is not among the ${ids.length} models this account can reach. Aborting.`);
    process.exit(1);
  }
  console.log(`verified "${TO}" is available (${ids.length} models visible)`);
}

const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
if (!Array.isArray(wf.nodes)) { console.error("could not load workflow"); process.exit(1); }
console.log(`workflow: ${wf.name}  nodes=${wf.nodes.length} active=${wf.active}\n`);

if (!DRY) {
  const dir = join(ROOT_DIR, "n8n", "backups");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `bookings-${WF}.${String(wf.updatedAt).replace(/[:.]/g, "-")}.json`);
  writeFileSync(p, JSON.stringify(wf, null, 2));
  console.log(`backup: ${p}\n`);
}

const changed = [];
for (const n of wf.nodes) {
  if (!/langchain\.openAi/.test(n.type)) continue;
  const cur = n.parameters?.modelId?.value;
  if (cur === TO) { console.log(`  ${n.name}: already on ${TO}`); continue; }
  console.log(`  ${n.name}: ${cur}  ->  ${TO}`);
  n.parameters.modelId = { __rl: true, value: TO, mode: "list", cachedResultName: TO.toUpperCase() };
  changed.push(n.name);
}
if (!changed.length) { console.log("\nnothing to change."); process.exit(0); }
if (DRY) { console.log(`\n(dry run) would repoint ${changed.length} node(s), nothing sent.`); process.exit(0); }

const ALLOWED = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"];
const settings = {};
for (const k of ALLOWED) if (wf.settings?.[k] !== undefined) settings[k] = wf.settings[k];
const wasActive = wf.active;

const res = await fetch(`${BASE}/workflows/${WF}`, {
  method: "PUT", headers: h,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
if (!res.ok) { console.error(`PUT failed ${res.status}: ${(await res.text()).slice(0, 500)}`); process.exit(1); }
console.log(`\nPUT ${res.status} — repointed ${changed.length} node(s).`);

if (wasActive) {
  const chk = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
  if (!chk.active) console.log(`re-activated: ${(await fetch(`${BASE}/workflows/${WF}/activate`, { method: "POST", headers: h })).status}`);
}

const after = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
console.log("\nverify:");
for (const n of after.nodes.filter((x) => /langchain\.openAi/.test(x.type)))
  console.log(`  ${n.name.padEnd(30)} model=${n.parameters?.modelId?.value}`);
console.log(`  active=${after.active}`);
