// ============================================================================
// The Gmail draft webhook: the last piece stopping replies from working.
// ----------------------------------------------------------------------------
// The engine composes a reply and then has nowhere to put it. deps.ts posts the
// composed reply to GMAIL_DRAFT_WEBHOOK, that variable has never been set, and
// createReplyDraft has been returning "return-to-caller" — so replies_drafted has
// read 0 for 90 days even when the setting was on. Gmail credentials live in n8n
// and cannot be read out of it (the public API returns credential metadata only,
// never the token), so the draft has to be created there.
//
// This installs a STANDALONE workflow. It creates nothing else, patches nothing
// else, and matches its own workflow by name so re-running updates rather than
// piling up duplicates. The live bookings workflow is never touched.
//
// WHY THE ENGINE SENDS SO LITTLE. The action carries {subject, html, in_reply_to},
// where in_reply_to is the GMAIL message id. Threading a reply properly also needs
// the recipient, the Gmail threadId and the RFC Message-ID header, none of which
// the engine holds — so this workflow asks Gmail for them, by id, in one call.
// Gmail facts are resolved in the Gmail layer, and the engine needs no redeploy.
//
// The reply BODY is generated in the project, never here. n8n is a pair of hands:
// it fetches the headers, wraps the HTML in RFC-2822 and posts a draft. Whether a
// reply is composed at all stays with Settings.replies_enabled on the dashboard,
// which is OFF by default (Ben, 2026-08-09: "disabled by default").
//
// A DRAFT IS NOT A SEND. This creates drafts only. Settings.reply_delivery is a
// separate switch and nothing here can send anything.
//
//   node scripts/install-reply-draft-workflow.mjs             # install / update
//   node scripts/install-reply-draft-workflow.mjs --activate  # + activate (needed)
//   node scripts/install-reply-draft-workflow.mjs --status
//   node scripts/install-reply-draft-workflow.mjs --test <gmailMessageId>
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const SECRET = requireEnv("N8N_WEBHOOK_SECRET");
const h = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };

const argv = process.argv.slice(2);
const ACTIVATE = argv.includes("--activate");
const STATUS_ONLY = argv.includes("--status");
const TEST_ID = argv.includes("--test") ? String(argv[argv.indexOf("--test") + 1] || "") : "";
/** The ops-email shape: an address and no in_reply_to. Drafts, never sends. */
const TEST_TO = argv.includes("--test-internal") ? String(argv[argv.indexOf("--test-internal") + 1] || "") : "";

const WF_NAME = "Spartan Engine — Reply Draft";
const PATH = "spartan-reply-draft";

/**
 * The Gmail credential the ACTIVE bookings workflow uses, so it is known to work
 * today. n8n cannot hand out the token, only reference the credential by id.
 */
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

