// ============================================================================
// What the middleware shuts, and what the two switches read.
// ----------------------------------------------------------------------------
// One engine since 27 Oct (addendum Prompt 12). SPARTAN_PAUSED=1 shuts no route: it stops the
// automation where it acts, and intake stores what arrives without deciding it
// (test/pauseStoresOnly.ts). The middleware shuts /api/mail-poll alone, whose decisions wait on
// R14 (addendum F43).
//
// Offline.  npx tsx --require ./test/fixtures/pg.ts test/automationPaused.ts
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { automationPaused, automationPausedFlag, v2Writes, SHUT_ROUTES } from "../app/lib/paused";

delete process.env.SPARTAN_PAUSED;
delete process.env.SPARTAN_WRITES;
let fails = 0;
const ok = (cond: boolean, label: string) => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); };

console.log("\n[1] shut: the Gmail-API intake, and nothing that only shares its prefix");
for (const p of SHUT_ROUTES) ok(automationPaused(p), `${p} is shut`);
ok(automationPaused("/api/mail-poll/extra"), "a sub-path of a shut route is shut");
ok(!automationPaused("/api/mail-poll-other"), "a route that only shares a prefix is open");

console.log("\n[2] open: intake, its dedupe claim, the bot, the TV, settings and health");
for (const p of ["/api/n8n-inbound", "/api/dedupe", "/api/bot/sync", "/api/bot/labels", "/api/feed", "/api/feed/check", "/api/settings", "/api/health/intake", "/api/health/heartbeat", "/api/auth/google"])
  ok(!automationPaused(p), `${p} stays open`);

console.log("\n[3] the old engine's own routes are gone, so nothing can reach them");
for (const p of ["confirm-order", "reconcile", "sweep-ingest", "mail-inbound"]) ok(!existsSync(`app/api/${p}/route.ts`), `/api/${p} does not exist`);

console.log("\n[4] SPARTAN_PAUSED pauses only when it reads 1");
for (const v of ["", "0", "true", "on", undefined]) ok(!automationPausedFlag(v), `SPARTAN_PAUSED=${JSON.stringify(v)} does not pause`);
ok(automationPausedFlag("1") && automationPausedFlag(" 1 "), "1, or a pasted 1 with spaces, pauses");

console.log("\n[5] the middleware asks before its auth switch, which is off by default");
{
  const mw = readFileSync("middleware.ts", "utf8");
  const shut = mw.indexOf("automationPaused(pathname)");
  const enforced = mw.indexOf("const enforced");
  ok(shut > 0 && enforced > 0 && shut < enforced, "the shut check runs before AUTH_REQUIRED can wave a request through");
}

console.log("\n[6] SPARTAN_WRITES: the bot writes to real clients only when told");
ok(v2Writes("live") && v2Writes(" LIVE "), "live, in any case: live");
ok(!v2Writes("") && !v2Writes("1") && !v2Writes("on") && !v2Writes(undefined), "unset or any other value: shadow");

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exitCode = fails ? 1 : 0;
