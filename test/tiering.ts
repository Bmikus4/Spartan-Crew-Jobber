// ============================================================================
// A cheap model may only answer when its answer checks out.
// ----------------------------------------------------------------------------
// Tiering is the largest remaining saving and the easiest one to get wrong: a small
// model misreading a shift costs more than every token it saved. The whole safety
// argument is that escalation is decided by code checking the answer against the
// email, so these tests are that argument.
//
// Two fake reasoners, distinguishable by what they return. No provider, no spend.
// ============================================================================
import { tieredReasoner, escalationReason } from "../app/lib/engine/tiered";
import type { Reasoner } from "../app/lib/engine/reason";
import type { ConversationFacts, ThreadMessage } from "../app/lib/engine/types";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const msg = (body: string, subject = "Crew request"): ThreadMessage => ({
  message_id: "m1", from: "a@client.com", to: ["bookings@spartancrew.co.uk"],
  date_iso: "2026-08-04T09:00:00Z", subject, body, is_from_spartan: false,
});

const GOOD: ConversationFacts = {
  company_name: "Event Concept",
  location_text: "Tobacco Dock",
  requests: [{ date: "2026-09-12", start_time: "09:00", end_time: "16:00", size: 6 }],
};

function reasonerReturning(tag: string, facts: ConversationFacts, classification = "new-job") {
  const calls: string[] = [];
  const r: Reasoner & { calls: string[] } = {
    calls,
    async classifyAndExtract() { calls.push(tag); return { classification, priority: "medium", job_summary: tag, facts } as never; },
    async classifyAndExtractIncremental() { calls.push(tag + ":inc"); return { classification, priority: "medium", job_summary: tag, facts } as never; },
    async classify() { calls.push(tag + ":classify"); return { classification, priority: "medium", job_summary: tag } as never; },
    async extractFacts() { calls.push(tag + ":extract"); return facts; },
    async composeReply() { calls.push(tag + ":reply"); return { subject: "s", html: "h", priority: "medium" } as never; },
  } as never;
  return r;
}

console.log("tiering");

async function main() {

// ------------------------------------------------- the four escalation triggers
{
  const m = msg("Please send 6 crew to Tobacco Dock on 12 September, 09:00 - 16:00.");
  ok(escalationReason(m, { classification: "new-job", priority: "medium", job_summary: "", facts: GOOD }) === null,
     "a clean answer that matches the text does NOT escalate");

  ok(/no usable work block/.test(String(escalationReason(m,
     { classification: "new-job", priority: "medium", job_summary: "", facts: { requests: [] } }))),
     "a job with no work block escalates");

  ok(/contradicts/.test(String(escalationReason(m, {
       classification: "new-job", priority: "medium", job_summary: "",
       facts: { ...GOOD, requests: [{ date: "2026-09-12", start_time: "08:00", end_time: "18:00", size: 6 }] },
     }))),
     "a defaulted 08:00-18:00 against a stated 09:00-16:00 escalates");

  ok(/rejected, but the text/.test(String(escalationReason(
       msg("Hi, can you cover 8 crew on 19 September?"),
       { classification: "not-a-job", priority: "low", job_summary: "", facts: { requests: [] } }))),
     "junk with a date and a crew size in the text escalates");

  ok(/neither company nor venue/.test(String(escalationReason(m, {
       classification: "new-job", priority: "medium", job_summary: "",
       facts: { requests: [{ date: "2026-09-12", size: 6, start_time: "09:00", end_time: "16:00" }] },
     }))),
     "a job with no company and no venue escalates");

  ok(escalationReason(msg("Thanks, all confirmed."), {
       classification: "not-a-job", priority: "low", job_summary: "", facts: { requests: [] },
     }) === null,
     "genuine junk does not escalate — that is where the saving comes from");
}

// -------------------------------------------------- the cheap answer is kept
{
  const cheap = reasonerReturning("cheap", GOOD);
  const strong = reasonerReturning("strong", GOOD);
  const t = tieredReasoner(cheap, strong);
  const out = await t.classifyAndExtract!(msg("6 crew at Tobacco Dock on 12 September, 09:00 - 16:00"), [], false);
  ok(out.job_summary === "cheap", "a good cheap answer is returned as-is", out.job_summary);
  ok(strong.calls.length === 0, "the expensive model is never called", strong.calls.join(","));
  ok(t.tiers().cheapCalls === 1 && t.tiers().escalations === 0, "the counters record one cheap call, no escalation", JSON.stringify(t.tiers()));
}

// ---------------------------------------- a suspect answer is replaced, not merged
{
  const cheap = reasonerReturning("cheap", { requests: [] });          // job, no blocks
  const strong = reasonerReturning("strong", GOOD);
  const t = tieredReasoner(cheap, strong);
  const out = await t.classifyAndExtract!(msg("6 crew at Tobacco Dock on 12 September, 09:00 - 16:00"), [], false);
  ok(out.job_summary === "strong", "the strong model's answer wins outright", out.job_summary);
  ok(out.facts.requests.length === 1, "and its facts are used, not blended with the cheap ones");
  ok(t.tiers().escalations === 1, "the escalation is counted");
  ok(Object.keys(t.tiers().reasons)[0]?.includes("no usable work block"), "with the reason recorded",
     JSON.stringify(t.tiers().reasons));
}

// -------------------------------------- the incremental call tiers the same way
{
  const cheap = reasonerReturning("cheap", { requests: [] });
  const strong = reasonerReturning("strong", GOOD);
  const t = tieredReasoner(cheap, strong);
  const out = await t.classifyAndExtractIncremental!(msg("6 crew on 12 September 09:00-16:00"), GOOD, "new-job", false);
  ok(out.job_summary === "strong", "a suspect incremental answer escalates too", out.job_summary);
}

// ------------------------------------------- prose always goes to the strong model
{
  const cheap = reasonerReturning("cheap", GOOD);
  const strong = reasonerReturning("strong", GOOD);
  const t = tieredReasoner(cheap, strong);
  await t.composeReply(msg("hello"), [], "new-job");
  ok(strong.calls.includes("strong:reply"), "composeReply goes straight to the strong model");
  ok(!cheap.calls.length, "the cheap model never writes a client-facing reply", cheap.calls.join(","));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
