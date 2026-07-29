// Time the OnSinch whole-list pulls the resolver depends on, through the REAL
// client, so the figure is the one the deployed engine actually experiences.
//
// The deployed /api/n8n-inbound was dying at exactly 60s with no log line. The
// LLM path is only ~7s; the paging was over 42s, sequentially, because listAll
// walked one page at a time. Pages now go out concurrently.
//
// Read-only GETs.
//
// Run under tsx, not node - it imports the real TypeScript client on purpose, so
// that what is measured is the code that ships:
//
//   npx tsx scripts/time-onsinch.mjs
import { loadEnv, requireEnv } from "./_env.mjs";
import { OnsinchClient, httpTransport, __resetListCache } from "../app/lib/engine/onsinch.ts";

loadEnv();
const client = new OnsinchClient(
  httpTransport({
    baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1",
    apiKey: requireEnv("ONSINCH_API_KEY"),
  })
);

async function timed(label, fn) {
  const t0 = Date.now();
  const rows = await fn();
  const ms = Date.now() - t0;
  console.log(`  ${label.padEnd(12)} ${String(rows.length).padStart(5)} rows  ${String(ms).padStart(6)} ms`);
  return ms;
}

console.log("\ncold (the first email after a deploy or a 5-minute idle):");
__resetListCache();
const c = await timed("companies", () => client.allCompanies());
const p = await timed("places", () => client.allPlaces());
console.log(`  ${"TOTAL".padEnd(12)}        ${String(c + p).padStart(6)} ms`);

console.log("\nwarm (the cache holding, as it does between emails):");
const c2 = await timed("companies", () => client.allCompanies());
const p2 = await timed("places", () => client.allPlaces());
console.log(`  ${"TOTAL".padEnd(12)}        ${String(c2 + p2).padStart(6)} ms`);

console.log(`\nThe function ceiling is 60000 ms and the model path needs ~7000 ms of it.`);
console.log(`Sequentially these same two pulls measured 42787 ms (8191 + 34596).\n`);
