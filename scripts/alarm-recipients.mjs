// ============================================================================
// Lets a report sent to the "Spartan Alarms" webhook (4QTUkIbqSDrkTC6h) name its recipient,
// from a fixed allow-list only. Anything else, or nothing, goes where every alarm has always
// gone (ben@ and samuraisolutionsofficial@).
// ----------------------------------------------------------------------------
// The webhook has no secret: the app and the intake watchdog post to it bare. A free `to`
// would make it a relay that sends any text to any address from Spartan's Gmail, so the
// address is checked against ALLOWED inside the node's own expression, where no caller can
// widen it. A letter (`letter: true`) also drops the alarm footer (Ref / When / Build).
//
// A NEW WORKFLOW REPLACES THE OLD ONE. n8n answers 200 to an update of a node holding a Gmail
// credential and keeps the node as it was (10-16, twice), so the edited copy is created, the
// old one stood down, the copy switched on on the same path, and the old one deleted only once
// the copy is live. If the copy will not switch on, the old one is switched back on.
//
//   node --env-file=.env.local scripts/alarm-recipients.mjs [workflow id]   (backs up, then replaces)
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";

const ID = process.argv[2] || "mQkxdu2rLkTovYwn";
const DEFAULT = "ben@samuraisolutions.co.uk, samuraisolutionsofficial@gmail.com";
const ALLOWED = ["steven@samuraisolutions.co.uk"];
const BASE = (process.env.N8N_BASE || "").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const h = { "X-N8N-API-KEY": process.env.N8N_API_KEY || "", "content-type": "application/json" };
const api = async (path, init = {}) => { const r = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: h }); return { status: r.status, data: await r.json().catch(() => null) }; };

const w = (await api(`/workflows/${ID}`)).data;
if (!w?.nodes) { console.error("could not read the workflow"); process.exit(1); }
mkdirSync("n8n/backups", { recursive: true });
writeFileSync(`n8n/backups/spartan-alarms-${Date.now()}.json`, JSON.stringify(w, null, 2));

const mail = w.nodes.find((n) => n.type === "n8n-nodes-base.gmail");
const allowed = JSON.stringify(ALLOWED).replace(/"/g, "'");
mail.parameters.sendTo = `={{ ${allowed}.includes(String($json.body.to || '').trim().toLowerCase()) ? String($json.body.to).trim() + ', ben@samuraisolutions.co.uk' : '${DEFAULT}' }}`;
mail.parameters.subject = `={{ $json.body.letter && $json.body.subject ? $json.body.subject : ($json.body.user_name || 'Spartan alarm') + ' - ' + ($json.body.route || 'unknown') }}`;
mail.parameters.message = `={{ $json.body.ticket_text || JSON.stringify($json.body) }}{{ $json.body.letter ? '' : '\\n\\n-----\\nRef: ' + $json.body.record_id + '\\nWhen: ' + $json.body.ts + '\\nWhere: ' + $json.body.route + '\\nBuild: ' + $json.body.deploy_sha + '\\n' + ($json.body.transcript || '') + '\\n\\nSent by the n8n workflow "Spartan Alarms" on the Test Email credential.' }}`;

for (const n of w.nodes) delete n.webhookId;
const created = await api("/workflows", { method: "POST", body: JSON.stringify({ name: w.name, nodes: w.nodes, connections: w.connections, settings: { executionOrder: w.settings?.executionOrder ?? "v1" } }) });
if (!created.data?.id) { console.error("create refused", created.status, JSON.stringify(created.data).slice(0, 300)); process.exit(1); }
const fresh = created.data.id;
const gm = created.data.nodes.find((n) => n.type === "n8n-nodes-base.gmail");
if (!String(gm?.parameters?.sendTo).includes("includes(") || !gm?.credentials?.gmailOAuth2) { console.error("the copy lost the change or the credential"); await api(`/workflows/${fresh}`, { method: "DELETE" }); process.exit(1); }
await api(`/workflows/${ID}/deactivate`, { method: "POST" });
const on = await api(`/workflows/${fresh}/activate`, { method: "POST" });
if (!(await api(`/workflows/${fresh}`)).data?.active) {
  console.error("the copy would not switch on", on.status, JSON.stringify(on.data).slice(0, 300));
  await api(`/workflows/${ID}/activate`, { method: "POST" });
  await api(`/workflows/${fresh}`, { method: "DELETE" });
  process.exit(1);
}
await api(`/workflows/${ID}`, { method: "DELETE" });
console.log(`Spartan Alarms is now ${fresh} (retired ${ID}); recipients allowed besides the default: ${ALLOWED.join(", ")}`);
