// The Gmail label steps (Ben, 10-15), as n8n nodes. The app decides each bookings thread's labels
// (POST /api/bot/labels, app/lib/mail/threadLabels.ts); these nodes carry it out with the bookings
// mailbox's Gmail credential: ask the app -> list Gmail's labels -> rename the old names, create
// any missing -> list again -> modify each changed thread -> strip the old systems' labels.
//
// THEY RUN INSIDE "Spartan Sync (every minute)", not as a workflow of their own: n8n Cloud counts
// executions, the sync already takes 1,440 a day, and a second minute workflow would double that
// on a plan whose quota the API does not show. Running out stops the Gmail intake too.
//
// Used by install-sync-workflow.mjs (live) and install-label-workflow.mjs (the dry run).

const GMAIL = { gmailOAuth2: { id: "6Ab8OMlONlOA9vtG", name: "Gmail account 14" } };
const G = "https://gmail.googleapis.com/gmail/v1/users/me";

// A node that writes to many threads sends 5 at a time, a second apart: the first live run sent
// 29 at once and Gmail refused 9 ("Too many concurrent requests for user", 10-16).
export const gmailReq = (id, name, x, y, method, url, jsonBody, batched = false) => ({
  id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [x, y], credentials: GMAIL,
  onError: "continueRegularOutput",
  parameters: {
    method, url, authentication: "predefinedCredentialType", nodeCredentialType: "gmailOAuth2",
    ...(jsonBody ? { sendBody: true, specifyBody: "json", jsonBody } : {}),
    options: { response: { response: { neverError: true } }, ...(batched ? { batching: { batch: { batchSize: 5, batchInterval: 1000 } } } : {}) },
  },
});

// The whole decision is one readable Code node rather than a chain of IFs.
const PLAN_CODE = `
const app = $('Ask the app').first().json;
const labels = ($('List labels').first().json.labels || []);
const byName = new Map(labels.map((l) => [l.name, l]));
const renames = (app.renames || []).filter((r) => byName.has(r.from) && !byName.has(r.to));
const creates = (app.labels || []).filter((l) => !byName.has(l.name) && !renames.some((r) => r.to === l.name));
return [{ json: { app, renames, creates, strip: (app.strip || []).filter((n) => byName.has(n)).map((n) => ({ name: n, id: byName.get(n).id })) } }];`;

const APPLY_CODE = `
const plan = $('Plan labels').first().json;
const labels = ($('List labels again').first().json.labels || []);
const id = new Map(labels.map((l) => [l.name, l.id]));
const out = [];
for (const t of plan.app.threads || []) {
  const add = t.add.map((n) => id.get(n)).filter(Boolean);
  const remove = t.remove.map((n) => id.get(n)).filter(Boolean);
  out.push({ json: { thread_id: t.thread_id, body: { addLabelIds: add, removeLabelIds: remove } } });
}
return out.length ? out : [{ json: { none: true } }];`;

/** The app's answer: what each thread should wear. mode "live" makes the app remember what it handed out. */
export const askApp = ({ app, secret, mode, x, y }) => ({
  id: "labels-ask", name: "Ask the app", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [x, y],
  onError: "continueRegularOutput",
  parameters: { method: "POST", url: `${app}/api/bot/labels`, sendHeaders: true, headerParameters: { parameters: [{ name: "x-webhook-secret", value: secret }] },
    sendBody: true, specifyBody: "json", jsonBody: JSON.stringify({ mode }), options: { timeout: 120000 } },
});

/** The first three steps, shared by the live chain and the dry run. */
export function headNodes({ app, secret, mode, x = 0, y = 0 }) {
  return [
    askApp({ app, secret, mode, x, y }),
    gmailReq("labels-list", "List labels", x + 220, y, "GET", `${G}/labels`),
    { id: "labels-plan", name: "Plan labels", type: "n8n-nodes-base.code", typeVersion: 2, position: [x + 440, y], parameters: { jsCode: PLAN_CODE } },
  ];
}

