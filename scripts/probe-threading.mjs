// ============================================================================
// Can RFC headers reproduce Gmail's own threading? Ask Gmail, then check.
// ----------------------------------------------------------------------------
// WHY THIS IS THE FIRST THING TO BUILD. The routing-rule intake in
// docs/CREDENTIAL-DURABILITY-PLAN.md removes OAuth from the intake path entirely,
// which is the whole point of it — but it delivers MESSAGES, not threads. Gmail's
// `threadId` never arrives. Everything downstream of intake keys on a thread, so
// the design stands or falls on whether `Message-ID`, `In-Reply-To` and
// `References` group messages the way Gmail does.
//
// That is a question with a free, exact answer: Gmail will hand over both its own
// grouping AND the headers, for the same mail. Reconstruct from the headers, compare
// to the grouping, and count the disagreements. Anything else is an opinion.
//
// READ-ONLY and TEMPORARY. Installs a workflow that lists and gets, borrowing the
// live Gmail credential the way every other tool here does, returns the headers in
// the webhook response, and DELETES ITSELF on the way out — nothing is stored, no
// label is touched, and nothing is left behind in n8n to rot.
//
//   node scripts/probe-threading.mjs [days]      # default 7
//   node scripts/probe-threading.mjs 7 --keep    # leave the workflow installed
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const argv = process.argv.slice(2);
const DAYS = Number(argv.find((a) => /^\d+$/.test(a)) ?? 7);
const KEEP = argv.includes("--keep");
const LIMIT = Number(argv.find((a) => a.startsWith("--threads="))?.split("=")[1] ?? 40);

const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const KEY = requireEnv("N8N_API_KEY");
const h = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };
const WF_NAME = "TEMP threading probe";
const PATH = "spartan-threading-probe";
const GMAIL_CRED = {
  id: process.env.GMAIL_CRED_ID || "6Ab8OMlONlOA9vtG",
  name: process.env.GMAIL_CRED_NAME || "Gmail account 14",
};

async function api(path, init = {}) {
  const r = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * n8n's Gmail node with simple:false FLATTENS headers onto the message and leaves
 * payload.headers empty on some shapes, so both are read — the sweep learned this
 * the expensive way, producing 27,704 messages with no sender at all.
 */
const EXTRACT = `
const out = [];
for (const item of $input.all()) {
  const thread = item.json;
  for (const m of (thread.messages || [])) {
    const hs = {};
    for (const x of ((m.payload && m.payload.headers) || [])) {
      if (x && x.name) hs[String(x.name).toLowerCase()] = x.value;
    }
    for (const k of Object.keys(m || {})) {
      const lk = k.toLowerCase();
      if (['message-id','in-reply-to','references','subject','from','date'].includes(lk)) {
        if (hs[lk] === undefined || hs[lk] === '') hs[lk] = m[k];
      }
    }
    out.push({ json: {
      gmail_thread_id: String(thread.id || ''),
      gmail_message_id: String(m.id || ''),
      rfc_message_id: String(hs['message-id'] || ''),
      in_reply_to: String(hs['in-reply-to'] || ''),
      references: String(hs['references'] || ''),
      subject: String(hs['subject'] || ''),
      from: String(hs['from'] || ''),
      internalDate: String(m.internalDate || ''),
    }});
  }
}
// ONE item carrying the whole array. The webhook node returns only the FIRST item of
// the last node and options.responseData:"allEntries" did not change that here — a run
// that correctly produced 298 messages answered with one. Wrapping sidesteps the
// question entirely and cannot regress.
return [{ json: { count: out.length, rows: out.map((o) => o.json) } }];
`.trim();

const nodes = [
  { id: "hook", name: "Go", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0],
    // responseData:"allEntries" is not optional. The webhook node's default returns the
    // FIRST item of the last node only, so a probe over forty threads answered with one
    // message and looked like a mailbox with nothing in it.
    parameters: { httpMethod: "POST", path: PATH, responseMode: "lastNode", options: { responseData: "allEntries" } } },
  { id: "win", name: "Window", type: "n8n-nodes-base.code", typeVersion: 2, position: [200, 0],
    parameters: { jsCode:
      `const days = Number(($input.first().json.body || {}).days || ${DAYS});\n` +
      `const secs = Math.floor((Date.now() - days * 86400000) / 1000);\n` +
      `return [{ json: { q: 'after:' + secs } }];` } },
  { id: "list", name: "List", type: "n8n-nodes-base.gmail", typeVersion: 2.1, position: [400, 0],
    parameters: { resource: "message", operation: "getAll", returnAll: true, simple: true, filters: { q: "={{ $json.q }}" } },
    credentials: { gmailOAuth2: GMAIL_CRED } },
  // CAPPED, because this responds SYNCHRONOUSLY. n8n Cloud sits behind a proxy that
  // gives up around 100 seconds and answers with an HTML error page rather than JSON —
  // five days of mail is roughly 300 threads and one Gmail read each, which goes
  // straight through that. Forty threads settles a threading question comfortably.
  { id: "uniq", name: "Distinct threads", type: "n8n-nodes-base.code", typeVersion: 2, position: [600, 0],
    parameters: { jsCode:
      `const seen = new Set();\nconst out = [];\n` +
      `for (const i of $input.all()) { const t = i.json.threadId; if (t && !seen.has(t)) { seen.add(t); out.push({ json: { threadId: t } }); } }\n` +
      `return out.slice(0, ${LIMIT});` } },
  { id: "get", name: "Get thread", type: "n8n-nodes-base.gmail", typeVersion: 2.1, position: [800, 0],
    parameters: { resource: "thread", operation: "get", threadId: "={{ $json.threadId }}", simple: false, options: { returnOnlyMessages: false } },
    credentials: { gmailOAuth2: GMAIL_CRED }, onError: "continueRegularOutput" },
  { id: "hdr", name: "Headers", type: "n8n-nodes-base.code", typeVersion: 2, position: [1000, 0],
    parameters: { jsCode: EXTRACT } },
];
const connections = {
  Go: { main: [[{ node: "Window", type: "main", index: 0 }]] },
  Window: { main: [[{ node: "List", type: "main", index: 0 }]] },
  List: { main: [[{ node: "Distinct threads", type: "main", index: 0 }]] },
  "Distinct threads": { main: [[{ node: "Get thread", type: "main", index: 0 }]] },
  "Get thread": { main: [[{ node: "Headers", type: "main", index: 0 }]] },
};

