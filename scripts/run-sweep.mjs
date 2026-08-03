// ============================================================================
// Drive the 12-month sweep, one window at a time, and account for every window.
// ----------------------------------------------------------------------------
// A month in one execution is too much for the n8n worker: the one-day trial held
// 62 threads comfortably, and a month is roughly thirty times that, with every
// message body in memory at once. The first attempts died with "possible
// out-of-memory" and left nothing behind. So the year is swept in WEEKS, and a week
// that fails is split in half and retried rather than written off — a hole in the
// corpus is invisible later, and every measurement built on it would be wrong.
//
// Each window: fire the webhook, wait for that execution to finish, record what it
// did. Sequential on purpose. Four concurrent runs is what crashed the worker.
//
//   node scripts/run-sweep.mjs --months 12          # the year, in weeks
//   node scripts/run-sweep.mjs --months 1           # last month only
//   node scripts/run-sweep.mjs --months 12 --plan   # list the windows, fire nothing
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const SECRET = requireEnv("N8N_WEBHOOK_SECRET");
const H = { "X-N8N-API-KEY": KEY };
const WF_ID = process.env.SWEEP_WF_ID || "pilBSuqNH0tmp1vd";
const HOOK = `${BASE.replace(/\/api\/v1$/, "")}/webhook/spartan-sweep`;
const INGEST = "https://spartan-crew-jobber.vercel.app/api/sweep-ingest";

const argv = process.argv.slice(2);
// Not `|| 12`: --months 0 is a legitimate ask for the current month, and a falsy
// zero silently became a full year — which is how a one-window check turned into a
// 53-window sweep.
const MONTHS_ARG = argv.includes("--months") ? Number(argv[argv.indexOf("--months") + 1]) : NaN;
const MONTHS = Number.isFinite(MONTHS_ARG) ? MONTHS_ARG : 12;
const PLAN_ONLY = argv.includes("--plan");
// Window length. A week suits most of the year, but the most recent weeks carry enough
// mail to kill the n8n worker, and a crashed worker takes the webhook down with it —
// which is what turned nine windows into "webhook 503" and left holes.
const WINDOW_DAYS = argv.includes("--window-days") ? Number(argv[argv.indexOf("--window-days") + 1]) || 7 : 7;
const WEEK = WINDOW_DAYS * 86_400_000;
// An explicit span, for re-sweeping exactly the windows that failed.
const AFTER = argv.includes("--after") ? argv[argv.indexOf("--after") + 1] : null;
const BEFORE = argv.includes("--before") ? argv[argv.indexOf("--before") + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Weekly windows covering the last N months, oldest first, ending at today. */
function windows(months) {
  const now = new Date();
  const end = BEFORE ? Date.parse(`${BEFORE}T00:00:00Z`) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const start = AFTER ? Date.parse(`${AFTER}T00:00:00Z`) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1);
  const out = [];
  for (let t = start; t < end; t += WEEK) {
    out.push({ after: new Date(t).toISOString(), before: new Date(Math.min(t + WEEK, end)).toISOString() });
  }
  return out;
}

async function corpus() {
  const r = await fetch(INGEST, { headers: { "x-webhook-secret": SECRET } });
  return r.ok ? r.json() : { threads: "?", messages: "?" };
}

// n8n's execution list omits running executions unless asked for them, and the
// running filter lags. So a window is tracked by the execution whose startedAt is
// after the moment we fired — not by "a newer finished execution exists", which
// attributes someone else's run to this window and re-fires it.
async function executionSince(ms) {
  for (const q of [`&status=running`, ``]) {
    const r = await fetch(`${BASE}/executions?limit=10&workflowId=${WF_ID}${q}`, { headers: H });
    if (!r.ok) continue;
    const j = await r.json();
    const hit = (j.data || []).find((e) => Date.parse(e.startedAt) >= ms - 2000);
    if (hit) return hit;
  }
  return null;
}

async function executionById(id) {
  const r = await fetch(`${BASE}/executions/${id}`, { headers: H });
  return r.ok ? r.json() : null;
}

