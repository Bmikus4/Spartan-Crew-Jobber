// Wait for the FIRST non-erroring execution of the bookings workflow, i.e. the
// moment the Gmail credential starts working, then report what the run did and
// whether anything reached the engine.
//
// Exits as soon as it sees a run that did not fail on the credential, or after
// the timeout. Read-only against n8n and the database.
//
//   node scripts/watch-first-run.mjs [minutes]
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY };
const sql = neon(requireEnv("DATABASE_URL"));

const MINUTES = Number(process.argv[2] || 25);
const startedAt = Date.now();
const deadline = startedAt + MINUTES * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isCredError = (msg) => /needs to be reconnected|credential/i.test(String(msg || ""));

console.log(`watching workflow ${WF} for up to ${MINUTES} min (poll 30s)`);

let polls = 0;
while (Date.now() < deadline) {
  polls++;
  const res = await fetch(`${BASE}/executions?workflowId=${WF}&limit=5`, { headers: h });
  const body = await res.json().catch(() => ({}));
  const runs = Array.isArray(body.data) ? body.data : [];

  for (const e of runs) {
    // only consider runs that STARTED after this watcher did
    if (Date.parse(e.startedAt) < startedAt - 60_000) continue;

    const d = await (await fetch(`${BASE}/executions/${e.id}?includeData=true`, { headers: h })).json();
    const rd = d?.data?.resultData;
    const err = rd?.error?.message;
    const nodes = Object.keys(rd?.runData || {});

    if (e.status === "error" && isCredError(err)) {
      console.log(`  poll ${polls}: ${e.id} still the credential error`);
      continue;
    }

    // anything else is progress worth reporting immediately
    console.log(`\nFIRST NON-CREDENTIAL RUN: ${e.id}  status=${e.status}  ${e.startedAt}`);
    console.log(`  nodes run (${nodes.length}): ${nodes.join(" | ")}`);
    if (err) console.log(`  error at "${rd.lastNodeExecuted}": ${String(err).slice(0, 400)}`);

    const reached = ["Dedupe Claim", "Build Engine Payload", "POST to Engine"].filter((n) => nodes.includes(n));
    console.log(`  reached engine-side nodes: ${reached.length ? reached.join(", ") : "none yet"}`);

    for (const t of ["inbound_raw", "message_ledger", "conversation_state", "tickets"]) {
      const r = await sql(`SELECT count(*)::int AS n FROM ${t}`);
      console.log(`  ${t}: ${r[0].n} rows`);
    }
    process.exit(0);
  }

  if (polls % 4 === 0) console.log(`  poll ${polls}: nothing new yet (${Math.round((deadline - Date.now()) / 60000)} min left)`);
  await sleep(30_000);
}

console.log(`\ntimed out after ${MINUTES} min — still failing on the credential, or the workflow is not firing.`);
process.exit(1);
