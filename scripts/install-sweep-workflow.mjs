// ============================================================================
// Install the sweep workflow into n8n, and run one window at a time.
// ----------------------------------------------------------------------------
// Creates a NEW workflow from n8n/spartan-sweep.workflow.json. It never reads,
// patches or activates any of the existing ones — the only workflow it touches is
// the one it created, matched by name, so re-running updates rather than piling up
// duplicates.
//
// The webhook secret is injected here, from the environment, so it is never
// committed in the workflow JSON.
//
//   node scripts/install-sweep-workflow.mjs                 # install / update, leave inactive
//   node scripts/install-sweep-workflow.mjs --activate      # + activate (the webhook needs this)
//   node scripts/install-sweep-workflow.mjs --run 3         # + sweep the month 3 months back
//   node scripts/install-sweep-workflow.mjs --status         # what is installed, and corpus size
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const SECRET = requireEnv("N8N_WEBHOOK_SECRET");
const h = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };

const argv = process.argv.slice(2);
const ACTIVATE = argv.includes("--activate") || argv.includes("--run");
const STATUS_ONLY = argv.includes("--status");
const RUN_MONTH = argv.includes("--run") ? Number(argv[argv.indexOf("--run") + 1]) : null;
const WF_NAME = "Spartan Sweep — 12 months to corpus";
const INGEST = "https://spartan-crew-jobber.vercel.app/api/sweep-ingest";

const api = async (path, init) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...h, ...(init?.headers || {}) } });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`${init?.method || "GET"} ${path} -> ${r.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

async function findExisting() {
  const list = await api("/workflows?limit=250");
  return (list.data || []).find((w) => w.name === WF_NAME) || null;
}

async function corpus() {
  const r = await fetch(INGEST, { headers: { "x-webhook-secret": SECRET } });
  return r.ok ? r.json() : { error: r.status };
}

const existing = await findExisting();

if (STATUS_ONLY) {
  console.log(existing ? `installed: ${existing.id}  active=${existing.active}` : "not installed");
  console.log("corpus:", JSON.stringify(await corpus()));
  process.exit(0);
}

// The committed JSON carries a placeholder; the real secret is only ever in env.
const spec = JSON.parse(readFileSync(join(ROOT_DIR, "n8n", "spartan-sweep.workflow.json"), "utf8"));
let injected = 0;
for (const node of spec.nodes) {
  for (const p of node.parameters?.headerParameters?.parameters || []) {
    if (p.name === "x-webhook-secret") { p.value = SECRET; injected++; }
  }
}
if (!injected) throw new Error("no x-webhook-secret header found to inject — check the builder");

// n8n's create/update API rejects unknown top-level fields, so send only what it takes.
const body = { name: spec.name, nodes: spec.nodes, connections: spec.connections, settings: spec.settings };

let wf;
if (existing) {
  // Deactivate first. Updating a workflow while it is active leaves the previously
  // registered version answering the webhook, so the next call runs the OLD nodes —
  // which is exactly how a fixed bug appeared to survive its fix.
  if (existing.active) {
    await api(`/workflows/${existing.id}/deactivate`, { method: "POST" });
    console.log("deactivated before update, so the webhook re-registers");
  }
  wf = await api(`/workflows/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
  console.log(`updated ${wf.id}  (${spec.nodes.length} nodes, secret injected into ${injected} header)`);
} else {
  wf = await api("/workflows", { method: "POST", body: JSON.stringify(body) });
  console.log(`created ${wf.id}  (${spec.nodes.length} nodes, secret injected into ${injected} header)`);
}

// A PUT can clear the active flag, so read back rather than trusting the response.
let live = await api(`/workflows/${wf.id}`);
if (ACTIVATE && !live.active) {
  await api(`/workflows/${wf.id}/activate`, { method: "POST" });
  live = await api(`/workflows/${wf.id}`);
  console.log(`activated: ${live.active}`);
}

const webhookNode = live.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
const path = webhookNode?.parameters?.path;
const hookUrl = `${BASE.replace(/\/api\/v1$/, "")}/webhook/${path}`;
console.log(`webhook: POST ${hookUrl}`);

if (RUN_MONTH !== null) {
  if (!Number.isFinite(RUN_MONTH)) throw new Error("--run needs a number of months back, e.g. --run 3");
  if (!live.active) throw new Error("workflow is not active, so its production webhook is not listening");
  console.log(`\nsweeping the month ${RUN_MONTH} month(s) back …`);
  const before = await corpus();
  const started = Date.now();
  const r = await fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ monthsAgo: RUN_MONTH }),
  });
  const text = await r.text();
  console.log(`webhook -> ${r.status} in ${Math.round((Date.now() - started) / 1000)}s: ${text.slice(0, 300)}`);
  const after = await corpus();
  console.log(`corpus before: ${before.threads} threads / ${before.messages} messages`);
  console.log(`corpus after : ${after.threads} threads / ${after.messages} messages`);
}
