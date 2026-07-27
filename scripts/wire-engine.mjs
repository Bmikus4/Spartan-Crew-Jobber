// Additively wire the LIVE bookings workflow into the Vercel engine: add one
// "POST to Engine" HTTP node and connect it off the order-branch end
// ("Combine all Email Data"). Non-destructive — existing nodes/connections are
// preserved; the new node is onError:continueRegularOutput so it can NEVER break
// the live workflow. Idempotent: re-running is a no-op if the node exists.
//
// Run:  node scripts/wire-engine.mjs
import { randomUUID } from "node:crypto";
import { loadEnv } from "./_env.mjs";

loadEnv();
const BASE = process.env.N8N_BASE;
const KEY = process.env.N8N_API_KEY;
const WF = "CPIRu7CpezvKjU8d";
const ENGINE_URL = "https://spartan-crew-jobber.vercel.app/api/n8n-inbound";
const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();
if (!SECRET) { console.error("N8N_WEBHOOK_SECRET not set in .env.local"); process.exit(2); }
const TAP = "Combine all Email Data"; // order-branch "end" (If.out0)
const NODE = "POST to Engine";

const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };

const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
console.log(`loaded: ${wf.name} | nodes ${wf.nodes.length} | active ${wf.active}`);

if (wf.nodes.some((n) => n.name === NODE)) {
  console.log(`"${NODE}" already present — nothing to do (idempotent).`);
  process.exit(0);
}
const tap = wf.nodes.find((n) => n.name === TAP);
if (!tap) {
  console.error(`tap node "${TAP}" not found — aborting (no change made).`);
  process.exit(1);
}

const node = {
  parameters: {
    method: "POST",
    url: ENGINE_URL,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "x-webhook-secret", value: SECRET }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json) }}",
    options: {},
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [(tap.position?.[0] ?? 2000) + 240, (tap.position?.[1] ?? 4256) + 160],
  id: randomUUID(),
  name: NODE,
  onError: "continueRegularOutput",
};

wf.nodes.push(node);
// additive edge: TAP -> POST to Engine (keep its existing targets)
const conn = wf.connections[TAP] ?? { main: [[]] };
conn.main = conn.main && conn.main.length ? conn.main : [[]];
conn.main[0] = [...(conn.main[0] ?? []), { node: NODE, type: "main", index: 0 }];
wf.connections[TAP] = conn;

// n8n public API PUT accepts ONLY name/nodes/connections/settings, and settings
// only these keys (UI-only extras like timeSaved*/binaryMode/availableInMCP are
// rejected — originals preserved in the backup).
const ALLOWED = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"];
const settings = {};
for (const k of ALLOWED) if (wf.settings?.[k] !== undefined) settings[k] = wf.settings[k];
const wasActive = wf.active;

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
const res = await fetch(`${BASE}/workflows/${WF}`, { method: "PUT", headers: h, body: JSON.stringify(body) });
const txt = await res.text();
if (!res.ok) {
  console.error(`PUT failed ${res.status}: ${txt.slice(0, 600)}`);
  console.error("No change committed (PUT is atomic). Live workflow untouched.");
  process.exit(1);
}
console.log(`PUT ${res.status} — node added.`);

// PUT can clear the active flag — re-activate if it did.
const chk = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
if (wasActive && !chk.active) {
  const act = await fetch(`${BASE}/workflows/${WF}/activate`, { method: "POST", headers: h });
  console.log(`re-activated: ${act.status}`);
}

// verify
const after = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
const ok = after.nodes.some((n) => n.name === NODE);
const edge = (after.connections[TAP]?.main?.[0] ?? []).some((e) => e.node === NODE);
console.log(`verify: node present=${ok}, edge present=${edge}, nodes=${after.nodes.length}, active=${after.active}`);
if (!ok || !edge) { console.error("VERIFY FAILED — restore from n8n/backups/bookings-CPIRu7CpezvKjU8d.backup.json"); process.exit(1); }
console.log("wired OK.");
