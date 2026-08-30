// ============================================================================
// The intake watchdog: the one alarm that survives Spartan being dead.
// ----------------------------------------------------------------------------
// On 2026-08-26 the Gmail credential expired. The intake failed every five minutes
// for 42 hours and nobody knew. Nothing in the engine threw — mail simply stopped
// arriving — so no amount of error handling inside the engine would have caught it.
// AN ENGINE THAT IS NOT RUNNING CANNOT REPORT THAT IT IS NOT RUNNING, which is why
// this half has to live outside it, on a schedule, in n8n.
//
// THE DIVISION OF LABOUR, and it is the whole design:
//
//   the engine   answers /api/health/intake, and when the answer is bad it files
//                its own error report — so the 6-hour suppression window and the
//                recipient list stay in ONE place instead of being re-implemented
//                on a canvas nobody can diff.
//
//   this workflow  covers the case the engine cannot: THE ENDPOINT NOT ANSWERING.
//                A 500, a timeout, a DNS failure, a project paused — at that point
//                nothing inside Vercel can tell anyone, so n8n does.
//
// So the Gmail node here fires on unreachable-or-malformed, NOT on `stale`. A
// stale answer means the engine is alive and has already emailed; alerting on it
// here too would double every message and teach the reader to ignore both.
//
// A STANDALONE WORKFLOW. It matches itself by name so re-running updates rather
// than piling up duplicates, and it touches no existing workflow — hand-editing
// live n8n is the recurring production failure in this account.
//
// SUPPRESSION IS THE SCHEDULE ITSELF. Every 15 minutes, and n8n has no memory
// between runs, so a Vercel outage lasting a day would send 96 emails. The Code
// node therefore only alerts on the FIRST failure of a working-hours block and
// then every 4th consecutive one, using the static workflow data n8n does keep.
//
//   node scripts/install-intake-watchdog-workflow.mjs             # install / update
//   node scripts/install-intake-watchdog-workflow.mjs --activate  # + activate (needed)
//   node scripts/install-intake-watchdog-workflow.mjs --status
//   node scripts/install-intake-watchdog-workflow.mjs --print     # JSON only, no API call
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();

const argv = process.argv.slice(2);
const ACTIVATE = argv.includes("--activate");
const STATUS = argv.includes("--status");
const PRINT = argv.includes("--print");

const WF_NAME = "Spartan Intake Watchdog";
const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();
const APP = (process.env.SPARTAN_APP_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const TO = process.env.ERROR_ALERT_TO || "ben@samuraisolutions.co.uk, samuraisolutionsofficial@gmail.com";

/** Reconnecting Gmail in the n8n UI mints a NEW credential with a NEW id; when that
 *  happens these ids move together with the other installers'. Same default as
 *  install-manual-tag-workflow.mjs deliberately — one place to change, not two. */
const GMAIL_CRED = {
  id: process.env.GMAIL_CRED_ID || "hGFZ7vGl625ZeExK",
  name: process.env.GMAIL_CRED_NAME || "Spartan Crew 8/27/26",
};

const nodes = [
  {
    id: "sched", name: "Every 15 minutes", type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2, position: [0, 0],
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 15 }] } },
  },
  {
    // onError continueRegularOutput is the point of this node: a thrown request would
    // end the run and the alarm would be silent in exactly the outage it exists for.
    id: "ask", name: "Ask the engine", type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2, position: [220, 0],
    onError: "continueRegularOutput",
    parameters: {
      url: `${APP}/api/health/intake`,
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 20000 },
      sendHeaders: true,
      // The secret is INLINED at install time from this machine's environment, not written
      // into this file. n8n Cloud on this plan gives workflows no $env, so the tag workflow
      // already holds its copy literally; a second convention would be a second thing to get
      // wrong. It lives in n8n and in Vercel -- never in git.
      headerParameters: { parameters: [{ name: "x-webhook-secret", value: SECRET }] },
    },
  },
  {
    id: "judge", name: "Judge the answer", type: "n8n-nodes-base.code",
    typeVersion: 2, position: [440, 0],
    parameters: {
      jsCode: [
        "// UNREACHABLE means: no 200, or a 200 whose body is not the health shape. Both are",
        "// 'the engine could not answer', which is the only thing this workflow alerts on —",
        "// a stale-but-answered reading has already emailed itself from inside the engine.",
        "const r = $input.first().json ?? {};",
        "const status = Number(r.statusCode ?? 0);",
        "const body = r.body ?? r;",
        "const answered = status === 200 && body && typeof body.ok === 'boolean';",
        "",
        "// n8n keeps nothing between runs except this. Without it a day-long Vercel outage",
        "// sends 96 identical emails and the sender gets filtered.",
        "const s = $getWorkflowStaticData('global');",
        "s.consecutiveFailures = answered ? 0 : (s.consecutiveFailures || 0) + 1;",
        "const n = s.consecutiveFailures;",
        "const alert = !answered && (n === 1 || n % 4 === 0);",
        "",
        "return [{ json: {",
        "  alert, answered, status, consecutive: n,",
        "  stale: body?.stale ?? null,",
        "  minutes_since: body?.minutes_since ?? null,",
        "  detail: String(r.error?.message ?? r.message ?? JSON.stringify(body ?? {})).slice(0, 500),",
        "} }];",
      ].join("\n"),
    },
  },
  {
    id: "gate", name: "Alert?", type: "n8n-nodes-base.if",
    typeVersion: 2, position: [660, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2 },
        combinator: "and",
        conditions: [{
          leftValue: "={{ $json.alert }}", rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true },
        }],
      },
    },
  },
  {
    id: "mail", name: "Email the alarm", type: "n8n-nodes-base.gmail",
    typeVersion: 2.1, position: [880, -60],
    parameters: {
      sendTo: TO,
      subject: "=Spartan intake watchdog: the engine did not answer ({{ $json.consecutive }} in a row)",
      emailType: "text",
      message: [
        "=The Spartan intake health check could not be answered.",
        "",
        "This is NOT the engine reporting a problem — it is the engine failing to reply at all,",
        "which is what a paused project, a failed deploy or a Vercel outage looks like. Nothing",
        "inside the app can report this, so this workflow does.",
        "",
        `Endpoint: ${APP}/api/health/intake`,
        "HTTP status: {{ $json.status }}",
        "Consecutive failures: {{ $json.consecutive }} (checked every 15 minutes)",
        "",
        "Detail: {{ $json.detail }}",
        "",
        "Repeats are sent on the 1st failure and then every 4th, so this arriving once an hour",
        "means it is still down.",
      ].join("\n"),
      options: { appendAttribution: false },
    },
    credentials: { gmailOAuth2: GMAIL_CRED },
  },
];

