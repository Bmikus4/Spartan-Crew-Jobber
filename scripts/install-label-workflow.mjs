// The Gmail labels' minute (Ben, 10-15): ONE n8n workflow that asks the app which labels each
// bookings thread should wear (POST /api/bot/labels, app/lib/mail/threadLabels.ts decides) and
// applies them with the bookings mailbox's Gmail credential. The app decides; n8n carries out.
//
// Each run: ask the app -> list Gmail's labels -> rename the old names, create any missing ->
// list again -> modify each changed thread -> strip the old systems' labels from the threads
// still wearing them (a search per label, up to 100 threads a minute).
//
//   node scripts/install-label-workflow.mjs --dry      runs a webhook twin ONCE that changes NOTHING in
//                                                      Gmail, prints what it would do, switches it off
//   node scripts/install-label-workflow.mjs            install the minute workflow, INACTIVE
//   node scripts/install-label-workflow.mjs --activate the same, switched on (after Ben's yes)
//   node scripts/install-label-workflow.mjs --print
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const ACTIVATE = argv.includes("--activate");
const PRINT = argv.includes("--print");

const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();
const APP = (process.env.SPARTAN_APP_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const GMAIL = { gmailOAuth2: { id: "6Ab8OMlONlOA9vtG", name: "Gmail account 14" } };
const G = "https://gmail.googleapis.com/gmail/v1/users/me";
const gmailReq = (id, name, x, y, method, url, jsonBody) => ({
  id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [x, y], credentials: GMAIL,
  onError: "continueRegularOutput",
  parameters: {
    method, url, authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2",
    ...(jsonBody ? { sendBody: true, specifyBody: "json", jsonBody } : {}),
    options: { response: { response: { neverError: true } } },
  },
});

const WF_NAME = DRY ? "Spartan Labels (dry run)" : "Spartan Labels (every minute)";
const trigger = DRY
  ? { id: "hook", name: "Dry run", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: "spartan-labels-dry",
      parameters: { httpMethod: "POST", path: "spartan-labels-dry", responseMode: "lastNode", options: {} } }
  : { id: "sched", name: "Every minute", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0],
      parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } } };

// The plan is computed in one Code node, from the app's answer and Gmail's label list, so the
// whole decision is one readable function rather than a chain of IFs.
const PLAN_CODE = `
const app = $('Ask the app').first().json;
const labels = ($('List labels').first().json.labels || []);
const byName = new Map(labels.map((l) => [l.name, l]));
const renames = (app.renames || []).filter((r) => byName.has(r.from) && !byName.has(r.to));
const creates = (app.labels || []).filter((l) => !byName.has(l.name) && !renames.some((r) => r.to === l.name));
return [{ json: { app, renames, creates, strip: (app.strip || []).filter((n) => byName.has(n)).map((n) => ({ name: n, id: byName.get(n).id })) } }];`;

const APPLY_CODE = `
const plan = $('Plan').first().json;
const labels = ($('List labels again').first().json.labels || []);
const id = new Map(labels.map((l) => [l.name, l.id]));
const out = [];
for (const t of plan.app.threads || []) {
  const add = t.add.map((n) => id.get(n)).filter(Boolean);
  const remove = t.remove.map((n) => id.get(n)).filter(Boolean);
  out.push({ json: { thread_id: t.thread_id, body: { addLabelIds: add, removeLabelIds: remove } } });
}
return out.length ? out : [{ json: { none: true } }];`;

const DRY_CODE = `
const plan = $('Plan').first().json;
const found = $('Find stripped threads').all().map((x) => ({ label: x.json.label, threads: x.json.resultSizeEstimate ?? (x.json.threads || []).length }));
return [{ json: { dry: true, renames: plan.renames, creates: plan.creates.map((c) => c.name), threads: (plan.app.threads || []).length,
  by_label: (plan.app.threads || []).reduce((a, t) => { const k = t.add.join(' + ') || 'none'; a[k] = (a[k] || 0) + 1; return a; }, {}),
  sample: (plan.app.threads || []).slice(0, 12), strip: found,
  gmail_labels: ($('List labels').first().json.labels || []).filter((l) => l.type === 'user').map((l) => l.name).sort() } }];`;

const ask = { id: "ask", name: "Ask the app", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [220, 0],
  parameters: { method: "POST", url: `${APP}/api/bot/labels`, sendHeaders: true, headerParameters: { parameters: [{ name: "x-webhook-secret", value: SECRET }] },
    sendBody: true, specifyBody: "json", jsonBody: JSON.stringify({ mode: DRY ? "dry" : "live" }), options: { timeout: 120000 } } };
