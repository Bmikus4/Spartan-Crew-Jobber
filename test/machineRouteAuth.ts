// ============================================================================
// The intake routes must not fall open when nothing is configured.
// ----------------------------------------------------------------------------
// /api/n8n-inbound, /api/dedupe and /api/sweep-ingest are in the middleware SKIP list
// — they authenticate themselves with N8N_WEBHOOK_SECRET instead of a session — so the
// check inside each route is the ONLY gate in front of them. All three wrote that check
// by hand, and all three wrote it the same wrong way:
//
//     if (!secret) return true;   // "not yet configured — stay open"
//
// The action routes already got this right: `decideCaller` allows an unconfigured
// caller ONLY outside production, and test/apiAuth.ts pins it. The intake routes were a
// second copy of the same decision with the production guard missing.
//
// THAT GAP WAS LIVE, AND IT WAS NOT THEORETICAL. Measured 2026-08-28:
// N8N_WEBHOOK_SECRET and AUTH_REQUIRED are set for Production only, while every
// STORAGE_*/POSTGRES_* variable is set for Production AND Preview and points at the
// same database. On a preview deployment the secret is therefore absent, the routes
// returned true, and the middleware waved the request through because AUTH_REQUIRED
// was also absent — so any preview URL was an unauthenticated write path into the
// production database.
//
// Note what does NOT fix this: setting the envs for Preview. That closes today's hole
// and leaves the rule wrong, so the next environment created reopens it. The rule is
// what is being fixed here; the env change is worth making as well, but it is not the
// guard.
//
// Run: npx tsx test/machineRouteAuth.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideMachineCall } from "../app/lib/apiAuth";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const base = {
  secretMatches: false,
  secretConfigured: true,
  authRequired: false,
  isProduction: true,
};

console.log("\n[1] n8n with the right secret is the normal case");
{
  const c = decideMachineCall({ ...base, secretMatches: true });
  ok(c.ok && c.kind === "service", "allowed as a service", String(c.kind));
  ok(c.actor === "n8n", "attributed to n8n", String(c.actor));
}

console.log("\n[2] nothing configured: open locally, CLOSED in production");
{
  ok(
    decideMachineCall({ ...base, secretConfigured: false, isProduction: false }).ok,
    "local dev with no secret: allowed — the offline harnesses post to these routes"
  );
  ok(
    !decideMachineCall({ ...base, secretConfigured: false, isProduction: true }).ok,
    "PRODUCTION BUILD with no secret: REFUSED — this is the preview-deployment hole"
  );
  ok(
    !decideMachineCall({ ...base, secretConfigured: false, isProduction: true, authRequired: true }).ok,
    "and refused with auth enforced too"
  );
}

console.log("\n[3] a configured secret that was not presented is a refusal, not a fallback");
{
  ok(!decideMachineCall(base).ok, "no header, secret configured, production: refused");
  ok(
    !decideMachineCall({ ...base, secretConfigured: true, isProduction: false }).ok,
    "and refused locally too — a configured secret means the caller must carry it"
  );
}

console.log("\n[4] a human session does not open a machine route");
{
  /**
   * decideCaller admits a signed-in human, because a human clicking "confirm" on the
   * Jobs Board is a legitimate caller of an ACTION route. An intake route has no such
   * caller: nothing in the UI posts an inbound email. Passing no session keeps the two
   * decisions one function without widening this door.
   */
  const c = decideMachineCall({ ...base, secretMatches: false });
  ok(!c.ok, "no session is consulted, so a browser cookie cannot reach the intake");
}

console.log("\n[5] the fail-open shape is gone from every route, and stays gone");
{
  /**
   * The pure function above can be right while a route ignores it — which is exactly
   * how this bug existed, since decideCaller was already correct when the three routes
   * were written. So this reads the route files.
   */
  const HERE = dirname(fileURLToPath(import.meta.url));
  const ROUTES = ["n8n-inbound", "dedupe", "sweep-ingest"];
  /**
   * Comments are stripped first. Without that, this file failed on all three routes the
   * moment each one grew a comment SAYING what the removed branch used to be — a guard
   * that reads prose reports the bug it is quoting, and the obvious way to quieten it is
   * to delete the explanation, which is the one thing here worth keeping.
   */
  const codeOnly = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const r of ROUTES) {
    const src = codeOnly(readFileSync(join(HERE, "..", "app", "api", r, "route.ts"), "utf8"));
    // `if (!secret) return true` and `if (secret && ...)` — both mean "no secret, no gate".
    const failsOpen = /!secret\s*\)\s*return\s+true/.test(src) || /if\s*\(\s*secret\s*&&/.test(src);
    ok(!failsOpen, `${r}: no "unconfigured means allowed" branch`);
    const usesTheRule = /decideMachineCall|authorizeMachineCall/.test(src);
    ok(usesTheRule, `${r}: defers to the shared rule rather than re-deciding`);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
