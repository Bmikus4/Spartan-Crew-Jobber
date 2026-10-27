// The Gmail labels after each minute sync (ADDENDUM R3, F32). No heartbeat for this automation
// runs in n8n, ever (the owner, 26 Oct; DECISIONS O1): the minute sync is a Vercel cron on
// /api/bot/sync (vercel.json), and after each run it calls this workflow's webhook. The workflow
// keeps only what the app cannot do yet, applying the labels with the mailbox's Gmail credential,
// until the Gmail grant moves that into the app too (R14).
//
// It replaces "Spartan Sync (every minute)", whose schedule ran the sync and then these steps.
// RUN IT ONLY AT THE SWITCH-OVER, after CRON_SECRET is set in Vercel and three cron firings are seen:
// the label steps ask the app with CRON_SECRET, which the app accepts only once it is set there,
// and the old schedule is retired by this run.
//
// The label steps ride in this one workflow (scripts/_labelNodes.mjs says why: n8n Cloud counts
// executions, and running out stops the Gmail intake too).
//
//   node scripts/install-sync-workflow.mjs [--activate] [--status] [--print]
import { loadEnv, requireEnv } from "./_env.mjs";
import { labelChain } from "./_labelNodes.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

loadEnv();
const argv = process.argv.slice(2);
const ACTIVATE = argv.includes("--activate");
const STATUS = argv.includes("--status");
const PRINT = argv.includes("--print");

const WF_NAME = "Spartan Labels (after each sync)";
/** The schedule form this replaces: retired by the first run. */
const OLD_NAMES = ["Spartan Sync (every minute)"];
const SECRET = (process.env.CRON_SECRET || "").trim();
const APP = (process.env.SPARTAN_APP_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
/** app/lib/routes/sync.ts labelsWebhook() posts here; the two must agree. */
const HOOK_PATH = "spartan-labels";

const nodes = [
  { id: "hook", name: "After the sync", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: HOOK_PATH,
    parameters: { httpMethod: "POST", path: HOOK_PATH, responseMode: "onReceived", options: {} } },
];
const labels = labelChain({ app: APP, secret: SECRET, x: 240, y: 0 });
nodes.push(...labels.nodes);
const connections = {
  "After the sync": { main: [[{ node: labels.entry, type: "main", index: 0 }]] },
  ...labels.connections,
};
const body = { name: WF_NAME, nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: argv.includes("--save-runs") ? "all" : "none" } };

if (PRINT) { console.log((SECRET ? JSON.stringify(body, null, 2).split(SECRET).join("<secret>") : JSON.stringify(body, null, 2))); process.exit(0); }
if (!SECRET) { console.error("MISSING ENV: CRON_SECRET -- the label steps would be refused. Set it in Vercel and .env.local first."); process.exit(2); }

const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const KEY = requireEnv("N8N_API_KEY");
const h = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };
async function api(path, init = {}) {
  const r = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const all = await api("/workflows?limit=250");
const existing = (all.data || []).filter((w) => w.name === WF_NAME || OLD_NAMES.includes(w.name));
if (STATUS) { console.log(existing.length ? existing.map((w) => `${w.name}: ${w.id}, active=${w.active}`).join("\n") : `${WF_NAME}: not installed`); process.exit(0); }
// ALWAYS A NEW WORKFLOW, the old ones retired after it. n8n refuses an UPDATE that adds nodes
// using a credential the API key's user does not own ("You don't have access to the credentials
// in the 'List labels' node", 10-16), and accepts the same nodes in a CREATE. Each old one is
// backed up first and switched off before the new one starts, so labels are never applied twice.
let wasActive = false;
for (const w of existing) {
  const old = await api(`/workflows/${w.id}`);
  mkdirSync("n8n/backups", { recursive: true });
  writeFileSync(`n8n/backups/sync-${w.id}-${Date.now()}.json`, JSON.stringify(old, null, 2));
  wasActive = wasActive || !!old.active;
  if (old.active) await api(`/workflows/${w.id}/deactivate`, { method: "POST" });
}
const wf = await api("/workflows", { method: "POST", body: JSON.stringify(body) });
console.log(`created ${wf.id}`);
if (ACTIVATE || wasActive) { await api(`/workflows/${wf.id}/activate`, { method: "POST" }); console.log(`activated: ${(await api(`/workflows/${wf.id}`)).active}`); }
for (const w of existing) { await api(`/workflows/${w.id}`, { method: "DELETE" }); console.log(`retired ${w.id}`); }
console.log(`labels run when ${BASE}/webhook/${HOOK_PATH} is called (by /api/bot/sync's cron run)`);
