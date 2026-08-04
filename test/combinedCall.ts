// ============================================================================
// One model call per thread, and a history that does not grow without limit.
// ----------------------------------------------------------------------------
// classify and extractFacts were handed identical thread text and differed only in the
// question asked, so every thread crossed the wire twice; overruling a rejection needed
// the facts as well, making it three. Measured over the corpus that is 402M characters
// to label it once, at $0.247 a thread.
//
// This checks the two things that saving depends on:
//   1. the compiler makes ONE reasoner call when the reasoner can answer both, and
//      still works with a reasoner that cannot (a mock, another provider);
//   2. history is capped, the newest message is never truncated, and what is dropped
//      is the OLDEST — what a client last said outranks what they said in March.
//
// Offline. No model, no network.  npx tsx test/combinedCall.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationFacts } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const FACTS: ConversationFacts = {
  company_name: "RedBeast Energy",
  contact_email: "pier@redbeast.co.uk",
  location_text: "2 Savoy Place London WC2R 0BL United Kingdom",
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "12:00", size: 4, task: "Load in" }],
};

/** Counts what the compiler actually asks for. */
function countingReasoner(withCombined: boolean) {
  const calls: string[] = [];
  const r: Reasoner = {
    async classify(): Promise<ClassifyResult> {
      calls.push("classify");
      return { classification: "not-a-job", priority: "low", job_summary: "N/A - acknowledgement only" };
    },
    async extractFacts(): Promise<ConversationFacts> {
      calls.push("extractFacts");
      return FACTS;
    },
    async composeReply(): Promise<ReplyResult> {
      calls.push("composeReply");
      return { subject: "Re", html: "<p>ok</p>", priority: "low" };
    },
  };
  if (withCombined) {
    r.classifyAndExtract = async () => {
      calls.push("classifyAndExtract");
      return { classification: "not-a-job", priority: "low", job_summary: "N/A - acknowledgement only", facts: FACTS };
    };
  }
  return { reasoner: r, calls };
}

const onsinch = new OnsinchClient(mockTransport);
const thread = {
  thread_id: "t-combined",
  messages: [
    msg({ from: "pier@redbeast.co.uk", body: "Please quote 4 crew on 9 March, 08:00-12:00.", subject: "Crew request" }),
    msg({ from: "bookings@spartancrew.co.uk", body: "Thanks, noted.", subject: "Re: Crew request" }),
  ],
};
const run = (reasoner: Reasoner) =>
  compile(thread, undefined, { reasoner, onsinch, now: () => Date.parse("2026-03-01T09:00:00Z"), repliesEnabled: false });

async function main() {
  console.log("\n[1] a reasoner that answers both is asked once");
  {
    const { reasoner, calls } = countingReasoner(true);
    const r = await run(reasoner);
    ok(calls.length === 1, "exactly one reasoner call", calls.join(",") || "(none)");
    ok(calls[0] === "classifyAndExtract", "and it is the combined one", calls[0]);
    ok(r.state.classification === "new-job", "the rejection is still overruled from those facts", r.state.classification);
    ok(!!r.state.desired_order, "an order was composed without a second call");
  }

  console.log("\n[2] a reasoner that cannot still works, at the old cost");
  {
    const { reasoner, calls } = countingReasoner(false);
    const r = await run(reasoner);
    ok(calls.includes("classify") && calls.includes("extractFacts"), "falls back to two calls", calls.join(","));
    ok(r.state.classification === "new-job", "same verdict as the combined path", r.state.classification);
  }

  console.log("\n[3] history is capped, newest kept, oldest dropped");
  {
    // Reach the prompt text through the real reasoner by intercepting fetch: nothing is
    // sent anywhere, the request body is simply captured.
    const realFetch = globalThis.fetch;
    let sent = "";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = String(init?.body ?? "");
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ classification: "not-a-job", priority: "low", job_summary: "x", facts: FACTS }) } }] } }] };
        },
      } as unknown as Response;
    }) as typeof fetch;

    process.env.REASONER_HISTORY_CAP = "500";
    const reasoner = createOpenRouterReasoner({ apiKey: "test" });
    const history = Array.from({ length: 40 }, (_, i) =>
      msg({ from: "pier@redbeast.co.uk", subject: "old", body: `OLD MESSAGE ${i} ` + "x".repeat(120), date_iso: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T09:00:00Z` })
    );
    const latest = msg({ from: "pier@redbeast.co.uk", subject: "NEWEST SUBJECT", body: "NEWEST BODY " + "y".repeat(4000) });
    await reasoner.classifyAndExtract!(latest, history, false);
    globalThis.fetch = realFetch;
    delete process.env.REASONER_HISTORY_CAP;

    const body = JSON.parse(sent);
    const userMsg = String(body.messages.find((m: any) => m.role === "user").content);
    ok(userMsg.includes("NEWEST SUBJECT") && userMsg.includes("y".repeat(4000)), "the newest message is sent whole, never truncated");
    ok(userMsg.includes("OLD MESSAGE 39"), "the most recent history survives", "kept");
    ok(!userMsg.includes("OLD MESSAGE 0"), "the oldest history is what gets dropped");
    ok(/earlier message\(s\) omitted for length/.test(userMsg), "and the omission is stated, not silent");
    const historyPart = userMsg.split("HISTORY (oldest first):")[1] ?? "";
    ok(historyPart.length < 900, "history stays near the cap", `${historyPart.length} chars against a 500 cap`);
    ok(body.max_tokens === 4096, "the reply ceiling is capped too", String(body.max_tokens));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
