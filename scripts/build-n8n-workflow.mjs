// ============================================================================
// PHASE C2/C3 — generate the NEW n8n trigger workflow that feeds the Vercel
// engine. This is a NEW workflow (never touch the 3 live ones). The brain lives
// on Vercel now, so this workflow only:
//   real-time:  Gmail Trigger -> Get Thread -> Build Inbound Payload
//               -> POST /api/n8n-inbound -> (if reply) Build Reply MIME
//               -> create Gmail draft (raw RFC-2822, In-Reply-To threaded)
//   nightly:    Schedule (03:00) -> search last 48h -> Get Thread -> (same tail)
//               idempotency at the engine makes the re-POST free (never-miss).
//
// Node shapes (trigger v1.3, thread get v2.2, raw drafts POST, MIME builder)
// are ported from the live "Email SamurAI v3.4 Spartan Crew Bookings" export so
// this imports and runs like the real thing. Credentials + the webhook secret
// are left as placeholders for Ben to wire in the n8n UI (see the sticky note).
//
// Run:  node scripts/build-n8n-workflow.mjs
// Out:  n8n/spartan-inbound-trigger.workflow.json  (import into n8n Cloud)
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./_env.mjs";

const VERCEL_URL = "https://spartan-crew-jobber.vercel.app/api/n8n-inbound";
// The BOOKINGS Gmail OAuth cred from the live export — auto-links if present in
// Ben's instance; otherwise n8n prompts to re-select on import.
const GMAIL_CRED = { id: "bgRJXZINuY5e6a3x", name: "BOOKINGS 5/18/26" };

// ---- shared code-node bodies ----------------------------------------------

const BUILD_INBOUND = `
// Turn a hydrated Gmail thread into the engine's inbound payload:
//   { thread_id, messages:[{message_id,from,to[],date_iso,subject,body}] }
// plus reply metadata for threading the draft.
const thread = $input.first().json;
const messages = Array.isArray(thread.messages) ? thread.messages : [];

function decodeB64(d){ if(!d) return ''; return Buffer.from(d.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf-8'); }
function stripHtml(h){ return h.replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi,'').replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi,'').replace(/<\\/?[^>]+>/gi,'').replace(/\\s+/g,' ').trim(); }
function extractBody(p){
  if(!p) return '';
  if(Array.isArray(p.parts)){
    const t=p.parts.find(x=>x.mimeType==='text/plain'); if(t?.body?.data) return decodeB64(t.body.data);
    const h=p.parts.find(x=>x.mimeType==='text/html'); if(h?.body?.data) return decodeB64(h.body.data);
    for(const c of p.parts){ const b=extractBody(c); if(b) return b; }
  }
  if(p.body?.data) return decodeB64(p.body.data);
  return '';
}
function clean(raw){
  if(!raw) return '';
  let t=raw.split(/\\nOn .*wrote:\\n/i)[0];
  t=t.split('\\n').filter(l=>!l.trim().startsWith('>')).join('\\n');
  t=t.replace(/\\[image:[^\\]]+\\]/gi,'');
  const markers=['spartan crew ltd','operations spartan crew','www.spartancrew.co.uk','03333 053374','unit 7 titan business estate'];
  for(const m of markers){ const i=t.toLowerCase().indexOf(m); if(i!==-1) t=t.slice(0,i); }
  return stripHtml(t);
}
function hdr(p,name){ const hs=p?.headers||[]; const f=hs.find(h=>(h.name||'').toLowerCase()===name.toLowerCase()); return f?f.value:''; }
function addr(v){ const m=(v||'').match(/<([^>]+)>/); return (m?m[1]:v||'').trim().toLowerCase(); }

const rows = messages.map(m=>{
  const p=m.payload;
  const dateIso = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : (hdr(p,'Date')||new Date().toISOString());
  return {
    message_id: hdr(p,'Message-ID') || m.id,
    from: addr(hdr(p,'From')),
    to: (hdr(p,'To')||'').split(',').map(addr).filter(Boolean),
    date_iso: dateIso,
    subject: hdr(p,'Subject'),
    body: clean(extractBody(p) || m.snippet || ''),
    _epoch: Number(m.internalDate)||0,
    _rfcid: hdr(p,'Message-ID')
  };
});
rows.sort((a,b)=>a._epoch-b._epoch);
const latest = rows[rows.length-1] || {};

return [{ json: {
  thread_id: thread.id || latest.message_id || '',
  messages: rows.map(({_epoch,_rfcid,...r})=>r),
  reply_to_email: latest.from || '',
  in_reply_to_message_id: latest._rfcid || '',
  latest_subject: latest.subject || ''
}}];
`.trim();

