// ============================================================================
// The spend ceiling must stop a batch BEFORE it makes the expensive call.
// ----------------------------------------------------------------------------
// A guard that counts calls after making them is not a guard. These run against a
// fake reasoner that records invocations, so the test proves the arithmetic and the
// refusal without touching a paid API.
// ============================================================================
import { guardReasoner, ceilingFromEnv, SpendCeilingError, priceOf } from "../app/lib/engine/spend";
import type { Reasoner } from "../app/lib/engine/reason";
import type { ThreadMessage, ConversationFacts } from "../app/lib/engine/types";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const msg = (body: string): ThreadMessage => ({
  message_id: "m1", from: "a@b.com", to: ["bookings@spartancrew.co.uk"],
  date_iso: "2026-08-04T10:00:00Z", subject: "s", body, is_from_spartan: false,
});

function fake(): Reasoner & { calls: () => number } {
  let calls = 0;
  const facts: ConversationFacts = { requests: [] };
  return {
    calls: () => calls,
    async classifyAndExtract() { calls++; return { classification: "new-job", priority: "medium", job_summary: "", facts }; },
    async classify() { calls++; return { classification: "new-job", priority: "medium", job_summary: "" }; },
    async extractFacts() { calls++; return facts; },
    async composeReply() { calls++; return { subject: "s", html: "h", priority: "medium" }; },
  } as Reasoner & { calls: () => number };
}

console.log("spend ceiling");

async function main() {

// --- refuses past the limit, and the refused call never reaches the provider
{
  const inner = fake();
  const g = guardReasoner(inner, { model: "anthropic/claude-opus-4.6", label: "test", limit: 3 });
  for (let i = 0; i < 3; i++) await g.classify(msg("hello"), [], false);
  let threw: unknown = null;
  try { await g.classify(msg("hello"), [], false); } catch (e) { threw = e; }
  ok(threw instanceof SpendCeilingError, "throws SpendCeilingError at the ceiling");
  ok(inner.calls() === 3, "the refused call never reached the provider", `provider saw ${inner.calls()}`);
  ok(g.spend().calls === 3, "the report counts only calls that happened");
  ok(String((threw as Error).message).includes("$57"), "the message says why the guard exists");
}

// --- every method is counted, not just classify
{
  const inner = fake();
  const g = guardReasoner(inner, { model: "anthropic/claude-opus-4.6", limit: 99 });
  await g.classifyAndExtract!(msg("a"), [], false);
  await g.extractFacts(msg("a"), []);
  await g.composeReply(msg("a"), [], "new-job");
  ok(g.spend().calls === 3, "classifyAndExtract, extractFacts and composeReply all charge", String(g.spend().calls));
}

// --- the estimate scales with input and uses the model's real price
{
  const small = guardReasoner(fake(), { model: "anthropic/claude-opus-4.6", limit: 9 });
  await small.classify(msg("x".repeat(400)), [], false);
  const big = guardReasoner(fake(), { model: "anthropic/claude-opus-4.6", limit: 9 });
  await big.classify(msg("x".repeat(40_000)), [], false);
  ok(big.spend().estimatedUsd > small.spend().estimatedUsd, "a bigger thread estimates higher");

  const cheap = guardReasoner(fake(), { model: "google/gemini-2.5-flash", limit: 9 });
  await cheap.classify(msg("x".repeat(40_000)), [], false);
  ok(cheap.spend().estimatedUsd < big.spend().estimatedUsd, "Flash estimates cheaper than Opus for identical input");
  ok(priceOf("nonexistent/model").in === 5.0, "an unknown model is priced as the EXPENSIVE tier, never the cheap one");
}

// --- history counts toward the estimate: re-sending a thread is the cost being fought
{
  const g = guardReasoner(fake(), { model: "anthropic/claude-opus-4.6", limit: 9 });
  await g.classify(msg("new"), [msg("x".repeat(10_000)), msg("y".repeat(10_000))], false);
  ok(g.spend().inputChars > 20_000, "history is charged, not just the latest message", String(g.spend().inputChars));
}

// --- the env ceiling refuses to go large without the explicit opt-in
{
  const before = { max: process.env.SPARTAN_MAX_MODEL_CALLS, bulk: process.env.SPARTAN_ALLOW_BULK };
  process.env.SPARTAN_MAX_MODEL_CALLS = "50000";
  delete process.env.SPARTAN_ALLOW_BULK;
  ok(ceilingFromEnv() === 100, "a huge ceiling is clamped to 100 without SPARTAN_ALLOW_BULK", String(ceilingFromEnv()));
  process.env.SPARTAN_ALLOW_BULK = "1";
  ok(ceilingFromEnv() === 50000, "with the opt-in, the asked-for ceiling is honoured");
  delete process.env.SPARTAN_MAX_MODEL_CALLS;
  delete process.env.SPARTAN_ALLOW_BULK;
  ok(ceilingFromEnv() === 25, "the default is small enough to be useless for a batch");
  if (before.max !== undefined) process.env.SPARTAN_MAX_MODEL_CALLS = before.max;
  if (before.bulk !== undefined) process.env.SPARTAN_ALLOW_BULK = before.bulk;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
