// ============================================================================
// n8n Code node body: "Build Engine Payload"
// ----------------------------------------------------------------------------
// The tap node the engine hangs off ("Combine all Email Data") is an EMPTY Set
// node, so "POST to Engine" was posting whatever $json happened to be. The
// engine's intake contract is:
//
//   { thread_id, messages: [{ message_id, from, to[], date_iso, subject, body }] }
//
// Anything else is stored in inbound_raw and never reaches the pipeline. This
// node builds that contract from the Gmail data already in the branch.
//
// Bodies are handed over RAW and uncleaned on purpose: app/lib/engine/normalize.ts
// is a faithful port of the workflow's own cleaner and runs on our side, so
// cleaning here would only give us two cleaners to keep in step.
//
// Lives in the repo (not only inside n8n) so it can be tested without n8n --
// see scripts/test-engine-payload.mjs. Installed by scripts/install-payload-builder.mjs.
//
// Sources, in order of preference:
//   $('Get a thread2')       full Gmail thread resource -> ids, dates, subjects
//   $('Normalize Data')      original_email + thread_history (bodies only)
//   $('Conversational Renderer') / $('Determine if Order')  -> carried as context
// ============================================================================

/** Safely read a node's output; returns null when the node did not run. */
function nodeJson(name) {
  try {
    const item = $(name).item;
    return item && item.json ? item.json : null;
  } catch (e) {
    return null;
  }
}
/** Same, but the node's full item list (for multi-message nodes). */
function nodeAll(name) {
  try {
    return $(name).all().map((i) => i.json);
  } catch (e) {
    return [];
  }
}