const list = gmailReq("list", "List labels", 440, 0, "GET", `${G}/labels`);
const plan = { id: "plan", name: "Plan", type: "n8n-nodes-base.code", typeVersion: 2, position: [660, 0], parameters: { jsCode: PLAN_CODE } };

let nodes, connections;
if (DRY) {
  const split = { id: "split", name: "Each stripped label", type: "n8n-nodes-base.code", typeVersion: 2, position: [880, 0],
    parameters: { jsCode: "const p = $('Plan').first().json; return p.strip.length ? p.strip.map((s) => ({ json: s })) : [{ json: { name: '', id: '' } }];" } };
  const find = { ...gmailReq("find", "Find stripped threads", 1100, 0, "GET", `=${G}/threads?maxResults=500&labelIds={{ $json.id }}`), };
  const tag = { id: "tag", name: "Tag label", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [1320, 0],
    parameters: { mode: "raw", jsonOutput: "={{ JSON.stringify({ ...$json, label: $('Each stripped label').item.json.name }) }}", options: {} } };
  const summary = { id: "sum", name: "Summary", type: "n8n-nodes-base.code", typeVersion: 2, position: [1540, 0], parameters: { jsCode: DRY_CODE.replace("$('Find stripped threads')", "$('Tag label')") } };
  nodes = [trigger, ask, list, plan, split, find, tag, summary];
  connections = {
    [trigger.name]: { main: [[{ node: "Ask the app", type: "main", index: 0 }]] },
    "Ask the app": { main: [[{ node: "List labels", type: "main", index: 0 }]] },
    "List labels": { main: [[{ node: "Plan", type: "main", index: 0 }]] },
    "Plan": { main: [[{ node: "Each stripped label", type: "main", index: 0 }]] },
    "Each stripped label": { main: [[{ node: "Find stripped threads", type: "main", index: 0 }]] },
    "Find stripped threads": { main: [[{ node: "Tag label", type: "main", index: 0 }]] },
    "Tag label": { main: [[{ node: "Summary", type: "main", index: 0 }]] },
  };
} else {
  const renameItems = { id: "ren", name: "Each rename", type: "n8n-nodes-base.code", typeVersion: 2, position: [880, -160],
    parameters: { jsCode: "const p = $('Plan').first().json; const labels = $('List labels').first().json.labels || []; return p.renames.map((r) => ({ json: { id: labels.find((l) => l.name === r.from).id, name: r.to } }));" } };
  const rename = gmailReq("rename", "Rename label", 1100, -160, "PATCH", `=${G}/labels/{{ $json.id }}`, "={{ JSON.stringify({ name: $json.name }) }}");
  const createItems = { id: "cre", name: "Each new label", type: "n8n-nodes-base.code", typeVersion: 2, position: [880, 0],
    parameters: { jsCode: "const p = $('Plan').first().json; return p.creates.map((c) => ({ json: c }));" } };
  const create = gmailReq("create", "Create label", 1100, 0, "POST", `${G}/labels`, "={{ JSON.stringify({ name: $json.name, labelListVisibility: 'labelShow', messageListVisibility: 'show', color: $json.color }) }}");
  const merge = { id: "wait", name: "After labels", type: "n8n-nodes-base.code", typeVersion: 2, position: [1320, 0], parameters: { jsCode: "return [{ json: {} }];" } };
  const again = gmailReq("again", "List labels again", 1540, 0, "GET", `${G}/labels`);
  const apply = { id: "apply", name: "Each thread", type: "n8n-nodes-base.code", typeVersion: 2, position: [1760, 0], parameters: { jsCode: APPLY_CODE } };
  const has = { id: "has", name: "Any thread?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [1980, 0],
    parameters: { conditions: { options: { caseSensitive: true, typeValidation: "loose", version: 2 }, combinator: "and",
      conditions: [{ id: "c1", leftValue: "={{ $json.thread_id }}", rightValue: "", operator: { type: "string", operation: "notEmpty", singleValue: true } }] }, options: {} } };
  const modify = gmailReq("modify", "Label thread", 2200, 0, "POST", `=${G}/threads/{{ $json.thread_id }}/modify`, "={{ JSON.stringify($json.body) }}");
  const stripItems = { id: "stripi", name: "Each stripped label", type: "n8n-nodes-base.code", typeVersion: 2, position: [1760, 200],
    parameters: { jsCode: "const p = $('Plan').first().json; return p.strip.map((s) => ({ json: s }));" } };
  const find = gmailReq("find", "Find stripped threads", 1980, 200, "GET", `=${G}/threads?maxResults=100&labelIds={{ $json.id }}`);
  const each = { id: "eachs", name: "Each stripped thread", type: "n8n-nodes-base.code", typeVersion: 2, position: [2200, 200],
    parameters: { jsCode: "const out = []; for (const x of $input.all()) { const id = x.json.labelId; } const items = $('Each stripped label').all(); $input.all().forEach((x, k) => { for (const t of x.json.threads || []) out.push({ json: { thread_id: t.id, label_id: items[k]?.json.id } }); }); return out;" } };
  const strip = gmailReq("strip", "Strip label", 2420, 200, "POST", `=${G}/threads/{{ $json.thread_id }}/modify`, "={{ JSON.stringify({ removeLabelIds: [$json.label_id] }) }}");
  nodes = [trigger, ask, list, plan, renameItems, rename, createItems, create, merge, again, apply, has, modify, stripItems, find, each, strip];
  connections = {
    [trigger.name]: { main: [[{ node: "Ask the app", type: "main", index: 0 }]] },
    "Ask the app": { main: [[{ node: "List labels", type: "main", index: 0 }]] },
    "List labels": { main: [[{ node: "Plan", type: "main", index: 0 }]] },
    "Plan": { main: [[{ node: "Each rename", type: "main", index: 0 }, { node: "Each new label", type: "main", index: 0 }, { node: "After labels", type: "main", index: 0 }]] },
    "Each rename": { main: [[{ node: "Rename label", type: "main", index: 0 }]] },
    "Each new label": { main: [[{ node: "Create label", type: "main", index: 0 }]] },
    "After labels": { main: [[{ node: "List labels again", type: "main", index: 0 }]] },
    "List labels again": { main: [[{ node: "Each thread", type: "main", index: 0 }, { node: "Each stripped label", type: "main", index: 0 }]] },
    "Each thread": { main: [[{ node: "Any thread?", type: "main", index: 0 }]] },
    "Any thread?": { main: [[{ node: "Label thread", type: "main", index: 0 }], []] },
    "Each stripped label": { main: [[{ node: "Find stripped threads", type: "main", index: 0 }]] },
    "Find stripped threads": { main: [[{ node: "Each stripped thread", type: "main", index: 0 }]] },
    "Each stripped thread": { main: [[{ node: "Strip label", type: "main", index: 0 }]] },
  };
}
const body = { name: WF_NAME, nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: DRY ? "all" : "none" } };

