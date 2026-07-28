// Read-only inspection of the LIVE bookings workflow: node inventory, the order
// branch, Airtable usage, credential bindings, and recent executions. Makes no
// changes. Run: node scripts/inspect-workflow.mjs
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.argv[2] || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };

const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
if (!wf.nodes) { console.error("failed:", JSON.stringify(wf).slice(0, 400)); process.exit(1); }
console.log(`WORKFLOW: ${wf.name}  active=${wf.active}  nodes=${wf.nodes.length}  updated=${wf.updatedAt}`);
console.log("\n--- NODES ---");
for (const n of wf.nodes) {
  const creds = n.credentials ? Object.entries(n.credentials).map(([t, c]) => `${t}:${c.name}`).join(",") : "";
  console.log(`  ${n.name.padEnd(34)} ${n.type.replace("n8n-nodes-base.", "").padEnd(22)} ${creds}`);
}
console.log("\n--- CONNECTIONS ---");
for (const [from, c] of Object.entries(wf.connections)) {
  (c.main || []).forEach((outs, i) => {
    for (const e of outs || []) console.log(`  ${from} [${i}] -> ${e.node}`);
  });
}
console.log("\n--- AIRTABLE NODES (detail) ---");
for (const n of wf.nodes.filter((x) => /airtable/i.test(x.type))) {
  console.log(`  ${n.name}: ${JSON.stringify(n.parameters, null, 2).slice(0, 1200)}`);
}
const ex = await (await fetch(`${BASE}/executions?workflowId=${WF}&limit=10`, { headers: h })).json();
console.log("\n--- RECENT EXECUTIONS ---");
for (const e of ex.data || []) console.log(`  ${e.id} ${e.status} started=${e.startedAt} stopped=${e.stoppedAt}`);