function decodeB64(data) {
  if (!data) return '';
  try {
    return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch (e) {
    return '';
  }
}

/** Pull the best body out of a Gmail message payload (prefers text/plain). */
function extractBody(msg) {
  if (!msg) return '';
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text;
  const walk = (part) => {
    if (!part) return '';
    if (Array.isArray(part.parts)) {
      const plain = part.parts.find((p) => p.mimeType === 'text/plain');
      if (plain && plain.body && plain.body.data) return decodeB64(plain.body.data);
      const html = part.parts.find((p) => p.mimeType === 'text/html');
      if (html && html.body && html.body.data) return decodeB64(html.body.data);
      for (const p of part.parts) {
        const nested = walk(p);
        if (nested) return nested;
      }
    }
    if (part.body && part.body.data) return decodeB64(part.body.data);
    return '';
  };
  const body = walk(msg.payload);
  if (body) return body;
  if (typeof msg.snippet === 'string') return msg.snippet;
  return '';
}

// Header names n8n's Gmail node flattens straight onto the message item, in
// their wire casing. Everything here is looked up case-insensitively.
const FLAT_HEADER_KEYS = [
  'From', 'To', 'Cc', 'Bcc', 'Subject', 'Date', 'Message-ID', 'In-Reply-To',
  'References', 'Reply-To', 'Content-Type', 'MIME-Version',
];

function headerMap(msg) {
  const out = {};
  if (!msg) return out;

  const hs = (msg.payload && msg.payload.headers) || [];
  for (const h of hs) if (h && h.name) out[String(h.name).toLowerCase()] = h.value;

  if (msg.headers && typeof msg.headers === 'object') {
    for (const [k, v] of Object.entries(msg.headers)) if (out[k.toLowerCase()] === undefined) out[k.toLowerCase()] = v;
  }

  // The case that actually bit us. "Get a thread" returns messages whose
  // payload has NO headers array (it holds only the MIME parts) and no
  // msg.headers object - the headers are flattened onto the item itself as
  // "From", "To", "Subject", "Date", "Message-ID". Reading only msg.from /
  // msg.subject therefore yielded "" for every real message, so every thread
  // reached the engine with no sender and no subject. The bodies arrived fine,
  // which is why it looked like it was working: three live threads were
  // classified with the sender and subject blanked out.
  for (const k of FLAT_HEADER_KEYS) {
    const lower = k.toLowerCase();
    if (out[lower] !== undefined) continue;
    if (msg[k] !== undefined && msg[k] !== null && msg[k] !== '') out[lower] = msg[k];
    else if (msg[lower] !== undefined && msg[lower] !== null && msg[lower] !== '') out[lower] = msg[lower];
  }
  return out;
}

/** "Ben <ben@x.com>" | {value:[{address}]} | "ben@x.com" -> "ben@x.com" */
function addrOf(v) {
  if (!v) return '';
  if (Array.isArray(v)) return addrOf(v[0]);
  if (typeof v === 'object') {
    if (v.address) return String(v.address).toLowerCase();
    if (v.email) return String(v.email).toLowerCase();
    if (v.value) return addrOf(v.value);
    return '';
  }
  const s = String(v);
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** Split a To/Cc header into addresses. */
function addrList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(addrOf).filter(Boolean);
  return String(v)
    .split(',')
    .map((s) => addrOf(s))
    .filter(Boolean);
}

function toIso(msg, headers) {
  const raw = msg && (msg.internalDate || msg.date);
  if (raw) {
    const n = Number(raw);
    const d = Number.isFinite(n) && String(raw).length >= 10 ? new Date(n) : new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (headers && headers.date) {
    const d = new Date(headers.date);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

const SPARTAN_DOMAINS = ['@spartancrew.co.uk'];
const isSpartan = (from) => SPARTAN_DOMAINS.some((d) => String(from || '').toLowerCase().includes(d));

/** One Gmail message resource -> one engine ThreadMessage. */
function toThreadMessage(msg) {
  const h = headerMap(msg);
  const from = addrOf(msg.from || h.from);
  return {
    message_id: String(msg.id || h['message-id'] || ''),
    from,
    to: addrList(msg.to || h.to),
    date_iso: toIso(msg, h),
    subject: String((msg.subject !== undefined ? msg.subject : h.subject) || ''),
    body: extractBody(msg),
    is_from_spartan: isSpartan(from),
  };
}

// ---------------------------------------------------------------- build
const norm = nodeJson('Normalize Data') || {};
const original = norm.original_email || {};
const threadNode = nodeJson('Get a thread2') || {};
// The classifier node has been rebuilt more than once - it was "Determine if
// Order" (+ Failsafe) as a plain openAi node, and is now an AI Agent feeding
// "Parse Job Determinism Output", with gpt-5 primary and opus 4.6 as fallback.
// nodeJson swallows a missing node, so a rename does not break the run - it just
// silently drops the verdict from the durable record, which is the one field that
// lets anyone compare n8n's judgement against the engine's. Try the current names
// first and keep the old ones so this works against either shape.
const VERDICT_NODES = [
  'Parse Job Determinism Output',
  'AI Agent',
  'Determine if Order',
  'Determine if Order Failsafe',
];
let verdict = {};
let verdict_source = null;
for (const name of VERDICT_NODES) {
  const j = nodeJson(name);
  if (j) { verdict = j; verdict_source = name; break; }
}
const renderer = nodeJson('Conversational Renderer') || {};

const thread_id = String(threadNode.id || original.thread_id || norm.thread_id || $json.threadId || $json.thread_id || '').trim();

// Prefer the full Gmail thread; fall back to the merged hydrated items, then to
// the single original email. Never emit zero messages when we have any content.
let source = Array.isArray(threadNode.messages) && threadNode.messages.length ? threadNode.messages : null;
if (!source) {
  const merged = nodeAll('Merge1').filter((m) => m && (m.id || m.payload || m.text));
  if (merged.length) source = merged;
}

let messages = (source || []).map(toThreadMessage).filter((m) => m.body && m.body.trim());

if (!messages.length && (original.body || original.email_id)) {
  messages = [
    {
      message_id: String(original.email_id || ''),
      from: addrOf(original.from),
      to: [],
      date_iso: new Date().toISOString(),
      subject: String(original.subject || ''),
      body: String(original.body || ''),
      is_from_spartan: isSpartan(original.from),
    },
  ];
}

// The cleaned history Normalize Data produced is bodies-only (no ids or dates),
// so it cannot become a ThreadMessage. Carry it as context rather than drop it.
const history_text = (norm.thread_history && Array.isArray(norm.thread_history.messages))
  ? norm.thread_history.messages
  : [];

messages.sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));

return [
  {
    json: {
      thread_id,
      messages,
      // Everything below is context the engine records for transparency; the
      // contract above is what drives the pipeline.
      n8n: {
        workflow: 'Email SamurAI v3.4 Spartan Crew Bookings',
        latest_message_id: String(original.email_id || (messages.length ? messages[messages.length - 1].message_id : '')),
        // The old openAi node wrapped its answer in message/content; the parse
        // node emits the fields directly (is_job, type_job, job_summary). Fall
        // back to the whole object rather than recording null for a shape we did
        // not anticipate - this field is pure transparency, so keeping too much
        // costs nothing and keeping nothing costs the audit trail.
        verdict: verdict.message || verdict.content || verdict.text || verdict.output ||
          (verdict_source && Object.keys(verdict).length ? verdict : null),
        verdict_source: verdict_source,
        client_information: renderer.client_information || null,
        render_hash: (renderer.metadata && renderer.metadata.render_hash) || null,
        classifications: (renderer.metadata && renderer.metadata.classifications) || null,
        // Read these off the Dedupe Claim node, NOT $json. At this point in the
        // branch $json is the classifier's item, which never carries them, so
        // reading $json silently reported found:false for every message.
        dedupe: (function () {
          const d = nodeJson('Dedupe Claim') || $json || {};
          return {
            found: d.found === true,
            first_seen: d.first_seen === true,
            thread_first_seen: d.thread_first_seen === true,
            thread_message_count: d.thread_message_count || null,
            degraded: d.degraded || null,
          };
        })(),
        history_text,
        message_count: messages.length,
      },
    },
  },
];
