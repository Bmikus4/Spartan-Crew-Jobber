// ============================================================================
// SPARTAN_PAUSED=1 stops the engine's automatic routes and leaves the human ones open.
// ----------------------------------------------------------------------------
// Ben, 2026-10-05: the n8n and Vercel automation off for the week. Turning off the n8n
// workflows stops the callers; this switch stops the engine itself, so a caller still
// holding the webhook secret cannot drive it either.
//
// Offline.  npx tsx test/automationPaused.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { automationPaused, v2Writes, AUTOMATION_ROUTES, OLD_ENGINE_ROUTES } from "../app/lib/paused";

let fails = 0;
const ok = (cond: boolean, label: string) => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); };

const on = "1";
console.log("\n[1] paused: every automation route stops");
for (const p of AUTOMATION_ROUTES) ok(automationPaused(p, on), `${p} is paused`);
ok(automationPaused("/api/mail-inbound/extra", on), "a sub-path of an automation route is paused");

console.log("\n[2] paused: the human routes and the health probe stay open");
for (const p of ["/api/health/intake", "/api/feed", "/api/feed/check", "/api/confirm-order", "/api/settings", "/api/auth/google", "/api/jobs"])
  ok(!automationPaused(p, on), `${p} stays open`);
ok(!automationPaused("/api/n8n-inbound-other", on), "a route that only shares a prefix is not paused");

console.log("\n[3] not paused unless the switch reads exactly 1");
for (const v of ["", "0", "true", "on"]) ok(!automationPaused("/api/n8n-inbound", v), `SPARTAN_PAUSED=${JSON.stringify(v)} does not pause`);
ok(automationPaused("/api/n8n-inbound", " 1 "), "a pasted value with spaces still pauses");

console.log("\n[4] the middleware asks before its auth switch, which is off by default");
{
  const mw = readFileSync("middleware.ts", "utf8");
  const pause = mw.indexOf("automationPaused(pathname)");
  const enforced = mw.indexOf("const enforced");
  ok(pause > 0 && enforced > 0 && pause < enforced, "the pause check runs before AUTH_REQUIRED can wave a request through");
}

console.log("\n[5] SPARTAN_ENGINE=v2: intake and its dedupe claim open, the old engine's own routes stay shut");
for (const p of OLD_ENGINE_ROUTES) ok(automationPaused(p, "", "v2"), `${p} stays shut under v2`);
for (const p of ["/api/n8n-inbound", "/api/dedupe"]) ok(!automationPaused(p, "", "v2"), `${p} is open under v2`);
ok(OLD_ENGINE_ROUTES.length === AUTOMATION_ROUTES.length - 2, `exactly two routes open under v2 (${OLD_ENGINE_ROUTES.length} shut)`);
ok(automationPaused("/api/n8n-inbound", "1", "v2"), "SPARTAN_PAUSED=1 still stops intake under v2");
ok(!automationPaused("/api/mail-poll", "", ""), "control: no switch, nothing shut");

console.log("\n[v2 writes] the bot writes to real clients only when told, and only under v2");
ok(v2Writes("live", "v2") && v2Writes(" LIVE ", "v2"), "SPARTAN_WRITES=live under v2: live");
ok(!v2Writes("", "v2") && !v2Writes("1", "v2") && !v2Writes(undefined, "v2"), "unset or any other value: shadow");
ok(!v2Writes("live", ""), "never under the old engine");

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exitCode = fails ? 1 : 0;
