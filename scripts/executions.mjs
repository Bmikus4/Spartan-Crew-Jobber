// Read-only: recent executions of the live workflow, with the failing node and
// error message for errored runs. Run: node scripts/executions.mjs [limit]
import { loadEnv, requireEnv } from "./_env.mjs";
loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const LIMIT = Number(process.argv[2] || 15);
const h = { "X-N8N-API-KEY": KEY };

const res = await fetch(`${BASE}/executions?workflowId=${WF}&limit=${LIMIT}`, { headers: h });
const body = await res.json();
if (!Array.isArray(body.data)) { console.log(res.status, JSON.stringify(body).slice(0, 500)); process.exit(1); }
console.log(`executions: ${body.data.length}`);
for (const e of body.data) {
  console.log(`\n${e.id}  ${e.status}  ${e.startedAt} -> ${e.stoppedAt}  mode=${e.mode}`);
  const d = await (await fetch(`${BASE}/executions/${e.id}?includeData=true`, { headers: h })).json();
  const run = d?.data?.resultData;
  if (run?.error) console.log(`  ERROR node="${run.lastNodeExecuted}" : ${String(run.error.message).slice(0, 300)}`);
  const nodes = Object.keys(run?.runData || {});
  console.log(`  ran: ${nodes.join(" | ")}`);
}
