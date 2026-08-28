// ============================================================================
// Every route that WRITES must decide who is calling.
// ----------------------------------------------------------------------------
// POST /api/settings called saveSettings(coerceSettings(body)) with no
// authorisation check of any kind, and production answered it: 200, from anyone
// who knew the URL. That is the switch for `replies_enabled` and
// `reply_delivery: "send"` — the two settings that decide whether the engine
// emails clients without a human reading the draft first — and `default_rate_card`,
// which decides what goes on an invoice.
//
// It passed unnoticed because middleware.ts appears to gate /api/*, and does,
// behind AUTH_REQUIRED === "true", which is set nowhere. A route that relies on a
// switch somebody else has to throw is not protected.
//
// So the rule is checked per route rather than per deployment: if it exports a
// method that changes state, its source must consult an authority. Written as a
// sweep over the routes that exist, so the next one added is checked too.
//
// It reads the sources rather than importing them, for the reason test/wiring.ts
// gives: importing a route pulls in next/headers and a database connection.
//
// Run: npx tsx test/writeRoutesAuthorised.ts
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const routes: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry === "route.ts") routes.push(p.replace(/\\/g, "/"));
  }
})("app/api");

const WRITES = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;
/**
 * authorizeAction, a route that checks a shared secret itself, or a route that DEMANDS A
 * PERSON — one that opens the session and refuses when there is nobody in it.
 *
 * The third kind is stronger than the first here, not weaker, and /api/onboarding has to
 * be it. authorizeAction accepts the n8n webhook secret and, outside production, a caller
 * with no credentials at all; either would let something that is not a person record a
 * terms acceptance, or a profile, IN A NAMED PERSON'S NAME. Every row that route writes is
 * filed under the caller's own email, so the caller has to be somebody.
 */
const AUTHORITY =
  /authorizeAction|authorizeMachineCall|ADMIN_SECRET|WEBHOOK_SECRET|INTERNAL_API_SECRET|safeEqual|getIronSession/;

console.log("\n[1] the sweep found the routes");
ok(routes.length >= 8, `${routes.length} route files under app/api`, routes.join(" "));
ok(routes.includes("app/api/settings/route.ts"), "including the settings route");

console.log("\n[2] every write route consults an authority");
for (const path of routes) {
  const src = readFileSync(path, "utf8");
  if (!WRITES.test(src)) continue;
  const method = src.match(WRITES)![1];
  ok(AUTHORITY.test(src), `${path} (${method}) authorises`);
}

console.log("\n[3] the settings write in particular");
{
  const src = readFileSync("app/api/settings/route.ts", "utf8");
  const post = src.slice(src.indexOf("export async function POST"));
  ok(/authorizeAction/.test(post), "POST calls authorizeAction");
  // Order matters: authorise BEFORE the body is trusted, and refuse with 401
  // rather than saving and reporting failure afterwards.
  ok(post.includes("authorizeAction") && post.indexOf("authorizeAction") < post.indexOf("saveSettings"),
    "and does so before anything is saved");
  ok(/401/.test(post), "and refuses with 401");
  // A human on the Settings screen sends a session cookie, not the webhook
  // secret; authorizeAction accepts either, which is why the screen still works.
  ok(/GET/.test(src), "GET is left open — reading settings is not the hole, writing is");
}

console.log("\n[4] the onboarding write demands a person, not a secret");
{
  const src = readFileSync("app/api/onboarding/route.ts", "utf8");
  ok(/getIronSession/.test(src), "it opens the session");
  ok(!/authorizeAction/.test(src),
    "and does NOT use authorizeAction — that also accepts n8n's secret, which must never accept terms on somebody's behalf");
  const post = src.slice(src.indexOf("export async function POST"));
  ok(/if \(!email\)/.test(post) && /401/.test(post),
    "the write refuses when nobody is signed in");
  ok(post.indexOf("emailFromSession") < post.indexOf("req.json"),
    "and it establishes WHO is calling before it reads what they asked for");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