const existing = ((await api("/workflows?limit=250")).data || []).find((w) => w.name === WF_NAME);
if (existing) {
  if (existing.active) await api(`/workflows/${existing.id}/deactivate`, { method: "POST" });
  await api(`/workflows/${existing.id}`, { method: "DELETE" });
}
const wf = await api("/workflows", {
  method: "POST",
  body: JSON.stringify({ name: WF_NAME, nodes, connections, settings: { executionOrder: "v1" } }),
});
await api(`/workflows/${wf.id}/activate`, { method: "POST" });
// Read the flag back rather than trusting the POST, and give n8n a moment: a
// production webhook is registered ASYNCHRONOUSLY after activation, so calling it
// immediately answers 404 "not registered" on a workflow that is about to be fine.
let live = await api(`/workflows/${wf.id}`);
for (let i = 0; i < 10 && !live.active; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  live = await api(`/workflows/${wf.id}`);
}
if (!live.active) throw new Error("workflow did not activate, so its production webhook is not listening");
console.log(`installed ${wf.id}, asking for ${DAYS} day(s) of mail …`);

let rows = [];
try {
  let r, text = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    r = await fetch(`${BASE}/webhook/${PATH}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: DAYS }),
    });
    text = await r.text();
    if (r.status !== 404) break;
    await new Promise((x) => setTimeout(x, 2000));
  }
  if (!r.ok) throw new Error(`webhook ${r.status}: ${text.slice(0, 300)}`);
  // n8n answers 200 with an EMPTY BODY when a workflow throws, which is exactly what
  // a rejected credential looks like. Demand a positive shape rather than trusting 200.
  if (!text.trim()) throw new Error("empty body — the workflow threw (credential? quota?)");
  const j = JSON.parse(text);
  const wrapped = Array.isArray(j) ? j[0] : j;
  rows = wrapped?.rows ?? [];
  if (!rows.length || !rows[0].gmail_thread_id) throw new Error(`unexpected shape: ${text.slice(0, 300)}`);
} finally {
  if (!KEEP) {
    await api(`/workflows/${wf.id}/deactivate`, { method: "POST" }).catch(() => {});
    await api(`/workflows/${wf.id}`, { method: "DELETE" }).catch(() => {});
    console.log("probe workflow removed");
  }
}

mkdirSync(join(ROOT_DIR, ".tmp-data"), { recursive: true });
const out = join(ROOT_DIR, ".tmp-data", "threading-probe.json");
writeFileSync(out, JSON.stringify(rows, null, 1), "utf8");
console.log(`${rows.length} message(s) across ${new Set(rows.map((r) => r.gmail_thread_id)).size} Gmail thread(s) -> ${out}`);
const noId = rows.filter((r) => !r.rfc_message_id).length;
const roots = rows.filter((r) => !r.in_reply_to && !r.references).length;
console.log(`   without an RFC Message-ID: ${noId}   without any parent reference (thread roots): ${roots}`);
