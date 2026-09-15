// ============================================================================
// Read and delete Gmail LABELS in the bookings mailbox, through a standalone n8n
// workflow that this script installs and then removes.
// ----------------------------------------------------------------------------
// Ben, 2026-09-02: "delete the manual tag globally."
//
// WHY A WORKFLOW AT ALL. The mailbox credential lives inside n8n and cannot be read
// out of it, so nothing local can call Gmail. The existing tag workflow can only add
// or remove a label on ONE named thread, and it hands back {ok:true} rather than what
// Gmail said — no route to enumerate or delete.
//
// WHY A NEW workflow rather than a node added to that one. The public API refuses a
// PUT that ADDS a credentialed node to an existing workflow ("You don't have access
// to the credentials in the '<node>' node") because the Gmail credential belongs to
// another n8n user. It accepts a POST of a whole new workflow carrying the same
// credential — probed 2026-09-02. So the tag workflow ops depend on is never touched.
//
// DELETING A LABEL IS NOT UNDOABLE. Gmail removes it from every thread that wears it
// and the association is gone; re-creating the name mints a new id with nothing on it.
// So --delete refuses to run until the threads carrying the label have been written to
// disk, and it prints the count it is about to strip.
//
// It IS however self-healing as a feature: the tag workflow finds-or-creates by name,
// so a deleted label comes back the next time the engine posts that name. "Manual" will
// NOT come back: as of 2026-09-14 the engine posts "Order Needs Built" or "Order Needs
// Updated" and nothing posts "Manual" any more. What is
// lost is which threads wore it, which is why the file is written first.
//
//   node scripts/gmail-label-admin.mjs --list
//   node scripts/gmail-label-admin.mjs --threads "Manual"
//   node scripts/gmail-label-admin.mjs --delete  "Manual"     # asks for --yes
//   node scripts/gmail-label-admin.mjs --delete  "Manual" --yes
//   node scripts/gmail-label-admin.mjs --rename "Add job on onsinch" --to "Order Needs Built"
// ============================================================================
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const SECRET = requireEnv("N8N_WEBHOOK_SECRET");
const h = { "X-N8N-API-KEY": requireEnv("N8N_API_KEY"), "content-type": "application/json" };
const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
// "Spartan Crew 8/27/26" (hGFZ7vGl625ZeExK) was the default until 2026-09-15 and its
// OAuth grant is revoked, so every run of this script died at "List labels" with a
// refresh-token error that reads like an empty mailbox. The live grant is the one
// intake runs on. Overridable, because the next revocation will land here too.
const GMAIL_CRED = {
  id: process.env.GMAIL_CRED_ID || "6Ab8OMlONlOA9vtG",
  name: process.env.GMAIL_CRED_NAME || "Gmail account 14",
};

const argv = process.argv.slice(2);
const arg = (flag) => (argv.includes(flag) ? String(argv[argv.indexOf(flag) + 1] ?? "") : null);
const LIST = argv.includes("--list");
const THREADS = arg("--threads");
const DELETE = arg("--delete");
const YES = argv.includes("--yes");
const RENAME = arg("--rename");
const TO = arg("--to");
const WF_NAME = "TEMP — Spartan label admin";
const PATH = "spartan-label-admin";
const OUT = ".tmp-data/label-admin";

if (!LIST && !THREADS && !DELETE && !RENAME) {
  console.log("nothing asked for. --list | --threads <name> | --delete <name> | --rename <name> --to <new>");
  process.exit(1);
}

