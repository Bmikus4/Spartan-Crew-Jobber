// Repoint every Gmail node in the live workflow at a different, already-existing
// Gmail credential.
//
// Why this is needed: reconnecting a broken OAuth credential and creating a NEW
// one look the same from the n8n UI, but only the first fixes a workflow. A new
// credential leaves every node still bound to the old id, so the workflow keeps
// failing with "needs to be reconnected" even though a working credential now
// exists on the account.
//
// This does NOT create, rotate or modify any credential - it only changes which
// existing one the workflow's nodes reference.
//
//   node scripts/repoint-gmail-cred.mjs --to <credentialId> [--dry]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const TO = argv[argv.indexOf("--to") + 1];
if (!TO || TO.startsWith("--")) {
  console.error("usage: node scripts/repoint-gmail-cred.mjs --to <credentialId> [--dry]");
  process.exit(2);
}

const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };

// Confirm the target credential exists and is a Gmail one before touching anything.
const creds = await (await fetch(`${BASE}/credentials`, { headers: h })).json();
const target = (creds.data || []).find((c) => c.id === TO);
if (!target) { console.error(`credential ${TO} not found on this account.`); process.exit(1); }
if (!/gmail/i.test(target.type)) { console.error(`credential ${TO} is ${target.type}, not a Gmail credential.`); process.exit(1); }
console.log(`target credential: ${target.id}  "${target.name}"  (${target.type}, updated ${target.updatedAt})`);

const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
if (!Array.isArray(wf.nodes)) { console.error("could not load workflow"); process.exit(1); }
console.log(`workflow: ${wf.name}  nodes=${wf.nodes.length} active=${wf.active}\n`);

const backupDir = join(ROOT_DIR, "n8n", "backups");
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `bookings-${WF}.${String(wf.updatedAt).replace(/[:.]/g, "-")}.json`);
if (!DRY) { writeFileSync(backupPath, JSON.stringify(wf, null, 2)); console.log(`backup: ${backupPath}\n`); }

const changed = [];
for (const n of wf.nodes) {
  const c = n.credentials?.gmailOAuth2;
  if (!c) continue;
  if (c.id === TO) { console.log(`  ${n.name}: already on the target`); continue; }
  console.log(`  ${n.name}: ${c.id} "${c.name}"  ->  ${target.id} "${target.name}"`);
  n.credentials.gmailOAuth2 = { id: target.id, name: target.name };
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
if (!res.ok) {
  console.error(`\nPUT failed ${res.status}: ${(await res.text()).slice(0, 600)}`);
  console.error(`No change committed. Backup: ${backupPath}`);
  process.exit(1);
}
console.log(`\nPUT ${res.status} — repointed ${changed.length} node(s).`);

if (wasActive) {
  const chk = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
  if (!chk.active) console.log(`re-activated: ${(await fetch(`${BASE}/workflows/${WF}/activate`, { method: "POST", headers: h })).status}`);
}

const after = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
const stale = after.nodes.filter((n) => n.credentials?.gmailOAuth2 && n.credentials.gmailOAuth2.id !== TO);
console.log("\nverify:");
console.log(`  gmail nodes on the target: ${after.nodes.filter((n) => n.credentials?.gmailOAuth2?.id === TO).length}`);
console.log(`  still on an old credential: ${stale.length}${stale.length ? " (" + stale.map((n) => n.name).join(", ") + ")" : ""}`);
console.log(`  active=${after.active}`);
process.exit(stale.length ? 1 : 0);
