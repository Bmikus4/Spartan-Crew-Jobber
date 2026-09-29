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
import { guardReasoner } from "../app/lib/engine/spend";

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

/**
 * PRESENCE IS NOT FORWARDING, which is the hole this file had.
 *
 * Every assertion above passed for eighteen months while spend.ts's composeReply read
 * `(latest, history, cls) => inner.composeReply(latest, history, cls)` — three named
 * parameters forwarding three, silently dropping the fourth. That fourth is
 * ReplyContext: the booking situation and the list of things the client still has to
 * tell us. guardReasoner wraps both branches in deps.ts, so EVERY production reply was
 * composed being told "There is nothing to book in this thread", and the prompt's
 * "asking for what is missing (CRITICAL)" section never once had anything to ask for.
 *
 * A method that exists and answers is indistinguishable from a method that works,
 * until you count what reached the other side. So count it.
 */
{
  const seen: unknown[][] = [];
  const spy = {
    classify: async () => "other",
    extractFacts: async () => ({}),
    composeReply: async (...a: unknown[]) => { seen.push(a); return { subject: "", html: "", priority: "low" }; },
    composeChase: async (...a: unknown[]) => { seen.push(a); return { subject: "", html: "", priority: "low" }; },
  } as unknown as Parameters<typeof guardReasoner>[0];

  const guarded = guardReasoner(spy, { model: "test", label: "forwarding test" });
  const latest = { message_id: "m", from: "a@b.c", to: [], date_iso: "2026-01-01T00:00:00.000Z", subject: "s", body: "b", is_from_spartan: false };
  const context = { order_state: "blocked" as const, ask_for: ["the start time"] };

  void guarded.composeReply(latest, [], "new_job" as never, context);
  ok(seen[0]?.length === 4, "the spend wrapper forwards all FOUR composeReply arguments",
    `got ${seen[0]?.length}`);
  ok(JSON.stringify(seen[0]?.[3]) === JSON.stringify(context),
    "and the fourth is the ReplyContext unchanged", JSON.stringify(seen[0]?.[3]));

  void guarded.composeChase!(latest, [], "the start time");
  ok(seen[1]?.[2] === "the start time", "the spend wrapper forwards what a chase is waiting on",
    String(seen[1]?.[2]));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
