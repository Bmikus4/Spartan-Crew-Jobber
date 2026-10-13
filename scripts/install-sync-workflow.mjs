// The bridge's minute (Ben, 10-13: "Everything should always be synced every minute"): an n8n
// Schedule workflow that POSTs /api/bot/sync once a minute. The route follows every order the
// bot made or changed by its J number, looks for the unlinked, and retries writes that stopped
// before anything was sent (app/lib/v2/links.ts, process.ts retryStopped).
//
// The schedule lives in n8n, not Vercel: this project has no vercel.json crons, and n8n already
// runs the minute Gmail poll the intake depends on, so one scheduler carries both.
//
//   node scripts/install-sync-workflow.mjs [--activate] [--status] [--print]
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const argv = process.argv.slice(2);
const ACTIVATE = argv.includes("--activate");
const STATUS = argv.includes("--status");
const PRINT = argv.includes("--print");

const WF_NAME = "Spartan Sync (every minute)";
const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();
const APP = (process.env.SPARTAN_APP_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");

const nodes = [
  { id: "sched", name: "Every minute", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0],
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } } },
  { id: "sync", name: "Sync the bridge", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [240, 0],
    onError: "continueRegularOutput",
    parameters: {
      method: "POST", url: `${APP}/api/bot/sync`,
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 290000 },
      sendHeaders: true, headerParameters: { parameters: [{ name: "x-webhook-secret", value: SECRET }] },
    } },
];
const connections = { "Every minute": { main: [[{ node: "Sync the bridge", type: "main", index: 0 }]] } };
const body = { name: WF_NAME, nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "none" } };

if (PRINT) { console.log(JSON.stringify(body, null, 2).replace(SECRET || "", "<secret>")); process.exit(0); }
if (!SECRET) { console.error("MISSING ENV: N8N_WEBHOOK_SECRET -- every sync would 401."); process.exit(2); }

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
const existing = (all.data || []).find((w) => w.name === WF_NAME) || null;
if (STATUS) { console.log(existing ? `${WF_NAME}: ${existing.id}, active=${existing.active}` : `${WF_NAME}: not installed`); process.exit(0); }
let wf;
if (existing) {
  if (existing.active) await api(`/workflows/${existing.id}/deactivate`, { method: "POST" });
  wf = await api(`/workflows/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
  console.log(`updated ${wf.id}`);
} else {
  wf = await api("/workflows", { method: "POST", body: JSON.stringify(body) });
  console.log(`created ${wf.id}`);
}
if (ACTIVATE) { await api(`/workflows/${wf.id}/activate`, { method: "POST" }); console.log(`activated: ${(await api(`/workflows/${wf.id}`)).active}`); }
console.log(`POSTs ${APP}/api/bot/sync every minute`);
