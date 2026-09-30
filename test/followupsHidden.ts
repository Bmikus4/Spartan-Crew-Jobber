// ============================================================================
// Ops do not see the follow-up feature until it is switched on.
// ----------------------------------------------------------------------------
// Ben, 2026-09-29: before the restart, nothing new may be visible except order creation,
// amendments and the normal labels; the follow-up work in particular is not for them
// yet. It surfaces in exactly two ways — the dashboard row and its two API routes — and
// both are behind followupsEnabled(). Its chase composer and decide() have no caller,
// which [3] pins so a new caller cannot switch it on by accident.
//
// Reads sources rather than importing routes, as test/writeRoutesAuthorised.ts does.
// Run: npx tsx test/followupsHidden.ts
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { followupsEnabled } from "../app/lib/followup/enabled";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const src = (p: string) => readFileSync(p, "utf8");

console.log("\n[1] off unless explicitly switched on");
{
  const was = process.env.NEXT_PUBLIC_SPARTAN_FOLLOWUPS;
  delete process.env.NEXT_PUBLIC_SPARTAN_FOLLOWUPS;
  ok(followupsEnabled() === false, "off by default");
  process.env.NEXT_PUBLIC_SPARTAN_FOLLOWUPS = "true";
  ok(followupsEnabled() === false, "only the exact value 1 turns it on");
  process.env.NEXT_PUBLIC_SPARTAN_FOLLOWUPS = "1";
  ok(followupsEnabled() === true, "1 turns it on");
  if (was === undefined) delete process.env.NEXT_PUBLIC_SPARTAN_FOLLOWUPS; else process.env.NEXT_PUBLIC_SPARTAN_FOLLOWUPS = was;
}

console.log("\n[2] every place it surfaces is behind the switch");
{
  const dash = src("app/components/DashboardScreen.tsx");
  const rows = dash.split("\n").filter((l) => l.includes("<FollowUpRow"));
  ok(rows.length > 0 && rows.every((l) => l.includes("followupsEnabled() &&")), `the dashboard row, all ${rows.length} placements`, rows.map((l) => l.trim()).join(" | "));
  for (const route of ["app/api/followups/route.ts", "app/api/followups/suppress/route.ts"]) {
    const s = src(route);
    const handler = s.slice(s.search(/export async function (GET|POST)/));
    ok(/^[^\n]*\n\s*if \(!followupsEnabled\(\)\) return/.test(handler), `${route} refuses first`);
  }
  // Nothing else in the UI reaches the feature.
  const ui: string[] = [];
  (function walk(d: string) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(e)) ui.push(p); } })("app");
  const others = ui.filter((p) => !/DashboardScreen\.tsx$|FollowUpRow\.tsx$/.test(p) && /FollowUpRow|api\/followups/.test(src(p)));
  ok(others.length === 0, "no other component uses it", others.join(", "));
}

console.log("\n[3] nothing sends a chase or applies a follow-up label on its own");
{
  const code: string[] = [];
  (function walk(d: string) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(e)) code.push(p); } })("app");
  const chase = code.filter((p) => !/engine[\\/](reason|spend|tiered)\.ts$|lib[\\/]deps\.ts$/.test(p) && /\.composeChase[!]?\(/.test(src(p)));
  ok(chase.length === 0, "no caller of composeChase", chase.join(", "));
  const decide = code.filter((p) => !/followup[\\/]clock\.ts$/.test(p) && /\bdecide\(/.test(src(p)) && /followup\/clock/.test(src(p)));
  ok(decide.length === 0, "no caller of the follow-up decide()", decide.join(", "));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
