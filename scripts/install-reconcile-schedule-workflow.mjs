// ============================================================================
// The daily reconciliation sweep — the schedule that makes /api/reconcile real.
// ----------------------------------------------------------------------------
// The sweep is the only thing that ever re-reads a booking after the conversation goes
// quiet: it notices an order staff deleted and rebinds the thread to the job it became,
// and it re-asserts a shape OnSinch silently did not take. Every part of it is built,
// authorised and tested — and NOTHING CALLED IT. Searched 2026-09-15: no vercel.json, no
// cron, and the only n8n workflow mentioning "reconcile" is a disabled House of Hud one.
// So the whole mechanism only ever fired when an email happened to arrive in a thread,
// which is the exact gap it was built to close.
//
// WHY N8N AND NOT A VERCEL CRON. A Vercel cron issues a GET and cannot set a header.
// `/api/reconcile` authorises on `x-webhook-secret` and — deliberately — treats GET as a
// DRY RUN, because a sweep that writes should be something a caller asked for on purpose.
// A Vercel cron could therefore only ever dry-run it. n8n is already the scheduler for
// intake, tagging, reply drafts and the watchdog, and it can POST with a header.
//
// THE FAILURE ALARM IS THE HEALTH CHECK, not an email branch here. `scripts/health.ts`
// reads each watched workflow's last successful execution, so a Code node that THROWS on
// a bad response is enough: the run is recorded as failed and the next health check says
// so. A second alarm implemented on a canvas would be a second thing to keep in step.
//
// WHAT IT COSTS, measured against the live tenant: a full pass over all 287 bound threads
// takes 53 seconds and spends two OnSinch reads on each of the 68 that need one. NO MODEL
// CALL — everything the sweep reads is already on the state row.
//
// NOT ACTIVATED BY DEFAULT. This writes to real client orders unattended; --activate is a
// decision, not a formality.
//
//   node scripts/install-reconcile-schedule-workflow.mjs             # install / update, inactive
//   node scripts/install-reconcile-schedule-workflow.mjs --activate  # + turn it on
//   node scripts/install-reconcile-schedule-workflow.mjs --dry       # install the DRY variant
//   node scripts/install-reconcile-schedule-workflow.mjs --status
//   node scripts/install-reconcile-schedule-workflow.mjs --print
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();

const argv = process.argv.slice(2);
const ACTIVATE = argv.includes("--activate");
const STATUS = argv.includes("--status");
const PRINT = argv.includes("--print");
const DRY = argv.includes("--dry");
const HOUR = argv.includes("--hour") ? Number(argv[argv.indexOf("--hour") + 1]) : 6;

const WF_NAME = "Spartan Reconciliation Sweep";
const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();
const APP = (process.env.SPARTAN_APP_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
// The limit counts threads that cost a read, not threads visited — see sweepAll. 200 is
// comfortably above the 68 that currently need one, so a run covers the population.
const LIMIT = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : 200;

const nodes = [
  {
    id: "sched", name: "Once a day", type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2, position: [0, 0],
    // Early morning UK: the sweep re-asserts shapes onto live orders, so it should land
    // before the office starts changing them by hand, not in the middle of that.
    parameters: { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: HOUR }] } },
  },
  {
    id: "run", name: "Sweep every bound thread", type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2, position: [220, 0],
    onError: "continueRegularOutput",
    parameters: {
      method: "POST",
      url: `${APP}/api/reconcile?limit=${LIMIT}${DRY ? "&dry=1" : ""}`,
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 120000 },
      sendHeaders: true,
      // Inlined at install time from this machine's environment, the same convention the
      // other installers use. n8n Cloud on this plan gives workflows no $env, and a second
      // convention would be a second thing to get wrong. It lives in n8n and in Vercel,
      // never in git.
      headerParameters: { parameters: [{ name: "x-webhook-secret", value: SECRET }] },
    },
  },
  {
    id: "judge", name: "Did it sweep?", type: "n8n-nodes-base.code",
    typeVersion: 2, position: [440, 0],
    parameters: {
      jsCode: [
        "// THROW, do not branch. n8n answers HTTP 200 with an empty body when a workflow",
        "// throws, which is indistinguishable from a rejected secret, so the positive",
        "// confirmation has to be read out of the body. A run that cannot confirm it swept",
        "// is recorded as a FAILED execution, and scripts/health.ts reports the workflow's",
        "// last success — that is the alarm.",
        "const r = $input.first().json ?? {};",
        "const status = Number(r.statusCode ?? 0);",
        "const body = r.body ?? r;",
        "if (status !== 200) throw new Error('reconcile answered HTTP ' + status + ': ' + JSON.stringify(body).slice(0, 300));",
        "if (!body || body.ok !== true) throw new Error('reconcile did not confirm ok:true — ' + JSON.stringify(body).slice(0, 300));",
        "const tally = body.tally || {};",
        "// An error on one thread never ends the sweep, by design. It still has to be",
        "// visible, or a branch that fails on every run looks like a healthy sweep.",
        "if (tally.error) throw new Error(tally.error + ' thread(s) errored: ' + JSON.stringify((body.outcomes||[]).filter(o=>o.action==='error').slice(0,5)));",
        "return [{ json: { swept: body.swept, bound: body.bound_threads, dry: body.dry, ...tally } }];",
      ].join("\n"),
    },
  },
];

const connections = {
  "Once a day": { main: [[{ node: "Sweep every bound thread", type: "main", index: 0 }]] },
  "Sweep every bound thread": { main: [[{ node: "Did it sweep?", type: "main", index: 0 }]] },
};

const body = { name: WF_NAME, nodes, connections, settings: { executionOrder: "v1" } };

if (PRINT) {
  console.log(JSON.stringify(body, null, 2).replace(SECRET || " ", "<secret>"));
  process.exit(0);
}
if (!SECRET) {
  console.error("MISSING ENV: N8N_WEBHOOK_SECRET — without it every run would 401 and the sweep would never happen.");
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
  // Updating a workflow while it is active leaves the previously registered schedule
  // running the OLD nodes, which is how a fixed bug survives its fix.
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
  // Read back rather than trusting the response — a PUT can clear the flag.
  const live = await api(`/workflows/${wf.id}`);
  console.log(`activated: ${live.active}`);
} else {
  console.log("left INACTIVE. It writes to live client orders unattended; pass --activate when that is the decision.");
}

console.log(`\nPOST ${APP}/api/reconcile?limit=${LIMIT}${DRY ? "&dry=1" : ""}  at ${String(HOUR).padStart(2, "0")}:00, daily`);
console.log(DRY ? "DRY: it will report what it would change and write nothing." : "LIVE: it amends real orders.");
