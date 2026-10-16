// The Gmail labels' DRY RUN. The live label steps run inside "Spartan Sync (every minute)"
// (install-sync-workflow.mjs; scripts/_labelNodes.mjs says why they are not a workflow of their
// own). This installs a webhook twin of their first steps, runs it ONCE against the real bookings
// mailbox, prints what the labels would do, and switches it off. It changes nothing in Gmail.
//
//   node scripts/install-label-workflow.mjs --dry
//   node scripts/install-label-workflow.mjs --print
import { loadEnv, requireEnv } from "./_env.mjs";
import { gmailReq, headNodes } from "./_labelNodes.mjs";

loadEnv();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const PRINT = argv.includes("--print");
if (!DRY && !PRINT) { console.error("labels are installed by install-sync-workflow.mjs; this script only dry-runs them (--dry)"); process.exit(2); }

const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();
const APP = (process.env.SPARTAN_APP_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const G = "https://gmail.googleapis.com/gmail/v1/users/me";
const WF_NAME = "Spartan Labels (dry run)";

const DRY_CODE = `
const plan = $('Plan labels').first().json;
const found = $('Tag label').all().map((x) => ({ label: x.json.label, threads: x.json.resultSizeEstimate ?? (x.json.threads || []).length }));
return [{ json: { dry: true, renames: plan.renames, creates: plan.creates.map((c) => c.name), threads: (plan.app.threads || []).length,
  by_label: (plan.app.threads || []).reduce((a, t) => { const k = t.add.join(' + ') || 'none'; a[k] = (a[k] || 0) + 1; return a; }, {}),
  sample: (plan.app.threads || []).slice(0, 12), strip: found,
  gmail_labels: ($('List labels').first().json.labels || []).filter((l) => l.type === 'user').map((l) => l.name).sort() } }];`;

const hook = { id: "hook", name: "Dry run", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [-220, 0], webhookId: "spartan-labels-dry",
  parameters: { httpMethod: "POST", path: "spartan-labels-dry", responseMode: "lastNode", options: {} } };
const nodes = [
  hook,
  ...headNodes({ app: APP, secret: SECRET, mode: "dry", x: 0, y: 0 }),
  { id: "split", name: "Each stripped label", type: "n8n-nodes-base.code", typeVersion: 2, position: [660, 0],
    parameters: { jsCode: "const p = $('Plan labels').first().json; return p.strip.length ? p.strip.map((s) => ({ json: s })) : [{ json: { name: '', id: '' } }];" } },
  gmailReq("find", "Find stripped threads", 880, 0, "GET", `=${G}/threads?maxResults=500&labelIds={{ $json.id }}`),
  { id: "tag", name: "Tag label", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [1100, 0],
    parameters: { mode: "raw", jsonOutput: "={{ JSON.stringify({ ...$json, label: $('Each stripped label').item.json.name }) }}", options: {} } },
  { id: "sum", name: "Summary", type: "n8n-nodes-base.code", typeVersion: 2, position: [1320, 0], parameters: { jsCode: DRY_CODE } },
];
const to = (node) => ({ node, type: "main", index: 0 });
const connections = {
  "Dry run": { main: [[to("Ask the app")]] },
  "Ask the app": { main: [[to("List labels")]] },
  "List labels": { main: [[to("Plan labels")]] },
  "Plan labels": { main: [[to("Each stripped label")]] },
  "Each stripped label": { main: [[to("Find stripped threads")]] },
  "Find stripped threads": { main: [[to("Tag label")]] },
  "Tag label": { main: [[to("Summary")]] },
};
const body = { name: WF_NAME, nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all" } };

if (PRINT) { console.log(SECRET ? JSON.stringify(body, null, 2).split(SECRET).join("<secret>") : JSON.stringify(body, null, 2)); process.exit(0); }
if (!SECRET) { console.error("MISSING ENV: N8N_WEBHOOK_SECRET"); process.exit(2); }

const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const H = { "X-N8N-API-KEY": requireEnv("N8N_API_KEY"), "content-type": "application/json" };
const all = await (await fetch(`${BASE}/api/v1/workflows?limit=250`, { headers: H })).json();
const have = (all.data ?? []).find((w) => w.name === WF_NAME);
if (have?.active) await fetch(`${BASE}/api/v1/workflows/${have.id}/deactivate`, { method: "POST", headers: H });
const res = have
  ? await fetch(`${BASE}/api/v1/workflows/${have.id}`, { method: "PUT", headers: H, body: JSON.stringify(body) })
  : await fetch(`${BASE}/api/v1/workflows`, { method: "POST", headers: H, body: JSON.stringify(body) });
const wf = await res.json();
if (!res.ok) { console.error("n8n refused:", res.status, JSON.stringify(wf).slice(0, 400)); process.exit(1); }
console.log(`${have ? "updated" : "created"} "${WF_NAME}" ${wf.id}`);
// The dry run's webhook has no secret and answers with thread ids, so it is open only for the
// one call that runs it, then switched off again.
await fetch(`${BASE}/api/v1/workflows/${wf.id}/activate`, { method: "POST", headers: H });
try {
  const r = await fetch(`${BASE}/webhook/spartan-labels-dry`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  console.log(JSON.stringify(await r.json(), null, 2));
} finally {
  const off = await fetch(`${BASE}/api/v1/workflows/${wf.id}/deactivate`, { method: "POST", headers: H });
  console.log("dry-run webhook switched off:", off.status);
}
