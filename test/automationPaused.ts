// ============================================================================
// What the two switches read, and that no route is shut.
// ----------------------------------------------------------------------------
// One engine since 27 Oct (addendum Prompt 12). SPARTAN_PAUSED=1 shuts no route: it stops the
// automation where it acts, and both intakes store what arrives without deciding it
// (test/pauseStoresOnly.ts, test/mailPollIntake.ts). The middleware shut /api/mail-poll alone until
// R14 gave it decisions (addendum F43); the shut list went with it.
//
// Offline.  npx tsx --require ./test/fixtures/pg.ts test/automationPaused.ts
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { automationPausedFlag, v2Writes } from "../app/lib/paused";

delete process.env.SPARTAN_PAUSED;
delete process.env.SPARTAN_WRITES;
let fails = 0;
const ok = (cond: boolean, label: string) => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); };

console.log("\n[1] the middleware shuts no route, the Gmail-API intake included");
{
  const mw = readFileSync("middleware.ts", "utf8");
  ok(!/status: 503|paused/.test(mw), "no pause or 503 answer in the middleware");
  ok(mw.includes(`"/api/mail-poll"`), "/api/mail-poll is skipped to its own machine gate");
}

console.log("\n[3] the old engine's own routes are gone, so nothing can reach them");
for (const p of ["confirm-order", "reconcile", "sweep-ingest", "mail-inbound"]) ok(!existsSync(`app/api/${p}/route.ts`), `/api/${p} does not exist`);

console.log("\n[4] SPARTAN_PAUSED pauses only when it reads 1");
for (const v of ["", "0", "true", "on", undefined]) ok(!automationPausedFlag(v), `SPARTAN_PAUSED=${JSON.stringify(v)} does not pause`);
ok(automationPausedFlag("1") && automationPausedFlag(" 1 "), "1, or a pasted 1 with spaces, pauses");

console.log("\n[6] SPARTAN_WRITES: the bot writes to real clients only when told");
ok(v2Writes("live") && v2Writes(" LIVE "), "live, in any case: live");
ok(!v2Writes("") && !v2Writes("1") && !v2Writes("on") && !v2Writes(undefined), "unset or any other value: shadow");

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exitCode = fails ? 1 : 0;
