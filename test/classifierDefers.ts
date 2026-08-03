// ============================================================================
// The classifier does not get to veto the extractor.
// ----------------------------------------------------------------------------
// The classifier judges only the newest email — the live prompt says so outright
// ("Never classify Thread History messages. Only classify Current Email") — so a
// thread whose latest message is Spartan's own reply, a bounce-back or an emoji
// reaction was called not-a-job while the client's request sat one message earlier.
//
// Measured over a 150-thread random sample of the swept year: 91 threads came back
// not-a-job, 28 of them carrying a crew number and a date, and 21 of the 41 with a
// dated block had become real OnSinch orders anyway. Fifteen were read by hand and 13
// were genuine jobs — a booking lost each time.
//
// So where the extractor finds a dated request WITH a crew size, it wins. The two
// noise shapes that survive the rule are checked here too, because the rule is only
// safe if "a date and a number" is what it keys on rather than any date at all.
//
// Offline. No model, no network.  npx tsx test/classifierDefers.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationFacts } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/**
 * A reasoner that behaves the way the live one does on these threads: it always
 * rejects (it is only shown the newest message), while the extractor reads the whole
 * thread. What the extractor returns is the variable under test.
 */
function rejectingReasoner(requests: ConversationFacts["requests"]): Reasoner {
  return {
    async classify(): Promise<ClassifyResult> {
      return { classification: "not-a-job", priority: "low", job_summary: "N/A - acknowledgement only, no crew request" };
    },
    async extractFacts(): Promise<ConversationFacts> {
      return {
        company_name: "RedBeast Energy",
        contact_name: "Pier",
        contact_email: "pier@redbeast.co.uk",
        location_text: "2 Savoy Place London WC2R 0BL United Kingdom",
        requests,
      };
    },
    async composeReply(): Promise<ReplyResult> {
      return { subject: "Re", html: "<p>ok</p>", priority: "low" };
    },
  };
}

// The client's request comes first; Spartan's own reply is newest, which is all the
// classifier is ever shown.
const thread = (body: string) => ({
  thread_id: "t-defer",
  messages: [
    msg({ from: "pier@redbeast.co.uk", body: "Please quote 4 crew on 9 March, 08:00-18:00.", subject: "Crew request" }),
    msg({ from: "bookings@spartancrew.co.uk", body, subject: "Re: Crew request" }),
  ],
});

const onsinch = new OnsinchClient(mockTransport);
const run = (reasoner: Reasoner, body: string) =>
  compile(thread(body), undefined, {
    reasoner,
    onsinch,
    now: () => Date.parse("2026-03-01T09:00:00Z"),
    repliesEnabled: false,
  });

async function main() {
  console.log("\n[1] a dated request with a crew size overrules the rejection");
  {
    const r = await run(
      rejectingReasoner([{ date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4, task: "Load in" }]),
      "Thanks, noted." // Spartan's own reply — all the classifier ever sees
    );
    ok(r.state.classification === "new-job", "classified as new-job, not not-a-job", r.state.classification);
    ok(!!r.state.desired_order, "an order was composed");
    ok(
      (r.state.notes || []).some((n) => /deferring to the extractor/i.test(n)),
      "the override is recorded in the notes, not silent"
    );
    // The classifier's job_summary on a rejected thread is its REASON for rejecting.
    // Left as the specification, an overruled thread would create an order whose
    // description says no job was requested.
    const spec = String(r.state.desired_order?.specification ?? "");
    ok(!/not-a-job|no crew request|acknowledgement only|^N\/A/i.test(spec),
      "the order's specification is not the rejection reason", JSON.stringify(spec).slice(0, 60));
    ok(spec.length > 0, "the order still has a specification");
  }

  console.log("\n[2] a date with NO crew size does not overrule it");
  {
    const r = await run(
      rejectingReasoner([{ date: "2026-03-09", start_time: "08:00", end_time: "18:00", task: "Mentioned in passing" }]),
      "Thanks, noted."
    );
    ok(r.state.classification === "not-a-job", "still not-a-job", r.state.classification);
    ok(!r.state.desired_order, "no order composed");
  }

  console.log("\n[3] a crew size with NO date does not overrule it");
  {
    const r = await run(
      rejectingReasoner([{ size: 4, task: "Complaint about the 4 crew who attended" }]),
      "Feedback from the show — who was late?"
    );
    ok(r.state.classification === "not-a-job", "still not-a-job", r.state.classification);
    ok(!r.state.desired_order, "no order composed");
  }

  console.log("\n[4] nothing extracted at all leaves the rejection and its reason intact");
  {
    const r = await run(rejectingReasoner([]), "Thanks!");
    ok(r.state.classification === "not-a-job", "still not-a-job", r.state.classification);
    ok(
      (r.state.notes || []).some((n) => /acknowledgement only/i.test(n)),
      "the classifier's own reason survives for the Dismissed lane"
    );
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
