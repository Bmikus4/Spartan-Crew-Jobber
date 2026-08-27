// ============================================================================
// The "Manual" tag: a job this engine could not book, marked in the mailbox ops
// actually work from.
// ----------------------------------------------------------------------------
// Ben, 2026-08-26: "any that cannot be booked should pipe into n8n via webhook and
// mark the thread with a tag 'Manual'."
//
// The engine cannot label a Gmail thread itself. The mailbox credential lives inside
// n8n and cannot be read out of it — the public API returns credential metadata only,
// never the token — so the engine posts and this workflow labels.
//
// A STANDALONE WORKFLOW. It creates nothing else, patches nothing else, and matches
// itself by name so re-running updates rather than piling up duplicates. The live
// bookings workflow is never touched: hand-editing live n8n JSON is the recurring
// production failure in this account, and an idempotent installer is the answer to it.
//
// WHAT THE ENGINE SENDS, and why so little:
//
//   { label, thread_id, state, reason, status, subject?, order_id?, crew?, dates? }
//
// `thread_id` is the GMAIL thread id — the same id the engine keys every conversation
// on, so no lookup is needed to find the thread. `state` is "manual" or "cleared", and
// both directions matter: a thread that needed a person and later gets booked must stop
// wearing the tag, or the tag decays into "threads that ever went wrong", which nobody
// can work from. Ops act on the label, so it has to mean "needs you NOW".
//
// IT RESOLVES THE LABEL ID ITSELF. Gmail's modify endpoint takes label IDs, not names,
// and the id for "Manual" is per-mailbox. The workflow lists labels, finds or CREATES
// "Manual", then applies it — so nobody has to make the label by hand first, and a
// renamed or deleted label heals on the next flag rather than failing silently.
//
// IT ANSWERS {ok:true} AND ONLY THEN. deps.ts treats a 200 with anything else as a
// failure and leaves the thread unflagged so the next email retries. That is deliberate:
// n8n answers 200 when a workflow throws, which is exactly what a rejected secret
// produces, and a tag recorded but never applied is worse than no tag at all.
//
//   node scripts/install-manual-tag-workflow.mjs             # install / update
//   node scripts/install-manual-tag-workflow.mjs --activate  # + activate (needed)
//   node scripts/install-manual-tag-workflow.mjs --status
//   node scripts/install-manual-tag-workflow.mjs --test <gmailThreadId>
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const KEY = requireEnv("N8N_API_KEY");
const SECRET = requireEnv("N8N_WEBHOOK_SECRET");
const h = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };

const argv = process.argv.slice(2);
const ACTIVATE = argv.includes("--activate");
const STATUS_ONLY = argv.includes("--status");
const TEST_ID = argv.includes("--test") ? String(argv[argv.indexOf("--test") + 1] || "") : "";

const WF_NAME = "Spartan Engine — Manual Tag";
const PATH = "spartan-manual-tag";
/**
 * THE MAILBOX CREDENTIAL, IN ONE PLACE, BECAUSE IT EXPIRES.
 *
 * An OAuth credential that expires takes the whole intake down — on 2026-08-26 the live
 * bookings workflow failed 71 times in a row, every five minutes from 08:00, and nothing
 * was read for six hours. Reconnecting in the n8n UI mints a NEW credential with a NEW
 * id, and every node still points at the dead one.
 *
 * That id was hard-coded in three installers, so a reconnect meant finding all three.
 * It now comes from the environment, and the default is only a convenience for a fresh
 * checkout. When it next expires:
 *
 *   1. reconnect the credential in n8n (a browser job, and 2FA-gated)
 *   2. set GMAIL_CRED_ID / GMAIL_CRED_NAME in .env.local to the new one
 *   3. re-run the installers, and swap-gmail-credential.mjs for the live bookings
 *      workflow, which has no installer
 *
 * The httpRequest nodes are WHY the installers are the route rather than a direct API
 * edit: n8n accepts a credential change on a native `gmail` node through the public API
 * and silently keeps the old one on an `httpRequest` node using a predefined credential
 * type. Measured 2026-08-27 — the bookings workflow took the swap, these three did not.
 */
const GMAIL_CRED = {
  id: process.env.GMAIL_CRED_ID || "hGFZ7vGl625ZeExK",
  name: process.env.GMAIL_CRED_NAME || "Spartan Crew 8/27/26",
};