const api = async (p, init = {}) => {
  const r = await fetch(`${BASE}/api/v1${p}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`n8n ${init.method || "GET"} ${p} -> ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

/**
 * One webhook, three actions, one credentialed node per action. A Switch rather than
 * one node with an expression-driven method: an httpRequest whose METHOD is an
 * expression is the kind of thing that silently GETs when you meant DELETE, and this
 * is a script that deletes things.
 */
const nodes = [
  { id: "in", name: "Ask", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0],
    parameters: { httpMethod: "POST", path: PATH, responseMode: "responseNode", options: {} }, webhookId: PATH },
  { id: "gate", name: "Check secret", type: "n8n-nodes-base.code", typeVersion: 2, position: [200, 0],
    parameters: { jsCode:
      `const hdr = $json.headers?.['x-webhook-secret'];\n` +
      `if (hdr !== ${JSON.stringify(SECRET)}) throw new Error('bad secret');\n` +
      `const b = $json.body ?? {};\n` +
      // `rename` belongs here as much as the others. It was missing while the Gmail
      // credential was down, so nothing could reach this gate to find out — the Switch,
      // the Rename node and the connection were all correct and the request died two
      // nodes earlier, as an empty 200 with no error anywhere.
      `if (!['list','threads','delete','rename'].includes(b.action)) throw new Error('unknown action');\n` +
      `return [{ json: b }];` } },
  { id: "sw", name: "Which", type: "n8n-nodes-base.switch", typeVersion: 3, position: [400, 0],
    parameters: { rules: { values: [
      { conditions: { options: { caseSensitive: true, version: 2 }, combinator: "and", conditions: [
        { operator: { type: "string", operation: "equals" }, leftValue: "={{ $json.action }}", rightValue: "list" }] }, outputKey: "list" },
      { conditions: { options: { caseSensitive: true, version: 2 }, combinator: "and", conditions: [
        { operator: { type: "string", operation: "equals" }, leftValue: "={{ $json.action }}", rightValue: "threads" }] }, outputKey: "threads" },
      { conditions: { options: { caseSensitive: true, version: 2 }, combinator: "and", conditions: [
        { operator: { type: "string", operation: "equals" }, leftValue: "={{ $json.action }}", rightValue: "delete" }] }, outputKey: "delete" },
      { conditions: { options: { caseSensitive: true, version: 2 }, combinator: "and", conditions: [
        { operator: { type: "string", operation: "equals" }, leftValue: "={{ $json.action }}", rightValue: "rename" }] }, outputKey: "rename" },
    ] }, options: { fallbackOutput: "none" } } },
  { id: "l", name: "List labels", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [640, -140],
    parameters: { url: `${GM}/labels`, method: "GET", authentication: "predefinedCredentialType",
      nodeCredentialType: "gmailOAuth2", options: {} }, credentials: { gmailOAuth2: GMAIL_CRED } },
  { id: "t", name: "List threads", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [640, 0],
    parameters: { url: `=${GM}/threads?maxResults=500&labelIds={{ $json.label_id }}`, method: "GET",
      authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2", options: {} },
    credentials: { gmailOAuth2: GMAIL_CRED } },
  { id: "d", name: "Delete label", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [640, 140],
    parameters: { url: `=${GM}/labels/{{ $json.label_id }}`, method: "DELETE",
      authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2", options: {} },
    credentials: { gmailOAuth2: GMAIL_CRED } },
  { id: "r", name: "Rename label", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [640, 280],
    parameters: { url: `=${GM}/labels/{{ $json.label_id }}`, method: "PATCH",
      sendBody: true, specifyBody: "json", jsonBody: `={{ JSON.stringify({ name: $json.new_name }) }}`,
      authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2", options: {} },
    credentials: { gmailOAuth2: GMAIL_CRED } },
  { id: "out", name: "Answer", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1, position: [900, 0],
    parameters: { respondWith: "json", responseBody: `={{ JSON.stringify({ ok: true, data: $json }) }}`, options: {} } },
];
for (const n of nodes) {
  if (n.type !== "n8n-nodes-base.httpRequest") continue;
  n.alwaysOutputData = true;
  n.onError = "continueRegularOutput";
}

const connections = {
  Ask: { main: [[{ node: "Check secret", type: "main", index: 0 }]] },
  "Check secret": { main: [[{ node: "Which", type: "main", index: 0 }]] },
  Which: { main: [
    [{ node: "List labels", type: "main", index: 0 }],
    [{ node: "List threads", type: "main", index: 0 }],
    [{ node: "Delete label", type: "main", index: 0 }],
    [{ node: "Rename label", type: "main", index: 0 }],
  ] },
  "List labels": { main: [[{ node: "Answer", type: "main", index: 0 }]] },
  "List threads": { main: [[{ node: "Answer", type: "main", index: 0 }]] },
  "Delete label": { main: [[{ node: "Answer", type: "main", index: 0 }]] },
  "Rename label": { main: [[{ node: "Answer", type: "main", index: 0 }]] },
};

const existing = ((await api("/workflows?limit=250")).data ?? []).find((w) => w.name === WF_NAME);
let wf;
if (existing) {
  if (existing.active) await api(`/workflows/${existing.id}/deactivate`, { method: "POST" });
  wf = await api(`/workflows/${existing.id}`, { method: "PUT", body: JSON.stringify({ name: WF_NAME, nodes, connections, settings: { executionOrder: "v1" } }) });
} else {
  wf = await api("/workflows", { method: "POST", body: JSON.stringify({ name: WF_NAME, nodes, connections, settings: { executionOrder: "v1" } }) });
}
await api(`/workflows/${wf.id}/activate`, { method: "POST" });
console.log(`temp workflow ${wf.id} active`);

/**
 * Registration lags activation. `POST /workflows/{id}/activate` returns before the
 * production webhook is servable, so the first call after installing intermittently
 * gets 404 "is not registered" — which reads exactly like a broken workflow. Only
 * that 404 is retried; every other refusal is real and thrown at once.
 */
const ask = async (body, tries = 6) => {
  for (let i = 1; ; i++) {
    const r = await fetch(`${BASE}/webhook/${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch { /* n8n answers 200 with prose when a run throws */ }
    if (r.ok && j?.ok === true) return j.data;
    const notYet = r.status === 404 && /not registered/i.test(text);
    if (!notYet || i >= tries) throw new Error(`webhook did not confirm (HTTP ${r.status}) ${text.slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
};

try {
  mkdirSync(OUT, { recursive: true });
  const raw = await ask({ action: "list" });
  if (!Array.isArray(raw?.labels)) {
    throw new Error(
      `Gmail did not return a label list. This is a FAILURE, not an empty mailbox.
` +
      `raw response: ${JSON.stringify(raw).slice(0, 600)}`
    );
  }
  const labels = raw.labels;
  const mine = labels.filter((l) => l.type !== "system");
  if (!mine.length) throw new Error(`Gmail returned ${labels.length} labels but none are user labels — refusing to act on that.`);

  if (LIST) {
    console.log(`\n${mine.length} user labels in the mailbox:`);
    for (const l of mine) console.log(`  ${String(l.id).padEnd(24)} ${l.name}${l.color ? `  [${l.color.backgroundColor}]` : ""}`);
  }

  if (RENAME) {
    if (!TO) throw new Error("--rename needs --to \"New Name\"");
    const hit = mine.find((l) => String(l.name).toLowerCase() === RENAME.toLowerCase());
    if (!hit) {
      console.log(`
no user label named "${RENAME}" — nothing to rename`);
    } else if (mine.some((l) => String(l.name).toLowerCase() === TO.toLowerCase())) {
      // Gmail refuses a duplicate name, and a half-applied rename is worse than none.
      console.log(`
"${TO}" already exists — refusing to rename "${hit.name}" onto it`);
    } else {
      // A rename KEEPS the label id, so every thread already wearing it keeps the tag.
      // That is the whole reason this is a rename and not a create-plus-delete.
      const res = await ask({ action: "rename", label_id: hit.id, new_name: TO });
      console.log(`
renamed "${hit.name}" -> "${res?.name ?? TO}"  (${hit.id}, unchanged)`);
    }
  }

  const target = THREADS || DELETE;
  if (target) {
    const hit = mine.find((l) => String(l.name).toLowerCase() === target.toLowerCase());
    if (!hit) {
      console.log(`\nno user label named "${target}" — nothing to do`);
    } else {
      const res = await ask({ action: "threads", label_id: hit.id });
      const ids = (res.threads ?? []).map((t) => t.id);
      const file = `${OUT}/${target.replace(/\W+/g, "_")}-threads.json`;
      writeFileSync(file, JSON.stringify({ label: hit.name, label_id: hit.id, captured: new Date().toISOString(), thread_ids: ids }, null, 1));
      console.log(`\n"${hit.name}" (${hit.id}) is on ${ids.length} thread(s)${res.nextPageToken ? " — MORE THAN 500, list is truncated" : ""}`);
      console.log(`captured to ${file}`);

      if (DELETE) {
        if (!YES) {
          console.log(`\nNOT DELETED. This strips the label from ${ids.length} thread(s) and cannot be undone.`);
          console.log(`Re-run with --yes to go ahead.`);
        } else if (!existsSync(file) || !JSON.parse(readFileSync(file, "utf8")).thread_ids) {
          throw new Error("refusing to delete: the thread capture is not on disk");
        } else {
          await ask({ action: "delete", label_id: hit.id });
          console.log(`\nDELETED "${hit.name}". It is off all ${ids.length} thread(s).`);
          console.log(`The tag workflow finds-or-creates by name, so a name the engine still posts will come back.`);
        }
      }
    }
  }
} finally {
  await api(`/workflows/${wf.id}/deactivate`, { method: "POST" }).catch(() => {});
  await api(`/workflows/${wf.id}`, { method: "DELETE" }).catch(() => {});
  console.log(`\ntemp workflow ${wf.id} removed`);
}
