// Read-only audit: nodes whose expressions reference a node that does not exist
// in this workflow (dead refs left over from the HoH copy), plus trigger config
// and credential inventory. Run: node scripts/audit-workflow-refs.mjs
import { loadEnv, requireEnv } from "./_env.mjs";
loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY };

const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
const names = new Set(wf.nodes.map((n) => n.name));
const bad = new Map();
for (const n of wf.nodes) {
  const s = JSON.stringify(n.parameters ?? {});
  for (const m of s.matchAll(/\$\(\\?['"]([^'"\\]+)\\?['"]\)/g)) {
    if (!names.has(m[1])) {
      if (!bad.has(n.name)) bad.set(n.name, new Set());
      bad.get(n.name).add(m[1]);
    }
  }
}
console.log("--- nodes referencing NON-EXISTENT nodes (would error at runtime) ---");
if (!bad.size) console.log("  none");
for (const [k, v] of bad) console.log(`  ${k}  ->  ${[...v].join(", ")}`);

console.log("\n--- triggers ---");
for (const n of wf.nodes.filter((x) => /trigger/i.test(x.type))) {
  console.log(`  ${n.name} (${n.type.replace("n8n-nodes-base.", "")}): ${JSON.stringify(n.parameters)}`);
}

console.log("\n--- credentials in use ---");
const creds = new Map();
for (const n of wf.nodes) for (const [t, c] of Object.entries(n.credentials || {})) {
  const k = `${t}:${c.name}`;
  creds.set(k, [...(creds.get(k) || []), n.name]);
}
for (const [k, v] of creds) console.log(`  ${k}  <- ${v.join(", ")}`);