const connections = {
  "Every 15 minutes": { main: [[{ node: "Ask the engine", type: "main", index: 0 }]] },
  "Ask the engine": { main: [[{ node: "Judge the answer", type: "main", index: 0 }]] },
  "Judge the answer": { main: [[{ node: "Alert?", type: "main", index: 0 }]] },
  "Alert?": { main: [[{ node: "Email the alarm", type: "main", index: 0 }], []] },
};

const settings = { executionOrder: "v1" };
const body = { name: WF_NAME, nodes, connections, settings };

if (PRINT) {
  // Never print the secret, even in a dry run that goes nowhere.
  console.log(JSON.stringify(body, null, 2).replace(SECRET || " ", "<secret>"));
  process.exit(0);
}

if (!SECRET) {
  console.error(
    "MISSING ENV: N8N_WEBHOOK_SECRET -- without it every check would 401 and the watchdog " +
    "would report an outage that is only its own lockout."
  );
  process.exit(2);
}

const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const KEY = requireEnv("N8N_API_KEY");
const h = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };

async function api(path, init = {}) {
  const r = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const all = await api("/workflows?limit=250");
const existing = (all.data || []).find((w) => w.name === WF_NAME) || null;

if (STATUS) {
  console.log(existing ? `${WF_NAME}: ${existing.id}, active=${existing.active}` : `${WF_NAME}: not installed`);
  process.exit(0);
}

let wf;
if (existing) {
  if (existing.active) {
    await api(`/workflows/${existing.id}/deactivate`, { method: "POST" });
    console.log("deactivated before update, so the schedule re-registers");
  }
  wf = await api(`/workflows/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
  console.log(`updated ${wf.id}`);
} else {
  wf = await api("/workflows", { method: "POST", body: JSON.stringify(body) });
  console.log(`created ${wf.id}`);
}

if (ACTIVATE) {
  await api(`/workflows/${wf.id}/activate`, { method: "POST" });
  // Read back rather than trusting the response: PUT /workflows/{id} returns 200 and
  // silently keeps the old value on some node types. Verify by re-reading, always.
  const live = await api(`/workflows/${wf.id}`);
  console.log(`activated: ${live.active}`);
}

console.log(`\nasks GET ${APP}/api/health/intake every 15 minutes`);
console.log("the engine's N8N_WEBHOOK_SECRET was inlined into the request header at install time");
console.log(`alerts to: ${TO}`);