async function api(path, init = {}) {
  const r = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`n8n ${init.method || "GET"} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const list = await api("/workflows?limit=250");
const existing = (list.data ?? []).find((w) => w.name === WF_NAME);
const hookUrl = `${BASE}/webhook/${PATH}`;

if (STATUS_ONLY) {
  console.log(existing ? `${WF_NAME}: id ${existing.id}, active ${existing.active}` : `${WF_NAME}: not installed`);
  console.log(`webhook: POST ${hookUrl}`);
  process.exit(0);
}

if (TEST_ID) {
  const r = await fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify({
      label: "Manual",
      thread_id: TEST_ID,
      state: "manual",
      reason: "connectivity test from the Spartan engine — safe to untag",
      status: "needs-info",
      subject: "Spartan engine — Manual tag connectivity test",
    }),
  });
  const text = await r.text();
  console.log(`${r.status} ${text}`);
  let ok = false;
  try { ok = JSON.parse(text).ok === true; } catch { ok = false; }
  if (r.ok && !ok) console.log("FAILED: 200 with no {ok:true} — the run stopped before Gmail");
  process.exit(r.ok && ok ? 0 : 1);
}

const GM = "https://gmail.googleapis.com/gmail/v1/users/me";

const nodes = [
  {
    id: "in", name: "Flag", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0],
    parameters: { httpMethod: "POST", path: PATH, responseMode: "responseNode", options: {} },
    webhookId: PATH,
  },
  {
    id: "gate", name: "Check secret", type: "n8n-nodes-base.code", typeVersion: 2, position: [200, 0],
    parameters: {
      jsCode:
        `const hdr = $json.headers?.['x-webhook-secret'];\n` +
        `if (hdr !== ${JSON.stringify(SECRET)}) throw new Error('bad secret');\n` +
        `const b = $json.body ?? {};\n` +
        `if (!b.thread_id) throw new Error('no thread_id');\n` +
        `return [{ json: { ...b, label: b.label || 'Manual' } }];`,
    },
  },
  {
    // Gmail's modify endpoint takes label IDs, never names, and the id is per-mailbox.
    id: "labels", name: "List labels", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [400, 0],
    parameters: {
      url: `${GM}/labels`, method: "GET",
      authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2",
      options: {},
    },
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
  {
    id: "find", name: "Find or create", type: "n8n-nodes-base.code", typeVersion: 2, position: [600, 0],
    parameters: {
      jsCode:
        `const flag = $('Check secret').first().json;\n` +
        `const labels = $json.labels ?? [];\n` +
        `const hit = labels.find(l => (l.name || '').toLowerCase() === String(flag.label).toLowerCase());\n` +
        `return [{ json: { ...flag, label_id: hit ? hit.id : null } }];`,
    },
  },
  {
    // Runs only when the label does not exist yet, so nobody has to create it by hand.
    id: "create", name: "Create label", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [800, 140],
    parameters: {
      url: `${GM}/labels`, method: "POST",
      authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2",
      sendBody: true, specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ name: $json.label, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) }}`,
      options: {},
    },
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
  {
    id: "route", name: "Have label?", type: "n8n-nodes-base.if", typeVersion: 2, position: [800, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2 },
        combinator: "and",
        conditions: [{
          operator: { type: "string", operation: "notEmpty" },
          leftValue: "={{ $json.label_id }}",
          rightValue: "",
        }],
      },
      options: {},
    },
  },
  {
    id: "settle", name: "Settle label id", type: "n8n-nodes-base.code", typeVersion: 2, position: [1000, 140],
    parameters: {
      jsCode:
        `const flag = $('Check secret').first().json;\n` +
        `return [{ json: { ...flag, label_id: $json.id } }];`,
    },
  },
  {
    // One call for both directions: add on "manual", remove on "cleared". A thread that
    // gets booked must stop wearing the tag or ops learn to ignore it.
    id: "apply", name: "Tag thread", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [1220, 0],
    parameters: {
      url: `=${GM}/threads/{{ $json.thread_id }}/modify`, method: "POST",
      authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2",
      sendBody: true, specifyBody: "json",
      jsonBody:
        `={{ JSON.stringify($json.state === 'cleared'\n` +
        `      ? { removeLabelIds: [$json.label_id] }\n` +
        `      : { addLabelIds: [$json.label_id] }) }}`,
      options: {},
    },
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
  {
    id: "out", name: "Confirm", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1, position: [1420, 0],
    parameters: {
      respondWith: "json",
      responseBody: `={{ JSON.stringify({ ok: true, thread_id: $json.id ?? null }) }}`,
      options: {},
    },
  },
];

const connections = {
  "Flag":            { main: [[{ node: "Check secret",    type: "main", index: 0 }]] },
  "Check secret":    { main: [[{ node: "List labels",     type: "main", index: 0 }]] },
  "List labels":     { main: [[{ node: "Find or create",  type: "main", index: 0 }]] },
  "Find or create":  { main: [[{ node: "Have label?",     type: "main", index: 0 }]] },
  // true = we already have the id; false = create it, then settle it.
  "Have label?":     { main: [
                        [{ node: "Tag thread",      type: "main", index: 0 }],
                        [{ node: "Create label",    type: "main", index: 0 }],
                      ] },
  "Create label":    { main: [[{ node: "Settle label id", type: "main", index: 0 }]] },
  "Settle label id": { main: [[{ node: "Tag thread",      type: "main", index: 0 }]] },
  "Tag thread":      { main: [[{ node: "Confirm",         type: "main", index: 0 }]] },
};

const settings = { executionOrder: "v1" };
const body = { name: WF_NAME, nodes, connections, settings };

let wf;
if (existing) {
  // Updating while active leaves the old webhook registration behind.
  if (existing.active) {
    await api(`/workflows/${existing.id}/deactivate`, { method: "POST" });
    console.log("deactivated before update, so the webhook re-registers");
  }
  wf = await api(`/workflows/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
  console.log(`updated ${wf.id}`);
} else {
  wf = await api("/workflows", { method: "POST", body: JSON.stringify(body) });
  console.log(`created ${wf.id}`);
}

if (ACTIVATE) {
  await api(`/workflows/${wf.id}/activate`, { method: "POST" });
  const live = await api(`/workflows/${wf.id}`);
  console.log(`activated: ${live.active}`);
}

console.log(`\nwebhook: POST ${hookUrl}`);
console.log("set this on Vercel as MANUAL_TAG_WEBHOOK. Unset, the engine simply does not tag.");
