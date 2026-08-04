// ============================================================================
// Reading each message once must not lose what the earlier messages said.
// ----------------------------------------------------------------------------
// This is the risk the incremental path introduces. The model no longer sees messages
// 1..n-1, so if a narrow reply ("yes, confirmed") returns thin facts and we overwrite,
// the venue and dates that took four emails to establish are gone — and nothing would
// report it, because the order would simply come out incomplete.
//
// Fixtures only. No provider, no key, no spend.
// ============================================================================
import { mergeFacts, describeMerge } from "../app/lib/engine/mergeFacts";
import { compile } from "../app/lib/engine/compiler";
import type { ConversationFacts, ConversationState, HydratedThread, ThreadMessage } from "../app/lib/engine/types";
import type { Reasoner } from "../app/lib/engine/reason";
import { OnsinchClient } from "../app/lib/engine/onsinch";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const ESTABLISHED: ConversationFacts = {
  company_name: "Event Concept",
  contact_name: "Izzabelle McGuinness",
  contact_email: "izzabelle.mcguinness@eventconcept.com",
  location_text: "Tobacco Dock, London E1W 2SF",
  requests: [{ date: "2026-09-12", start_time: "08:00", end_time: "17:00", size: 6, task: "get-in" }],
};

console.log("incremental read");

