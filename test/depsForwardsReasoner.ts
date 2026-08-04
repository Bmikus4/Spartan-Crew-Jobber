// ============================================================================
// The production reasoner wrapper must expose every method the interface has.
// ----------------------------------------------------------------------------
// deps.ts builds the runtime Reasoner by hand, listing each method. It listed three
// and the interface had four, so `classifyAndExtract` did not exist in production —
// and compiler.ts, which checks for it before using it, took the two-call fallback on
// every live email. The single-call optimisation shipped, was tested, and never ran.
//
// The failure is invisible to a type-checker: the method is OPTIONAL on the interface
// (a provider that cannot hold both schemas is allowed to omit it), so omitting it is
// legal TypeScript. Only a test that compares the wrapper against the real adapter can
// catch it, which is what this does.
// ============================================================================
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { buildReasonerForTest } from "../app/lib/deps";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

console.log("deps forwards the whole Reasoner interface");

// The real adapter is the reference: whatever it implements, production must forward.
const real = createOpenRouterReasoner({ apiKey: "test-key-not-used" });

process.env.OPENROUTER_API_KEY = "test-key-not-used";
const wrapped = buildReasonerForTest() as unknown as Record<string, unknown>;
const realIndexed = real as unknown as Record<string, unknown>;
const realMethods = Object.keys(realIndexed).filter((k) => typeof realIndexed[k] === "function");

ok(realMethods.length >= 4, `the adapter implements ${realMethods.length} methods`, realMethods.join(","));

for (const m of realMethods) {
  ok(typeof wrapped[m] === "function", `deps forwards ${m}`, `got ${typeof wrapped[m]}`);
}

// The specific regression: compiler.ts branches on this property's existence, so a
// missing property means the fallback path, not an error anyone would notice.
ok("classifyAndExtract" in wrapped, "classifyAndExtract is present, so compiler takes the ONE-call path");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
