// ============================================================================
// The action-route authorisation decision table.
//
// This guards two things that are easy to get wrong in opposite directions:
//   - too tight: confirm-order accepted ONLY the webhook secret, so a human
//     clicking "confirm draft order" in the browser got 401 and draft-only mode
//     had no approval path at all.
//   - too loose: an endpoint that writes real orders to OnSinch must not fall
//     open just because nothing happens to be configured.
//
// Run: npx tsx test/apiAuth.ts
// ============================================================================
import { decideCaller, type CallerInputs } from "../app/lib/apiAuth";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const base: CallerInputs = {
  secretMatches: false,
  secretConfigured: true,
  sessionName: null,
  sessionEmail: null,
  authRequired: false,
  isProduction: true,
};

console.log("\n[1] n8n with the right secret");
{
  const c = decideCaller({ ...base, secretMatches: true });
  ok(c.ok, "allowed");
  ok(c.kind === "service", "kind service", String(c.kind));
  ok(c.actor === "n8n", "attributed to n8n", String(c.actor));
}

console.log("\n[2] a signed-in human, no secret header (the bug)");
{
  const c = decideCaller({ ...base, sessionName: "Ben", sessionEmail: "ben@spartancrew.co.uk" });
  ok(c.ok, "allowed - this was 401 before");
  ok(c.kind === "human", "kind human", String(c.kind));
  ok(c.actor === "ben@spartancrew.co.uk", "attributed to the signer", String(c.actor));
}
{
  // session with a name but no email still attributable (admin break-glass)
  const c = decideCaller({ ...base, sessionName: "Admin", sessionEmail: null });
  ok(c.ok && c.actor === "Admin", "break-glass admin session allowed and named", String(c.actor));
}

console.log("\n[3] nobody: no secret presented, no session");
{
  const c = decideCaller(base);
  ok(!c.ok, "refused in production");
  ok(c.actor === null, "no actor");
}
{
  const c = decideCaller({ ...base, secretMatches: false, sessionName: "" });
  ok(!c.ok, "an empty session name is not a session");
}

console.log("\n[4] a WRONG secret is not a partial credential");
{
  // secretMatches is computed with safeEqual upstream; a mismatch must not fall
  // through to the dev allowance just because a header was present.
  const c = decideCaller({ ...base, secretMatches: false, secretConfigured: true, isProduction: false, authRequired: false });
  ok(!c.ok, "refused even outside production, because a secret IS configured");
}

console.log("\n[5] the dev allowance is narrow");
{
  ok(decideCaller({ ...base, secretConfigured: false, isProduction: false, authRequired: false }).ok,
    "local dev with nothing configured: allowed");
  ok(!decideCaller({ ...base, secretConfigured: false, isProduction: true, authRequired: false }).ok,
    "PRODUCTION with nothing configured: REFUSED (never falls open)");
  ok(!decideCaller({ ...base, secretConfigured: false, isProduction: false, authRequired: true }).ok,
    "auth enforced: refused without a session even locally");
}

console.log("\n[6] a valid secret still wins when auth is enforced");
{
  const c = decideCaller({ ...base, secretMatches: true, authRequired: true });
  ok(c.ok && c.kind === "service", "n8n is not locked out by AUTH_REQUIRED");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
