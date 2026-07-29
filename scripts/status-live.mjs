// Read-only snapshot of the whole live seam: the workflow's shape, its recent
// executions, and what actually landed in the database. Nothing is written to
// n8n, and the workflow JSON is saved to n8n/backups/ as a side effect, so this
// is also the safe first thing to run before any write.
//
//   node scripts/status-live.mjs [executionCount]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY };
const N = Number(process.argv[2] || 10);

const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
if (!Array.isArray(wf.nodes)) { console.error("could not load workflow"); process.exit(1); }

const dir = join(ROOT_DIR, "n8n", "backups");
mkdirSync(dir, { recursive: true });
const backup = join(dir, `bookings-${WF}.${String(wf.updatedAt).replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, JSON.stringify(wf, null, 2));

console.log(`\nWORKFLOW  ${wf.name}`);
console.log(`  active=${wf.active}  nodes=${wf.nodes.length}  updated=${wf.updatedAt}`);
console.log(`  backup  ${backup}`);

// the three things that have each broken this pipeline at least once
for (const n of wf.nodes.filter((x) => /langchain\.openAi/.test(x.type)))
  console.log(`  model   ${n.name.padEnd(28)} ${n.parameters?.modelId?.value}`);
const creds = new Map();
for (const n of wf.nodes) {
  const c = n.credentials?.gmailOAuth2;
  if (c) creds.set(c.id, (creds.get(c.id) || 0) + 1);
}
for (const [id, count] of creds) console.log(`  gmail   ${count} node(s) on credential ${id}`);
const getMany = wf.nodes.find((n) => n.name === "Get many messages");
if (getMany) {
  const f = JSON.stringify(getMany.parameters?.filters ?? {});
  console.log(`  window  ${f.slice(0, 240)}`);
}
const poster = wf.nodes.find((n) => /POST to Engine/i.test(n.name));
console.log(`  engine  ${poster ? poster.parameters?.url : "NO POST-TO-ENGINE NODE"}`);

console.log(`\nEXECUTIONS (last ${N})`);
const ex = await (await fetch(`${BASE}/executions?workflowId=${WF}&limit=${N}`, { headers: h })).json();
const runs = Array.isArray(ex.data) ? ex.data : [];
if (!runs.length) console.log("  none");
for (const e of runs) {
  const d = await (await fetch(`${BASE}/executions/${e.id}?includeData=true`, { headers: h })).json();
  const rd = d?.data?.resultData;
  const nodes = Object.keys(rd?.runData || {});
  const err = rd?.error?.message;
  console.log(`  ${e.id}  ${String(e.status).padEnd(8)} ${e.startedAt}  nodes=${nodes.length}`);
  console.log(`      ${nodes.join(" | ") || "(none)"}`);
  if (err) console.log(`      ERROR at "${rd.lastNodeExecuted}": ${String(err).slice(0, 300)}`);
}

console.log("\nDATABASE");
const sql = neon(requireEnv("DATABASE_URL"));
for (const t of ["inbound_raw", "message_ledger", "conversation_state", "tickets", "ticket_events"]) {
  try {
    const r = await sql(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(`  ${t.padEnd(20)} ${r[0].n} rows`);
  } catch (err) { console.log(`  ${t.padEnd(20)} — ${(err.message || "").slice(0, 80)}`); }
}
console.log();
