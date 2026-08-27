// ============================================================================
// Generate the 12-month sweep workflow: Gmail -> /api/sweep-ingest.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS AGAIN. The sweep was built to run from the terminal instead of
// n8n, to avoid thousands of executions. That needed our own Google OAuth client,
// and there isn't one — Google has no password-based API access, and n8n's Gmail
// credential cannot be read back out of it (the public API returns credential
// metadata only, never the token).
//
// So the sweep runs where a working Gmail authorisation already exists: inside
// n8n, borrowing the same BOOKINGS credential the live workflow uses. This is a
// NEW workflow. It never touches the three live ones, and it is read-only on the
// mailbox: list and get, no label, no send, no delete — so the live workflow's
// label ledger is undisturbed.
//
// One execution sweeps ONE window, so a year is 12 runs rather than 12 months of
// mail in a single run that could exhaust memory. The window is passed in when the
// webhook is called, so the caller decides the pace.
//
// It posts to /api/sweep-ingest, which only STORES, into sweep_threads. No model
// call, no OnSinch call, no Jobs Board projection — a year of history cannot bury
// today's work or cost a fortune on ingest.
//
// Run:  node scripts/build-sweep-workflow.mjs
// Out:  n8n/spartan-sweep.workflow.json   (installed by scripts/install-sweep-workflow.mjs)
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./_env.mjs";

const INGEST_URL = "https://spartan-crew-jobber.vercel.app/api/sweep-ingest";
// The Gmail credential the live workflow authenticates with TODAY — verified against
// its five Gmail nodes, not copied from the older export. "BOOKINGS 5/18/26"
// (bgRJXZINuY5e6a3x) is the one the first build script still names, and it was
// replaced when the bookings credential was re-authorised; borrowing the dead one
// would fail on the first list. Referenced by id so n8n links it on import.
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
const WEBHOOK_PATH = "spartan-sweep";

let seq = 0;
const nid = () => `sweep-${String(++seq).padStart(4, "0")}`;

// ---------------------------------------------------------------- code nodes

// The window comes from the webhook body so one workflow can sweep any span:
//   { "after": "2025-09-01", "before": "2025-10-01" }   explicit, or
//   { "monthsAgo": 3 }                                  the whole of that month.
//
// The window is emitted twice: as ISO instants, which are what a human reads in the
// execution, and as a Gmail search string in epoch seconds, which is what actually
// filters the list. after is inclusive and before exclusive, so consecutive windows
// meet without a seam or a double-fetch.
const BUILD_WINDOW = `
const body = $input.first().json.body || $input.first().json || {};

let after = body.after, before = body.before;
if (!after || !before) {
  const back = Number(body.monthsAgo);
  if (!Number.isFinite(back)) throw new Error('need {after,before} or {monthsAgo}');
  const now = new Date();
  after = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString();
  before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1)).toISOString();
} else {
  after = new Date(after).toISOString();
  before = new Date(before).toISOString();
}
if (!(new Date(after) < new Date(before))) throw new Error('window ends before it starts: ' + after + ' .. ' + before);
const label = after.slice(0, 10);
// Epoch seconds, not a Y/M/D string: Gmail reads bare dates in the account's own
// timezone, so a BST boundary drifts by an hour, while after:<unix> is an exact
// instant. It goes in the q filter rather than receivedAfter/receivedBefore because
// those were ignored by this node version — the list then tried to return the whole
// mailbox and the execution died out of memory.
const secs = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const q = 'after:' + secs(after) + ' before:' + secs(before);
return [{ json: { after, before, label, q } }];
`.trim();

// Gmail's message list gives a threadId per message, so collapsing to distinct
// threads before fetching turns tens of thousands of message reads into a few
// thousand thread reads.
const DISTINCT_THREADS = `
const all = $input.all();
// A window filter that stops being honoured turns this into "list the whole mailbox",
// which is how the first attempt died out of memory rather than saying anything. No
// real window in this mailbox is anywhere near this size, so a number this big means
// the filter was ignored, not that the month was busy.
if (all.length > 4000) {
  throw new Error('listed ' + all.length + ' messages for one window — the date filter looks ignored, refusing to continue');
}
const seen = new Set();
const out = [];
for (const item of all) {
  const id = item.json.threadId || item.json.id;
  if (!id || seen.has(id)) continue;
  seen.add(id);
  out.push({ json: { threadId: id } });
}
return out;
`.trim();

