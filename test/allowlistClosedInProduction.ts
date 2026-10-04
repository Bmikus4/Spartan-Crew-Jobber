// ============================================================================
// SP-22: with no allowlist configured, production refuses an unknown account.
// ----------------------------------------------------------------------------
// isAllowedEmail returned true for anyone once AUTH_ALLOWED_EMAILS and
// AUTH_ALLOWED_DOMAIN were both unset, so a production deploy that lost its env
// would let any Google account sign in. Production has AUTH_ALLOWED_DOMAIN set
// today, so nothing changes there; this pins the unconfigured case.
//
// Offline.  npx tsx test/allowlistClosedInProduction.ts
// ============================================================================
import { isAllowedEmail } from "../app/lib/authAllowlist";

let fails = 0;
const ok = (cond: boolean, label: string) => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); };

const saved = { e: process.env.AUTH_ALLOWED_EMAILS, d: process.env.AUTH_ALLOWED_DOMAIN, v: process.env.VERCEL_ENV };
delete process.env.AUTH_ALLOWED_EMAILS;
delete process.env.AUTH_ALLOWED_DOMAIN;
try {
  process.env.VERCEL_ENV = "production";
  ok(isAllowedEmail("stranger@example.com") === false, "production, no env: a stranger is refused");
  ok(isAllowedEmail("ops@spartancrew.co.uk") === true, "the code baselines still sign in");
  process.env.VERCEL_ENV = "preview";
  ok(isAllowedEmail("stranger@example.com") === true, "a preview with no env stays open, as before");
} finally {
  for (const [k, v] of [["AUTH_ALLOWED_EMAILS", saved.e], ["AUTH_ALLOWED_DOMAIN", saved.d], ["VERCEL_ENV", saved.v]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