const api = async (path, init) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...h, ...(init?.headers || {}) } });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`${init?.method || "GET"} ${path} -> ${r.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
};

// Spartan's signature, ported verbatim from the live workflow's draft branch.
const SIGNATURE =
  '<table width="600" border="0" cellspacing="0" cellpadding="0" style="font-family:Arial,Helvetica,sans-serif;width:600px;color:#1d1d1b"><tbody><tr>' +
  '<td width="200" style="padding:0;vertical-align:top"><a href="https://spartancrew.co.uk/" target="_blank" style="border:none;text-decoration:none">' +
  '<img src="https://designexpert44.com/signature/july23/spartan_crew/logo.png" width="180" height="44" alt="Spartan Crew" style="display:block;border:0"></a></td>' +
  '<td width="400" style="padding-left:15px;border-left:2px solid #c72017;vertical-align:top">' +
  '<p style="margin:0 0 4px 0;font-size:16px;line-height:1.2;color:#222"><strong>Spartan Crew</strong></p>' +
  '<p style="margin:0 0 4px 0;font-size:16px;line-height:1.2;color:#c72017"><strong>Bookings</strong></p>' +
  '<p style="margin:0 0 8px 0;font-size:12px;line-height:1.2"><strong>Spartan Crew Ltd.</strong></p>' +
  '<p style="margin:0 0 4px 0;font-size:12px;line-height:1.4"><a href="tel:03333053374" style="color:#1d1d1b;text-decoration:none">03333 053374</a></p>' +
  '<p style="margin:0 0 4px 0;font-size:12px;line-height:1.4"><a href="https://spartancrew.co.uk/" style="color:#1d1d1b;text-decoration:none">www.spartancrew.co.uk</a></p>' +
  '<p style="margin:0 0 8px 0;font-size:12px;line-height:1.4">Unit 7 Titan Business Estate, Ffinch Street, London SE8 5QA</p>' +
  "</td></tr></tbody></table>";

const GUARD_CODE = `
// Authenticate, and fail CLOSED. An unauthenticated caller must not be able to put
// a draft in Spartan's mailbox, so a wrong or missing secret throws rather than
// falling through to the Gmail nodes.
const req = $input.first().json;
const given = (req.headers || {})['x-webhook-secret'] || '';
if (given !== ${JSON.stringify(SECRET)}) {
  throw new Error('spartan-reply-draft: bad or missing x-webhook-secret');
}
const body = req.body || {};
if (!body.html) throw new Error('spartan-reply-draft: html is required');
// TWO KINDS OF CALLER, told apart by which of these is present.
//   in_reply_to  a GMAIL message id -> reply INTO that client thread
//   to           an address         -> a fresh, unthreaded draft to ops
// Neither means a draft addressed to nobody, which is worse than none. Both would
// be ambiguous about whether the client sees it, so it is refused rather than
// guessed: the cross-thread email to ops must never land in a client's thread.
if (!body.in_reply_to && !body.to) {
  throw new Error('spartan-reply-draft: one of in_reply_to (gmail message id) or to (address) is required');
}
if (body.in_reply_to && body.to) {
  throw new Error('spartan-reply-draft: in_reply_to and to are mutually exclusive — a threaded reply cannot be readdressed');
}
return [{ json: {
  in_reply_to: body.in_reply_to ? String(body.in_reply_to) : '',
  to: body.to ? String(body.to) : '',
  subject: body.subject || '',
  html: body.html,
} }];
`.trim();

const MIME_CODE = `
// Build the RFC-2822 draft. TWO SHAPES, and which one is decided by whether the
// header lookup upstream found a message, NOT by re-reading the request:
//
//   a client REPLY  — headers present. Threading comes from the ORIGINAL message's
//     Message-ID header rather than the Gmail id, because In-Reply-To/References
//     are what every other mail client threads on, and threadId is what Gmail
//     itself uses. Both are set.
//   an ops EMAIL    — no headers, because there is no original: the cross-thread
//     "is this one job or two?" mail carries an address and no in_reply_to. It gets
//     no In-Reply-To and no threadId, so it CANNOT land in a client's thread. That
//     is the one way this email could do harm rather than merely fail to arrive.
//
// Get Original Headers passes its failures through (onError: continueRegularOutput)
// so the unthreaded case reaches this node at all. That means a GENUINE Gmail
// failure on a client reply also arrives here with no headers — and it must not
// quietly become an unaddressed draft, so with neither headers nor a 'to' this
// throws. The engine fails closed on a response carrying no draftId.
const meta = $input.first().json;
const req = $('Check secret').first().json;

const headers = {};
for (const hh of (meta.payload && meta.payload.headers) || []) headers[String(hh.name).toLowerCase()] = hh.value;
const found = Object.keys(headers).length > 0;

if (!found && !req.to) {
  throw new Error('spartan-reply-draft: message ' + req.in_reply_to + ' returned no headers and no "to" was given — refusing to draft to nobody');
}

// Reply to whoever asked. Reply-To wins over From when the sender set one.
const replyTo = found ? (headers['reply-to'] || headers['from'] || '') : req.to;
if (!replyTo) throw new Error('spartan-reply-draft: no recipient could be determined');

