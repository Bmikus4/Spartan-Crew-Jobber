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
 *
 * authorizeMailWebhook is the machine rule again with the secret read from the URL instead
 * of a header, because a mail provider POSTs a fixed request shape and cannot add one.
 *
 * authorizeCronCall is the same rule once more, for a Vercel cron: it presents
 * `Authorization: Bearer $CRON_SECRET` and can add no header of ours either. All three
 * defer to decideMachineCall; only how the secret arrives differs.
 *
 * This list is the weakness test/machineRouteAuth.ts deliberately gave up on -- naming
 * the gates that existed when it was written means a NEW shared gate reads as no gate at
 * all. It stays here because this file also covers session-authed human routes, where
 * there is no single shared decision to point at. Adding a name is expected; widening
 * this to anything that merely looks like a check is not.
 */
const AUTHORITY =
  /authorizeAction|authorizeMachineCall|authorizeMailWebhook|authorizeCronCall|ADMIN_SECRET|WEBHOOK_SECRET|INTERNAL_API_SECRET|safeEqual|getIronSession/;

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
  // SP-20: the GET is guarded too. It returns the reply switches and the default rate card,
  // and the Settings screen's same-origin fetch carries the session cookie, so it still works.
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  ok(/authorizeAction/.test(get), "GET calls authorizeAction too");
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

console.log("\n[5] a machine gate the middleware never lets you reach is not a gate");
{
  // The reconciliation sweep ran for a day answering 401 to its own scheduler. Its route
  // was correct -- it called authorizeMachineCall and n8n sent the right secret -- but
  // /api/reconcile was not in middleware's SKIP list, so the session check answered first
  // and the route never executed. Deleted orders went un-rebound and silent write
  // failures uncaught, with nothing in the route itself to suggest why.
  //
  // The two 401s are distinguishable only by case: middleware says "Unauthorized",
  // a route's own gate says "unauthorized". That is far too fine a thread to hang a day
  // of lost sweeps on, so the pairing is asserted here instead of left to be noticed.
  const mw = readFileSync("middleware.ts", "utf8");
  const skip = (mw.match(/const SKIP = \[([^\]]*)\]/)?.[1] ?? "")
    .split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  ok(skip.length > 0, "the SKIP list was found and parsed", skip.join(" "));

  const covered = (path: string) => skip.some((p) => path === p || path.startsWith(p + "/"));

  for (const file of routes) {
    const src = readFileSync(file, "utf8");
    if (!/authorizeMachineCall|authorizeCronCall/.test(src)) continue;
    const url = "/" + file.replace(/^app\//, "").replace(/\/route\.ts$/, "");
    ok(covered(url), `${url} carries a machine gate and middleware lets it through`,
      covered(url) ? "" : "-- add it to SKIP in middleware.ts or its gate can never run");
  }
}

console.log("\n[6] a route that READS decides who is calling too");
{
  // /api/jobs and /api/metrics answer with client names, addresses and order history,
  // and carried no check of their own: production refused a stranger only because
  // middleware enforces AUTH_REQUIRED, one environment variable. Measured 2026-09-29:
  // both 401 from middleware ("Unauthorized"), neither from the route. The rule [2]
  // applies to writes — a switch somebody else has to throw is not protection — holds
  // for reads of client data too.
  //
  // PUBLIC is the routes a signed-out browser must reach. Adding to it needs a reason
  // in this comment, not just a name.
  //   auth/google  the sign-in flow itself
  const PUBLIC = new Set(["app/api/auth/google/route.ts"]);
  /**
   * PER HANDLER, NOT PER FILE (SP-20). A file passed when any of its functions consulted an
   * authority, so a guarded POST vouched for an unguarded GET beside it. Each exported
   * method is checked on its own source plus the same-file helpers it calls (reconcile's
   * run(), dedupe's authorized(), onboarding's emailFromSession()).
   *
   * OPEN_BY_DESIGN names a handler that is deliberately unguarded, with its reason:
   *   (none today)
   */
  const OPEN_BY_DESIGN = new Set<string>([]);
  const handlers = (src: string) => {
    const at = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)];
    return at.map((m, i) => ({ method: m[1], body: src.slice(m.index!, at[i + 1]?.index ?? src.length) }));
  };
  // A same-file function or arrow const, from its declaration to the next top-level one.
  const helper = (src: string, name: string) => {
    const m = new RegExp(`^(?:async\\s+)?(?:function\\s+${name}\\s*\\(|const\\s+${name}\\s*=)`, "m").exec(src);
    if (!m) return "";
    const rest = src.slice(m.index);
    const end = rest.slice(1).search(/\n(?:export\s|async\s+function\s|function\s|const\s)/);
    return end < 0 ? rest : rest.slice(0, end + 1);
  };
  for (const path of routes) {
    if (PUBLIC.has(path)) continue;
    const src = readFileSync(path, "utf8");
    for (const h of handlers(src)) {
      if (OPEN_BY_DESIGN.has(`${path} ${h.method}`)) continue;
      const called = [...new Set([...h.body.matchAll(/\b([a-zA-Z_]\w*)\(/g)].map((m) => m[1]))];
      const guarded = AUTHORITY.test(h.body) || called.some((n) => AUTHORITY.test(helper(src, n)));
      ok(guarded, `${path} ${h.method} authorises`);
    }
  }

  // The check itself must be able to fail: a GET with no gate beside a guarded POST.
  const fixture = "export async function GET() { return Response.json({}); }\n" +
    "export async function POST(r: Request) { const c = await authorizeAction(r); return Response.json(c); }\n";
  const failing = handlers(fixture).filter((h) => !AUTHORITY.test(h.body)).map((h) => h.method);
  ok(failing.join() === "GET", "an unguarded GET beside a guarded POST is caught", failing.join());
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