if (PRINT) { console.log(JSON.stringify(body, null, 2).replace(SECRET || "", "<secret>")); process.exit(0); }
if (!SECRET) { console.error("MISSING ENV: N8N_WEBHOOK_SECRET"); process.exit(2); }

const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const KEY = requireEnv("N8N_API_KEY");
const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };
const all = await (await fetch(`${BASE}/api/v1/workflows?limit=250`, { headers: H })).json();
const have = (all.data ?? []).find((w) => w.name === WF_NAME);
const res = have
  ? await fetch(`${BASE}/api/v1/workflows/${have.id}`, { method: "PUT", headers: H, body: JSON.stringify(body) })
  : await fetch(`${BASE}/api/v1/workflows`, { method: "POST", headers: H, body: JSON.stringify(body) });
const wf = await res.json();
if (!res.ok) { console.error("n8n refused:", res.status, JSON.stringify(wf).slice(0, 400)); process.exit(1); }
console.log(`${have ? "updated" : "created"} "${WF_NAME}" ${wf.id}`);
if (ACTIVATE && !DRY) {
  const a = await fetch(`${BASE}/api/v1/workflows/${wf.id}/activate`, { method: "POST", headers: H });
  console.log("activate", a.status);
}
// The dry run's webhook has no secret and answers with thread ids, so it is open only for the
// one call that runs it, then switched off again.
if (DRY) {
  await fetch(`${BASE}/api/v1/workflows/${wf.id}/activate`, { method: "POST", headers: H });
  try {
    const r = await fetch(`${BASE}/webhook/spartan-labels-dry`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    console.log(JSON.stringify(await r.json(), null, 2));
  } finally {
    const off = await fetch(`${BASE}/api/v1/workflows/${wf.id}/deactivate`, { method: "POST", headers: H });
    console.log("dry-run webhook switched off:", off.status);
  }
}