/** The live chain, entered at "Ask the app". */
export function labelChain({ app, secret, x = 0, y = 0 }) {
  const n = (dx, dy) => [x + dx, y + dy];
  const code = (id, name, dx, dy, jsCode) => ({ id, name, type: "n8n-nodes-base.code", typeVersion: 2, position: n(dx, dy), parameters: { jsCode } });
  const nodes = [
    ...headNodes({ app, secret, mode: "live", x, y }),
    code("labels-ren", "Each rename", 660, -160, "const p = $('Plan labels').first().json; const labels = $('List labels').first().json.labels || []; return p.renames.map((r) => ({ json: { id: labels.find((l) => l.name === r.from).id, name: r.to } }));"),
    gmailReq("labels-rename", "Rename label", x + 880, y - 160, "PATCH", `=${G}/labels/{{ $json.id }}`, "={{ JSON.stringify({ name: $json.name }) }}"),
    code("labels-cre", "Each new label", 660, 0, "const p = $('Plan labels').first().json; return p.creates.map((c) => ({ json: c }));"),
    gmailReq("labels-create", "Create label", x + 880, y, "POST", `${G}/labels`, "={{ JSON.stringify({ name: $json.name, labelListVisibility: 'labelShow', messageListVisibility: 'show', color: $json.color }) }}"),
    code("labels-after", "After labels", 1100, 0, "return [{ json: {} }];"),
    gmailReq("labels-again", "List labels again", x + 1320, y, "GET", `${G}/labels`),
    code("labels-apply", "Each thread", 1540, 0, APPLY_CODE),
    { id: "labels-has", name: "Any thread?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: n(1760, 0),
      parameters: { conditions: { options: { caseSensitive: true, typeValidation: "loose", version: 2 }, combinator: "and",
        conditions: [{ id: "c1", leftValue: "={{ $json.thread_id }}", rightValue: "", operator: { type: "string", operation: "notEmpty", singleValue: true } }] }, options: {} } },
    gmailReq("labels-modify", "Label thread", x + 1980, y, "POST", `=${G}/threads/{{ $json.thread_id }}/modify`, "={{ JSON.stringify($json.body) }}", true),
    // A thread Gmail refused is reported back, and the app forgets it handed it out, so the next
    // minute sends it again instead of the next full resend an hour later.
    code("labels-failed", "Refused threads", 2200, 0, "const sent = $('Any thread?').all(); const failed = $input.all().map((x, k) => (x.json && x.json.error ? sent[k]?.json.thread_id : null)).filter(Boolean); return failed.length ? [{ json: { failed } }] : [];"),
    { id: "labels-report", name: "Report refused", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: n(2420, 0), onError: "continueRegularOutput",
      parameters: { method: "POST", url: `${app}/api/bot/labels`, sendHeaders: true, headerParameters: { parameters: [{ name: "x-webhook-secret", value: secret }] },
        sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({ mode: 'failed', failed: $json.failed }) }}", options: { timeout: 60000 } } },
    code("labels-stripi", "Each stripped label", 1540, 200, "const p = $('Plan labels').first().json; return p.strip.map((s) => ({ json: s }));"),
    gmailReq("labels-find", "Find stripped threads", x + 1760, y + 200, "GET", `=${G}/threads?maxResults=100&labelIds={{ $json.id }}`),
    code("labels-eachs", "Each stripped thread", 1980, 200, "const labels = $('Each stripped label').all(); const out = []; $input.all().forEach((x, k) => { for (const t of x.json.threads || []) out.push({ json: { thread_id: t.id, label_id: labels[k]?.json.id } }); }); return out;"),
    gmailReq("labels-strip", "Strip label", x + 2200, y + 200, "POST", `=${G}/threads/{{ $json.thread_id }}/modify`, "={{ JSON.stringify({ removeLabelIds: [$json.label_id] }) }}", true),
  ];
  const to = (node) => ({ node, type: "main", index: 0 });
  const connections = {
    "Ask the app": { main: [[to("List labels")]] },
    "List labels": { main: [[to("Plan labels")]] },
    // Renames and creates finish before Gmail's labels are listed again (execution order v1 runs
    // a node's outputs depth first, in this order).
    "Plan labels": { main: [[to("Each rename"), to("Each new label"), to("After labels")]] },
    "Each rename": { main: [[to("Rename label")]] },
    "Each new label": { main: [[to("Create label")]] },
    "After labels": { main: [[to("List labels again")]] },
    "List labels again": { main: [[to("Each thread"), to("Each stripped label")]] },
    "Each thread": { main: [[to("Any thread?")]] },
    "Any thread?": { main: [[to("Label thread")], []] },
    "Label thread": { main: [[to("Refused threads")]] },
    "Refused threads": { main: [[to("Report refused")]] },
    "Each stripped label": { main: [[to("Find stripped threads")]] },
    "Find stripped threads": { main: [[to("Each stripped thread")]] },
    "Each stripped thread": { main: [[to("Strip label")]] },
  };
  return { nodes, connections, entry: "Ask the app" };
}
