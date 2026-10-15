// Finds and clears what tests left in the live automation (app/lib/testData.ts holds the rules).
//   npx tsx --env-file=.env.local scripts/clear-test-data.mts            what would go, nothing removed
//   npx tsx --env-file=.env.local scripts/clear-test-data.mts --apply    remove it, then look again
//   ... --apply --force   past the caps (CAPS in testData.ts), after reading the plan
// The Settings screen's "Clear test data" and the quarter-hourly sweep run the same code.
import { neon } from "@neondatabase/serverless";
import { httpTransport } from "../app/lib/engine/onsinch";
import { planTestData, clearTestData, type OnsinchCall } from "../app/lib/testData";
const sql = neon((process.env.DATABASE_URL || "").trim());
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" }) as unknown as OnsinchCall;
const show = (p: Awaited<ReturnType<typeof planTestData>>) => {
  console.log(`test threads ${p.threads.length}; OnSinch orders ${p.orders.length}; companies ${p.companies.length}${p.over ? `; OVER CAP: ${p.over}` : ""}`);
  for (const o of p.orders) console.log(`  order R${o.number} "${o.name}" (${o.why})`);
  for (const c of p.companies) console.log(`  company "${c.name}" (${c.why})`);
  console.log(`  rows: ${Object.entries(p.rows).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
  for (const k of p.kept) console.log(`  kept: ${k}`);
};
const plan = await planTestData(sql, t);
show(plan);
if (process.argv.includes("--list")) for (const th of plan.threads) console.log("  thread", th);
if (process.argv.includes("--apply")) {
  const r = await clearTestData(sql, t, "cli", { force: process.argv.includes("--force") });
  console.log(`\ncleared: orders ${r.orders.join(", ") || "none"}; companies ${r.companies.join(", ") || "none"}; rows ${Object.entries(r.rows).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
  if (r.refused) console.log(`REFUSED: ${r.refused}`);
  for (const f of r.failed) console.log(`FAILED: ${f}`);
  console.log("\nlooking again:");
  const again = await planTestData(sql, t);
  show(again);
  if (again.orders.length || again.companies.length || again.threads.length || Object.values(again.rows).some((n) => n)) process.exitCode = 1;
}
