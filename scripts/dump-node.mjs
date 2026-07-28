// Dump one node's full parameters from the live workflow. Read-only.
// Run: node scripts/dump-node.mjs "Combine all Email Data"
import { loadEnv, requireEnv } from "./_env.mjs";
loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY };
const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
for (const want of process.argv.slice(2)) {
  const n = wf.nodes.find((x) => x.name === want);
  if (!n) { console.log(`### ${want}: NOT FOUND`); continue; }
  console.log(`\n########## ${n.name} (${n.type}) ##########`);
  if (n.parameters?.jsCode) console.log(n.parameters.jsCode);
  else console.log(JSON.stringify(n.parameters, null, 2));
}