// A Gmail thread -> the payload shape /api/sweep-ingest stores. Deliberately the
// same mapping as scripts/sweep-gmail.ts so a corpus gathered either way is the
// same corpus: plain text preferred over HTML, recursing past attachments, and
// internalDate over the Date header because a forwarded mail's header lies.
// runOnceForEachItem, so $input.first() is unavailable — n8n refuses it with
// "Can't use .first() here" and the whole month dies at the last step. $input.item
// is the per-item equivalent.
const BUILD_SWEEP_PAYLOAD = `
const thread = $input.item.json;
const messages = Array.isArray(thread.messages) ? thread.messages : [];

function decodeB64(d) {
  if (!d) return '';
  try { return Buffer.from(String(d).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'); }
  catch (e) { return ''; }
}
function stripHtml(h) {
  return h.replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi, '')
          .replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '')
          .replace(/<\\/?[^>]+>/gi, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
}
function bodyOf(part) {
  if (!part) return '';
  if (Array.isArray(part.parts)) {
    const plain = part.parts.find((p) => p.mimeType === 'text/plain');
    if (plain && plain.body && plain.body.data) return decodeB64(plain.body.data);
    const html = part.parts.find((p) => p.mimeType === 'text/html');
    if (html && html.body && html.body.data) return stripHtml(decodeB64(html.body.data));
    for (const p of part.parts) { const n = bodyOf(p); if (n) return n; }
  }
  if (part.body && part.body.data) {
    const raw = decodeB64(part.body.data);
    return part.mimeType === 'text/html' ? stripHtml(raw) : raw;
  }
  return '';
}
// n8n's Gmail node with simple:false FLATTENS the headers onto the message itself
// (m.From, m.To, m.Subject, m.Date) and leaves payload.headers empty. Reading only
// payload.headers produced a corpus of 27,704 messages with no sender and no subject,
// every one of them scored is_from_spartan:false — so the brain could not tell a
// client's request from Spartan's own reply. Top-level first, raw headers as fallback
// for any shape that carries them.
function headerMap(m) {
  const out = {};
  const hs = (m && m.payload && m.payload.headers) || [];
  for (const h of hs) if (h && h.name) out[String(h.name).toLowerCase()] = h.value;
  for (const k of Object.keys(m || {})) {
    const lk = k.toLowerCase();
    if (['from', 'to', 'cc', 'subject', 'date', 'message-id', 'in-reply-to', 'references'].includes(lk)) {
      if (out[lk] === undefined || out[lk] === '') out[lk] = m[k];
    }
  }
  return out;
}
function addr(v) {
  const s = String(v || '');
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}
const SPARTAN = /@spartancrew\\.co\\.uk/i;

const mapped = messages.map((m) => {
  const h = headerMap(m);
  const from = addr(h.from);
  const iso = m.internalDate
    ? new Date(Number(m.internalDate)).toISOString()
    : (h.date ? new Date(h.date).toISOString() : new Date(0).toISOString());
  return {
    message_id: String(m.id || ''),
    from,
    to: String(h.to || '').split(',').map(addr).filter(Boolean),
    date_iso: iso,
    subject: String(h.subject || ''),
    body: bodyOf(m.payload) || String(m.snippet || ''),
    is_from_spartan: SPARTAN.test(from),
  };
});

return { json: { thread_id: String(thread.id), messages: mapped, sweep: { mailbox: 'bookings@spartancrew.co.uk', swept: true } } };
`.trim();

// One POST per thread would be ~20k requests for a year — the mailbox runs about 60
// threads a day. /api/sweep-ingest accepts an array, so threads go up in batches.
// Kept small enough that a batch stays well inside the route's 60s ceiling and a
// failure loses 25 threads rather than a month.
const BATCH_THREADS = `
const SIZE = 25;
const out = [];
const all = $input.all();
for (let i = 0; i < all.length; i += SIZE) {
  out.push({ json: { batch: all.slice(i, i + SIZE).map((it) => it.json) } });
}
return out;
`.trim();