const SPARTAN_SIGNATURE = `<table width="600" border="0" cellspacing="0" cellpadding="0" style="font-family:Arial,Helvetica,sans-serif;width:600px;color:#1d1d1b"><tbody><tr><td width="200" style="padding:0;vertical-align:top"><a href="https://spartancrew.co.uk/" target="_blank" style="border:none;text-decoration:none"><img src="https://designexpert44.com/signature/july23/spartan_crew/logo.png" width="180" height="44" alt="Spartan Crew" style="display:block;border:0"></a></td><td width="400" style="padding-left:15px;border-left:2px solid #c72017;vertical-align:top"><p style="margin:0 0 4px 0;font-size:16px;line-height:1.2;color:#222"><strong>Spartan Crew</strong></p><p style="margin:0 0 4px 0;font-size:16px;line-height:1.2;color:#c72017"><strong>Bookings</strong></p><p style="margin:0 0 8px 0;font-size:12px;line-height:1.2"><strong>Spartan Crew Ltd.</strong></p><p style="margin:0 0 4px 0;font-size:12px;line-height:1.4"><a href="tel:03333053374" style="color:#1d1d1b;text-decoration:none">03333 053374</a></p><p style="margin:0 0 4px 0;font-size:12px;line-height:1.4"><a href="https://spartancrew.co.uk/" style="color:#1d1d1b;text-decoration:none">www.spartancrew.co.uk</a></p><p style="margin:0 0 8px 0;font-size:12px;line-height:1.4">Unit 7 Titan Business Estate, Ffinch Street, London SE8 5QA</p></td></tr></tbody></table>`;

const BUILD_REPLY = `
// Build a raw RFC-2822 reply from the engine's composed reply and thread it
// with In-Reply-To/References = the latest message's Message-ID.
const resp = $input.first().json;
const meta = $('Build Inbound Payload').item.json;
const html = resp?.reply?.html || '';
const subject = resp?.reply?.subject || ('Re: ' + (meta.latest_subject||''));
const to = meta.reply_to_email;
const inReplyTo = meta.in_reply_to_message_id;
const threadId = meta.thread_id;
const fromEmail = 'bookings@spartancrew.co.uk';
const signature = ${JSON.stringify(SPARTAN_SIGNATURE)};
const htmlBody = '<html><body>' + html + '<br>' + signature + '</body></html>';
const lines = ['From: ' + fromEmail, 'To: ' + to, 'Subject: ' + subject];
if (inReplyTo) { lines.push('In-Reply-To: ' + inReplyTo, 'References: ' + inReplyTo); }
lines.push('MIME-Version: 1.0', 'Content-Type: text/html; charset="UTF-8"', '', htmlBody);
const raw = Buffer.from(lines.join('\\r\\n')).toString('base64').replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
return [{ json: { raw, threadId } }];
`.trim();

// ---- nodes -----------------------------------------------------------------

let idc = 0;
const nid = () => "node-" + ++idc;