async function main() {

// ---------------------------------------------------------------- mergeFacts
{
  // The dangerous case: a confirmation that answers nothing.
  const { facts, report } = mergeFacts(ESTABLISHED, { requests: [] });
  ok(facts.location_text === "Tobacco Dock, London E1W 2SF", "a thin reply does not blank the venue");
  ok(facts.company_name === "Event Concept", "a thin reply does not blank the company");
  ok((facts.requests ?? []).length === 1, "a thin reply does not delete the work blocks");
  ok(report.requestsKept, "the report says the blocks were kept");
  ok(describeMerge(report) === "", "a message that changed nothing describes nothing");
}
{
  // A real change must win, and be reported.
  const { facts, report } = mergeFacts(ESTABLISHED, {
    requests: [{ date: "2026-09-19", start_time: "08:00", end_time: "17:00", size: 8, task: "get-in" }],
  });
  ok(facts.requests[0].date === "2026-09-19", "a moved date replaces the old one");
  ok(facts.requests[0].size === 8, "a changed crew size replaces the old one");
  ok(report.changed.includes("requests"), "the change is reported", report.changed.join(","));
  ok(facts.location_text === "Tobacco Dock, London E1W 2SF", "changing the date keeps the venue");
}
{
  // A gap being filled is the whole point of the update loop.
  const { facts, report } = mergeFacts({ company_name: "Event Concept", requests: [] },
    { location_text: "Olympia London", requests: [{ date: "2026-10-01", size: 4 }] });
  ok(facts.location_text === "Olympia London", "a later message fills a missing venue");
  ok(report.filled.includes("location_text"), "the fill is reported");
  ok(report.filled.includes("requests"), "first blocks count as filled, not changed");
  ok(/filled/.test(describeMerge(report)), "the description names the fill", describeMerge(report));
}
{
  // Empty-object requests are noise from a lax schema, not an answer.
  const { facts } = mergeFacts(ESTABLISHED, { requests: [{}, {}] as ConversationFacts["requests"] });
  ok((facts.requests ?? [])[0]?.date === "2026-09-12", "requests of empty objects are treated as silence");
}
{
  // Whitespace is not an answer either.
  const { facts } = mergeFacts(ESTABLISHED, { location_text: "   ", requests: [] });
  ok(facts.location_text === "Tobacco Dock, London E1W 2SF", "a whitespace answer does not blank a field");
}
{
  const { facts } = mergeFacts(undefined, { location_text: "Excel", requests: [] });
  ok(facts.location_text === "Excel", "no prior state still returns the new facts");
}

// ------------------------------------------------- the compiler takes the path
{
  const calls: string[] = [];
  const reasoner: Reasoner = {
    async classifyAndExtract() {
      calls.push("full");
      return { classification: "update", priority: "medium", job_summary: "s", facts: { requests: [] } };
    },
    async classifyAndExtractIncremental(_latest, priorFacts) {
      calls.push("incremental");
      // Prove the prior facts genuinely arrive at the model boundary.
      ok(priorFacts.location_text === "Tobacco Dock, London E1W 2SF", "prior facts reach the incremental call");
      return { classification: "update", priority: "medium", job_summary: "s", facts: { requests: [] } };
    },
    async classify() { calls.push("classify"); return { classification: "update", priority: "medium", job_summary: "s" }; },
    async extractFacts() { calls.push("extractFacts"); return { requests: [] }; },
    async composeReply() { calls.push("reply"); return { subject: "s", html: "h", priority: "medium" }; },
  };

  const msg = (id: string, body: string, iso: string, spartan = false): ThreadMessage => ({
    message_id: id, from: spartan ? "bookings@spartancrew.co.uk" : "izzabelle.mcguinness@eventconcept.com",
    to: ["bookings@spartancrew.co.uk"], date_iso: iso, subject: "Crew for Tobacco Dock", body,
    is_from_spartan: spartan,
  });

  const thread: HydratedThread = {
    thread_id: "t1",
    messages: [
      msg("m1", "We need 6 crew at Tobacco Dock on 12 September, 08:00-17:00.", "2026-08-01T09:00:00Z"),
      msg("m2", "Noted, confirming shortly.", "2026-08-01T10:00:00Z", true),
      msg("m3", "Yes, please go ahead and confirm.", "2026-08-02T09:00:00Z"),
    ],
  };

  const prior: ConversationState = {
    thread_id: "t1", subject: "Crew for Tobacco Dock",
    participants: ["izzabelle.mcguinness@eventconcept.com"],
    last_message_id: "m2", last_processed_epoch: 1,
    classification: "new-job", facts: ESTABLISHED, desired_order: null,
    priority: "medium", needs_human: false, status: "drafted", notes: [], order_action_log: [],
  } as ConversationState;

  // No OnSinch reachable: the transport throws, which the compiler treats as unresolved.
  // Empty lists rather than a throw: the point under test is the model boundary, and an
  // OnSinch outage is a different test. Nothing resolves, so the order lands needs-human.
  const onsinch = new OnsinchClient(async () => ({ status: 200, data: { data: [], pagination: { pageCount: 1, count: 0 } } }));

  const { state } = await compile(thread, prior, {
    reasoner, onsinch, now: () => 2, repliesEnabled: false,
  } as never);

  ok(calls.includes("incremental"), "a thread with stored facts takes the incremental call", calls.join(","));
  ok(!calls.includes("full"), "and does NOT re-send the whole thread", calls.join(","));
  ok(calls.filter((c) => c !== "incremental").length === 0, "exactly one model call for this message", calls.join(","));
  ok(state.facts.location_text === "Tobacco Dock, London E1W 2SF",
     "the venue survived a message that mentioned no venue", JSON.stringify(state.facts));
  ok((state.facts.requests ?? []).length === 1, "the work block survived too");
  ok(state.notes.some((n) => /earlier messages not re-read/.test(n)), "the state records that history was not re-read", state.notes.join(" | "));
}

// --------------------------------------------- a first message has no prior facts
{
  const calls: string[] = [];
  const reasoner: Reasoner = {
    async classifyAndExtract() { calls.push("full"); return { classification: "new-job", priority: "medium", job_summary: "s", facts: { requests: [] } }; },
    async classifyAndExtractIncremental() { calls.push("incremental"); return { classification: "new-job", priority: "medium", job_summary: "s", facts: { requests: [] } }; },
    async classify() { return { classification: "new-job", priority: "medium", job_summary: "s" }; },
    async extractFacts() { return { requests: [] }; },
    async composeReply() { return { subject: "s", html: "h", priority: "medium" }; },
  };
  const thread: HydratedThread = {
    thread_id: "t2",
    messages: [{
      message_id: "m1", from: "a@client.com", to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-08-01T09:00:00Z", subject: "crew", body: "We need 4 crew on 3 October at Olympia.",
      is_from_spartan: false,
    }],
  };
  // Empty lists rather than a throw: the point under test is the model boundary, and an
  // OnSinch outage is a different test. Nothing resolves, so the order lands needs-human.
  const onsinch = new OnsinchClient(async () => ({ status: 200, data: { data: [], pagination: { pageCount: 1, count: 0 } } }));
  await compile(thread, undefined, { reasoner, onsinch, now: () => 1, repliesEnabled: false } as never);
  ok(calls.includes("full") && !calls.includes("incremental"),
     "a brand-new thread uses the full call — there is no prior state to send instead", calls.join(","));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