/** Fire one window and wait for its execution to finish. */
async function sweepWindow(w) {
  const firedAt = Date.now();
  // A 503 means the n8n worker is restarting — usually because the PREVIOUS window
  // crashed it. Retrying after it comes back is the difference between a hole in the
  // corpus and a window that simply took longer.
  let res = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(HOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ after: w.after, before: w.before }),
    });
    if (res.ok) break;
    if (res.status !== 503 && res.status !== 502) break;
    await sleep(60_000);
  }
  if (!res || !res.ok) return { ok: false, status: `webhook ${res ? res.status : "no response"}` };

  // The webhook answers on receipt, so the outcome lives in the execution it started.
  let id = null;
  for (let i = 0; i < 24 && !id; i++) {
    await sleep(5000);
    const found = await executionSince(firedAt);
    if (found) id = found.id;
  }
  if (!id) return { ok: false, status: "no execution appeared for this window" };

  for (let i = 0; i < 60; i++) {
    const e = await executionById(id);
    if (e && e.status && e.status !== "running" && e.status !== "new") {
      // n8n flips status to success before it has flushed the run data, so reading the
      // detail immediately can return an execution with no nodes at all. Reported as
      // zero, that looked exactly like six consecutive weeks of empty mailbox — the
      // mail was in fact swept. Retry once, then say "unknown" rather than "0".
      let rd = {};
      for (let t = 0; t < 2; t++) {
        const d = await (await fetch(`${BASE}/executions/${id}?includeData=true`, { headers: H })).json();
        rd = d.data?.resultData || {};
        if (Object.keys(rd.runData || {}).length) break;
        await sleep(4000);
      }
      const known = Object.keys(rd.runData || {}).length > 0;
      const items = (name) => (known ? (rd.runData?.[name]?.[0]?.data?.main?.[0] || []).length : null);
      return {
        ok: e.status === "success",
        status: e.status + (known ? "" : " (run data not retained)"),
        execution: id,
        listed: items("List Window"),
        threads: items("Get Thread"),
        posted: items("POST to Sweep Ingest"),
        error: String(rd.error?.message || "").slice(0, 120),
      };
    }
    await sleep(5000);
  }
  return { ok: false, status: "timed out waiting for the execution" };
}

const plan = windows(MONTHS);
console.log(`\n${plan.length} weekly window(s) covering ${MONTHS} month(s), oldest first`);
if (PLAN_ONLY) {
  for (const w of plan) console.log(`  ${w.after.slice(0, 10)} .. ${w.before.slice(0, 10)}`);
  process.exit(0);
}

const start = await corpus();
console.log(`corpus at start: ${start.threads} threads / ${start.messages} messages\n`);

const failed = [];
let done = 0;
for (const w of plan) {
  const label = `${w.after.slice(0, 10)}..${w.before.slice(0, 10)}`;
  let r = await sweepWindow(w, label);

  // A crashed week is split in half and retried. Whether it crashed on volume or on
  // one awkward thread, halving finds out — and silently dropping a week would leave
  // a hole nobody could see later.
  if (!r.ok) {
    console.log(`  ${label}  ${r.status}${r.error ? ` — ${r.error}` : ""}  -> splitting`);
    const mid = new Date((Date.parse(w.after) + Date.parse(w.before)) / 2).toISOString();
    const halves = [{ after: w.after, before: mid }, { after: mid, before: w.before }];
    const results = [];
    for (const half of halves) results.push(await sweepWindow(half, label));
    if (results.every((x) => x.ok)) {
      r = { ok: true, status: "success (split)", listed: results.reduce((n, x) => n + (x.listed || 0), 0), threads: results.reduce((n, x) => n + (x.threads || 0), 0) };
    } else {
      failed.push({ label, detail: results.map((x) => x.status).join(" / ") });
      r = { ok: false, status: `still failing after split: ${results.map((x) => x.status).join(" / ")}` };
    }
  }

  done++;
  console.log(`  [${String(done).padStart(2)}/${plan.length}] ${label}  ${r.status}  listed=${r.listed ?? "?"} threads=${r.threads ?? "?"}`);
}

const end = await corpus();
console.log(`\ncorpus now: ${end.threads} threads / ${end.messages} messages`);
console.log(`span: ${String(end.from).slice(0, 10)} .. ${String(end.to).slice(0, 10)}`);
console.log(`gained: ${end.threads - start.threads} threads / ${end.messages - start.messages} messages`);
if (failed.length) {
  console.log(`\n${failed.length} WINDOW(S) STILL MISSING — the corpus has holes here:`);
  for (const f of failed) console.log(`  ${f.label}: ${f.detail}`);
  process.exitCode = 1;
}