const nodes = [
  {
    parameters: {
      pollTimes: { item: [{ mode: "everyMinute" }] },
      simple: false,
      filters: { readStatus: "unread" },
    },
    type: "n8n-nodes-base.gmailTrigger",
    typeVersion: 1.3,
    position: [-800, 0],
    id: nid(),
    name: "Poll New Mail",
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
  {
    parameters: {
      rule: { interval: [{ field: "days", triggerAtHour: 3 }] },
    },
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [-800, 320],
    id: nid(),
    name: "Nightly Backstop",
  },
  {
    parameters: {
      resource: "message",
      operation: "getAll",
      returnAll: true,
      filters: { receivedAfter: "={{ $now.minus({ hours: 48 }).toISO() }}" },
    },
    type: "n8n-nodes-base.gmail",
    typeVersion: 2.2,
    position: [-560, 320],
    id: nid(),
    name: "Search Last 48h",
    credentials: { gmailOAuth2: GMAIL_CRED },
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
    position: [-280, 160],
    id: nid(),
    name: "Get Thread",
    credentials: { gmailOAuth2: GMAIL_CRED },
    onError: "continueRegularOutput",
  },
  {
    parameters: { mode: "runOnceForEachItem", jsCode: BUILD_INBOUND },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [0, 160],
    id: nid(),
    name: "Build Inbound Payload",
  },
  {
    parameters: {
      method: "POST",
      url: VERCEL_URL,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-webhook-secret", value: "REPLACE_WITH_N8N_WEBHOOK_SECRET" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ thread_id: $json.thread_id, messages: $json.messages }) }}",
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [280, 160],
    id: nid(),
    name: "POST to Engine",
    onError: "continueRegularOutput",
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: "loose", version: 2 },
        conditions: [
          {
            id: "reply-present",
            leftValue: "={{ $json.reply?.html || '' }}",
            rightValue: "",
            operator: { type: "string", operation: "notEmpty", singleValue: true },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [560, 160],
    id: nid(),
    name: "Reply To Draft?",
  },
  {
    parameters: { mode: "runOnceForEachItem", jsCode: BUILD_REPLY },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [840, 80],
    id: nid(),
    name: "Build Reply MIME",
  },
  {
    parameters: {
      method: "POST",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "gmailOAuth2",
      sendBody: true,
      bodyParameters: {
        parameters: [
          { name: "message.raw", value: "={{ $json.raw }}" },
          { name: "message.threadId", value: "={{ $json.threadId }}" },
        ],
      },
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1120, 80],
    id: nid(),
    name: "Create Gmail Draft",
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
  {
    parameters: {
      content:
        "## Spartan Crew — Inbound Trigger (NEW)\n\n" +
        "The brain runs on Vercel. This workflow only feeds it and drafts the reply.\n\n" +
        "**Before activating:**\n" +
        "1. Select the BOOKINGS Gmail OAuth credential on **Poll New Mail**, **Search Last 48h**, **Get Thread**, **Create Gmail Draft**.\n" +
        "2. On **POST to Engine**, set header `x-webhook-secret` to the value of `N8N_WEBHOOK_SECRET` (same value set on Vercel).\n" +
        "3. Confirm the URL points at the live deploy.\n" +
        "4. Draft-only: the engine STAGES orders; it never writes to OnSinch until Ben flips order_mode. Replies are created as Gmail drafts, not sent.\n\n" +
        "Nightly 03:00 sweep re-POSTs the last 48h — idempotency makes it a free never-miss backstop.",
      width: 420,
      height: 320,
      color: 4,
    },
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position: [-280, -280],
    id: nid(),
    name: "Setup",
  },
];

// ---- connections -----------------------------------------------------------
const conn = (from, to) => ({ [from]: { main: [[{ node: to, type: "main", index: 0 }]] } });
const connections = Object.assign(
  {},
  conn("Poll New Mail", "Get Thread"),
  conn("Nightly Backstop", "Search Last 48h"),
  conn("Search Last 48h", "Get Thread"),
  conn("Get Thread", "Build Inbound Payload"),
  conn("Build Inbound Payload", "POST to Engine"),
  conn("POST to Engine", "Reply To Draft?"),
  // IF: output 0 = true branch
  { "Reply To Draft?": { main: [[{ node: "Build Reply MIME", type: "main", index: 0 }]] } },
  conn("Build Reply MIME", "Create Gmail Draft")
);

const workflow = {
  name: "Spartan Crew — Inbound Trigger (Vercel Engine)",
  nodes,
  connections,
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const dir = join(ROOT_DIR, "n8n");
mkdirSync(dir, { recursive: true });
const file = join(dir, "spartan-inbound-trigger.workflow.json");
writeFileSync(file, JSON.stringify(workflow, null, 2));
console.log(`Wrote ${file}`);
console.log(`Import into n8n Cloud, wire creds + the webhook secret (see the Setup sticky note), then activate.`);