const rfcId = found ? (headers['message-id'] || '') : '';
const threadId = found ? meta.threadId : null;
const origSubject = headers['subject'] || '';
const subject = req.subject || (found ? (/^re:/i.test(origSubject) ? origSubject : 'Re: ' + origSubject) : '(no subject)');

const htmlBody = '<html><body>' + req.html + '<br>' + ${JSON.stringify(SIGNATURE)} + '</body></html>';
const lines = ['From: bookings@spartancrew.co.uk', 'To: ' + replyTo, 'Subject: ' + subject];
if (rfcId) lines.push('In-Reply-To: ' + rfcId, 'References: ' + rfcId);
lines.push('MIME-Version: 1.0', 'Content-Type: text/html; charset="UTF-8"', '', htmlBody);

const raw = Buffer.from(lines.join('\\r\\n')).toString('base64')
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
return [{ json: { raw, threadId, to: replyTo, subject } }];
`.trim();

const nodes = [
  {
    parameters: { httpMethod: "POST", path: PATH, responseMode: "responseNode", options: {} },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 0],
    id: "node-1",
    name: "Draft Request",
    webhookId: "spartan-reply-draft-hook",
  },
  {
    parameters: { mode: "runOnceForAllItems", jsCode: GUARD_CODE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
    id: "node-2",
    name: "Check secret",
    /**
     * A thrown guard leaves n8n answering HTTP 200 with an empty body, which is
     * indistinguishable from success to anything that does not inspect the body.
     * Verified live: an unauthenticated POST got 200 while the run stopped here and
     * created nothing. Routing the failure to its own response makes the refusal
     * legible instead of silent.
     */
    onError: "continueErrorOutput",
  },
  {
    parameters: {
      respondWith: "json",
      responseBody: '={{ JSON.stringify({ error: "refused", reason: $json.error ? $json.error.message : "rejected" }) }}',
      // responseCode lives under options on respondToWebhook v1.1; set at the top
      // level it is silently ignored and the refusal answers 200.
      options: { responseCode: 401 },
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [440, 200],
    id: "node-7",
    name: "Refuse",
  },
  {
    // Ask Gmail for the one message the engine acted on. `format=metadata` keeps the
    // response small: we need four headers, not the body we already have.
    parameters: {
      url: "=https://gmail.googleapis.com/gmail/v1/users/me/messages/{{ $json.in_reply_to }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "gmailOAuth2",
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: "format", value: "metadata" },
          { name: "metadataHeaders", value: "Message-ID" },
          { name: "metadataHeaders", value: "From" },
          { name: "metadataHeaders", value: "Reply-To" },
          { name: "metadataHeaders", value: "Subject" },
        ],
      },
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [440, 0],
    id: "node-3",
    name: "Get Original Headers",
    credentials: { gmailOAuth2: GMAIL_CRED },
    /**
     * A FAILED LOOKUP IS PASSED DOWNSTREAM rather than ending the run, because the
     * ops email has no original message to look up: it carries an address and no
     * in_reply_to, so this node requests /messages/ and gets a 404. Ending the run
     * there is why the cross-thread email to ops has never once arrived.
     *
     * The wasted 404 buys the whole feature without a second branch, a second code
     * node or any rewiring — the shape of edit that has broken this workflow before.
     * "Build Reply MIME" decides which draft to build from whether headers came
     * back, and throws when there are neither headers nor a recipient, so a real
     * Gmail outage on a client reply still fails loudly instead of drafting to
     * nobody.
     */
    onError: "continueRegularOutput",
  },
  {
    parameters: { mode: "runOnceForAllItems", jsCode: MIME_CODE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [660, 0],
    id: "node-4",
    name: "Build Reply MIME",
    /**
     * Its refusals answer 401 like the guard's, for the same reason: a throw here
     * otherwise leaves n8n answering 200 with an EMPTY BODY, which is the shape a
     * caller cannot tell from success. The engine does check for a draftId and so
     * fails closed either way, but "refused, and why" is what a human reads when
     * asking why no draft appeared.
     */
    onError: "continueErrorOutput",
  },
  {
    parameters: {
      method: "POST",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "gmailOAuth2",
      sendBody: true,
      specifyBody: "json",
      // threadId is OMITTED, not sent as null, when there is no thread: Gmail rejects
      // a null threadId, and the ops email deliberately has none.
      jsonBody:
        '={{ JSON.stringify({ message: $json.threadId ? { raw: $json.raw, threadId: $json.threadId } : { raw: $json.raw } }) }}',
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [880, 0],
    id: "node-5",
    name: "Create Gmail Draft",
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
  {
    // The engine reads j.draftId off this. Anything else and it records "drafted",
    // which would hide a failure as a success.
    parameters: {
      respondWith: "json",
      responseBody: '={{ JSON.stringify({ draftId: $json.id, threadId: $json.message ? $json.message.threadId : null }) }}',
      options: {},
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [1100, 0],
    id: "node-6",
    name: "Return draftId",
  },
];

const connections = {
  "Draft Request": { main: [[{ node: "Check secret", type: "main", index: 0 }]] },
  // Output 0 is the happy path, output 1 is the error branch created by
  // onError: continueErrorOutput on "Check secret".
  "Check secret": {
    main: [
      [{ node: "Get Original Headers", type: "main", index: 0 }],
      [{ node: "Refuse", type: "main", index: 0 }],
    ],
  },
  "Get Original Headers": { main: [[{ node: "Build Reply MIME", type: "main", index: 0 }]] },
  // Output 1 is the error branch created by onError on "Build Reply MIME", so a
  // draft it refuses to build answers 401 rather than an empty 200.
  "Build Reply MIME": {
    main: [
      [{ node: "Create Gmail Draft", type: "main", index: 0 }],
      [{ node: "Refuse", type: "main", index: 0 }],
    ],
  },
  "Create Gmail Draft": { main: [[{ node: "Return draftId", type: "main", index: 0 }]] },
};

// n8n RETURNS settings keys it then refuses to accept back, so only send these.
const settings = { executionOrder: "v1" };

const hookUrl = `${BASE.replace(/\/api\/v1$/, "")}/webhook/${PATH}`;

const list = await api("/workflows?limit=250");
const existing = (list.data || []).find((w) => w.name === WF_NAME);

if (STATUS_ONLY) {
  console.log(existing ? `installed: ${existing.id}  active=${existing.active}` : "not installed");
  console.log(`webhook: POST ${hookUrl}`);
  process.exit(0);
}

if (TEST_TO) {
  const r = await fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify({
      to: TEST_TO,
      subject: "Spartan engine — internal draft connectivity test",
      html: "<p>This is the ops-email path (no in_reply_to). It is a DRAFT and has not been sent. Safe to delete.</p>",
    }),
  });
  const text = await r.text();
  console.log(`${r.status} ${text}`);
  // A 200 carrying no draftId is the failure this whole path exists to stop being
  // reported as success, so it exits non-zero.
  let hasId = false;
  try { hasId = Boolean(JSON.parse(text).draftId); } catch { hasId = false; }
  if (r.ok && !hasId) console.log("FAILED: 200 with no draftId — the run stopped before Gmail");
  process.exit(r.ok && hasId ? 0 : 1);
}

if (TEST_ID) {
  const r = await fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify({
      in_reply_to: TEST_ID,
      subject: "",
      html: "<p>This is a connectivity test from the Spartan engine. It is a DRAFT and has not been sent. Safe to delete.</p>",
    }),
  });
  console.log(`${r.status} ${await r.text()}`);
  process.exit(r.ok ? 0 : 1);
}

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
  // A PUT can clear the active flag, so read it back rather than trusting the response.
  const live = await api(`/workflows/${wf.id}`);
  console.log(`activated: ${live.active}`);
}

console.log(`\nwebhook: POST ${hookUrl}`);
console.log("set this on Vercel as GMAIL_DRAFT_WEBHOOK, then flip replies_enabled on the dashboard.");