// ---------------------------------------------------------------- nodes
const nodes = [
  {
    parameters: {
      httpMethod: "POST",
      path: WEBHOOK_PATH,
      // Answer as soon as the request lands. A month of mail takes far longer than
      // the 125s Cloudflare allows a webhook response in front of n8n Cloud, and
      // waiting for the last node meant the caller saw a 524 while the sweep's fate
      // was unknown. Progress is read from /api/sweep-ingest instead.
      responseMode: "onReceived",
      options: {},
    },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [-1100, 0],
    id: nid(),
    name: "Sweep Window In",
    webhookId: "spartan-sweep-webhook",
  },
  {
    parameters: { mode: "runOnceForAllItems", jsCode: BUILD_WINDOW },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-880, 0],
    id: nid(),
    name: "Build Window",
  },
  {
    parameters: {
      resource: "message",
      operation: "getAll",
      returnAll: true,
      simple: true,           // list only: ids + threadIds, no bodies yet
      filters: { q: "={{ $json.q }}" },
    },
    type: "n8n-nodes-base.gmail",
    typeVersion: 2.2,
    position: [-660, 0],
    id: nid(),
    name: "List Window",
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
  {
    parameters: { mode: "runOnceForAllItems", jsCode: DISTINCT_THREADS },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-440, 0],
    id: nid(),
    name: "Distinct Threads",
  },
  {
    parameters: {
      resource: "thread",
      operation: "get",
      threadId: "={{ $json.threadId }}",
      simple: false,
      options: { returnOnlyMessages: false },
    },
    type: "n8n-nodes-base.gmail",
    typeVersion: 2.2,
    position: [-220, 0],
    id: nid(),
    name: "Get Thread",
    credentials: { gmailOAuth2: GMAIL_CRED },
    // A single unreadable thread must not abandon the rest of the month.
    onError: "continueRegularOutput",
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
  },
  {
    parameters: { mode: "runOnceForEachItem", jsCode: BUILD_SWEEP_PAYLOAD },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [0, 0],
    id: nid(),
    name: "Build Sweep Payload",
  },
  {
    parameters: { mode: "runOnceForAllItems", jsCode: BATCH_THREADS },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
    id: nid(),
    name: "Batch Threads",
  },
  {
    parameters: {
      method: "POST",
      url: INGEST_URL,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "x-webhook-secret", value: "REPLACE_WITH_N8N_WEBHOOK_SECRET" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.batch) }}",
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [440, 0],
    id: nid(),
    name: "POST to Sweep Ingest",
    // Storing is idempotent on thread_id, so a retry costs nothing and a dropped
    // thread is a hole in the corpus.
    onError: "continueRegularOutput",
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
  },
  {
    parameters: {
      content: [
        "## 12-month sweep -> corpus (TEST DATA)",
        "",
        "Read-only on the mailbox: list + get only. No label, no send, no delete,",
        "so the live workflow's label ledger is untouched.",
        "",
        "Posts to /api/sweep-ingest, which stores into `sweep_threads` and nothing",
        "else — no model call, no OnSinch call, no Jobs Board projection.",
        "",
        "**One run = one window.** Call the webhook with `{\"monthsAgo\": 3}` or",
        "`{\"after\":\"2025/09/01\",\"before\":\"2025/10/01\"}`.",
        "",
        "Set `x-webhook-secret` on the HTTP node to N8N_WEBHOOK_SECRET before use.",
      ].join("\n"),
      height: 320,
      width: 460,
    },
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position: [-1100, -420],
    id: nid(),
    name: "What this is",
  },
];

const chain = ["Sweep Window In", "Build Window", "List Window", "Distinct Threads", "Get Thread", "Build Sweep Payload", "Batch Threads", "POST to Sweep Ingest"];
const connections = {};
for (let i = 0; i < chain.length - 1; i++) {
  connections[chain[i]] = { main: [[{ node: chain[i + 1], type: "main", index: 0 }]] };
}

const workflow = {
  name: "Spartan Sweep — 12 months to corpus",
  nodes,
  connections,
  // Execution saving is set explicitly, not left to the instance default: a sweep
  // that fails silently with no execution to open is unauditable, and the first run
  // recorded nothing at all.
  settings: {
    executionOrder: "v1",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    saveManualExecutions: true,
    saveExecutionProgress: true,
  },
};

mkdirSync(join(ROOT_DIR, "n8n"), { recursive: true });
const out = join(ROOT_DIR, "n8n", "spartan-sweep.workflow.json");
writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log(`wrote ${out}`);
console.log(`nodes: ${nodes.length}   chain: ${chain.join(" -> ")}`);
