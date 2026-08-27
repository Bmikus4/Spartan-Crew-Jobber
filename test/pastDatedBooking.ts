// ============================================================================
// Crew cannot be booked for a day that has gone.
// ----------------------------------------------------------------------------
// A live test on 2026-08-27 said "Thu 24 & Fri 25 Oct 2024" and the engine booked it:
// order 15573, dated 2024-10-23, twenty-two months in the past. It reported `ordered`,
// it was a real row on a real client, and it was filed where nobody would ever look.
// Ben: "i cant see the jobs inside of onsinch."
//
// WRITING IT IS WORSE THAN REFUSING, because it succeeds. A refusal puts the thread on
// the board asking for a date; a success puts a phantom booking in the tenant and tells
// everyone the job is handled.
//
// THIS DOES NOT CONTRADICT THE YEAR RULE. `parseWork` rolls a BARE day/month forward to
// its next occurrence and deliberately leaves an EXPLICIT past year alone, because a
// client can legitimately write "3rd March 2024" when querying an old invoice. That
// holds for READING the date. It does not extend to booking crew for it. The date is
// still read as written — and then the order is held instead of sent.
//
// THE CLOCK IS THE INJECTED ONE. Writing this against `Date.now()` turned nine test
// files red at once and would have made every dated fixture in the repo rot on a fixed
// day. It also caught two rigs whose own clocks sat AFTER the jobs they were booking:
// test/seam.ts and sim/harness.ts were both simulating work that had already happened.
//
// Run: npx tsx test/pastDatedBooking.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import type { ConversationFacts, ThreadMessage } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const NOW = Date.parse("2026-08-27T12:00:00Z");

const thread = (body: string) => ({
  thread_id: "t-past",
  messages: [{
    message_id: "m1", from: "jane@bigevents.co.uk", to: ["bookings@spartancrew.co.uk"],
    date_iso: "2026-08-27T09:00:00Z", subject: "Crew needed", body, is_from_spartan: false,
  } as ThreadMessage],
});

/** A reasoner that returns exactly the dates the case is about. */
const reasonerFor = (requests: Array<Record<string, unknown>>) => ({
  async classifyAndExtract() {
    return {
      classification: "new-job", priority: "high", job_summary: "crew request",
      facts: {
        company_name: "Big Events Ltd", contact_name: "Jane",
        contact_email: "jane@bigevents.co.uk", location_text: "ExCeL London",
        requests,
      } as ConversationFacts,
    };
  },
  async classify() { return { classification: "new-job", priority: "high", job_summary: "x" }; },
  async extractFacts() { return { requests } as ConversationFacts; },
  async composeReply() { return { subject: "", html: "", priority: "medium" }; },
});

const onsinch = {
  async allCompanies() { return [{ id: 501, name: "Big Events Ltd", invoice_name: "Big Events Ltd" }]; },
  async allPlaces() { return [{ id: 49, name: "ExCeL London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true }]; },
  async companyClients() { return [{ id: 9001, email: "jane@bigevents.co.uk" }]; },
  // The rate-card derivation reads the client's order history. One prior order on card
  // 315 means the card is DERIVED, so the I1 hold never fires and these cases measure
  // the date rule alone.
  async companyOrdersWithJob() {
    return [{ id: 1, happening: "2026-01-05T08:00:00+00:00", Job: [{ pricelist_category_id: 315 }] }];
  },
} as never;

const run = (requests: Array<Record<string, unknown>>) =>
  compile(thread("We need crew at ExCeL London, details as below.") as never, undefined, {
    reasoner: reasonerFor(requests), onsinch, now: () => NOW,
    repliesEnabled: false, seededRateCard: async () => 315,
  } as never);

(async () => {
  console.log("\n[1] every shift already happened -> NOT booked");
  {
    const { state } = await run([{ date: "2024-10-24", start_time: "07:00", end_time: "19:00", size: 15, task: "Event day" }]);
    ok(!state.desired_order || state.needs_human, "held for a human", `needs_human=${state.needs_human}`);
    ok((state.notes ?? []).some((n) => /NOT BOOKED/.test(n)), "and says so unmissably", JSON.stringify(state.notes).slice(0, 200));
    ok((state.notes ?? []).some((n) => /past date/i.test(n)), "naming the reason a client would need to fix");
  }

  console.log("\n[2] a job in the future books normally");
  {
    const { state } = await run([{ date: "2027-10-24", start_time: "07:00", end_time: "19:00", size: 15, task: "Event day" }]);
    ok(!(state.notes ?? []).some((n) => /NOT BOOKED/.test(n)), "no past-date hold", JSON.stringify(state.notes).slice(0, 160));
    ok(!!state.desired_order, "an order was composed");
  }

  console.log("\n[3] A PART-PAST JOB STILL BOOKS — the case that would break real work");
  {
    // Mid-job is an ordinary shape: the load-in has happened, the show days have not.
    // Only an order with NO future work at all is stopped.
    const { state } = await run([
      { date: "2026-08-25", start_time: "12:00", end_time: "18:00", size: 6, task: "Load-in" },
      { date: "2026-09-02", start_time: "07:00", end_time: "19:00", size: 15, task: "Show day" },
    ]);
    ok(!(state.notes ?? []).some((n) => /NOT BOOKED/.test(n)), "not held — there is still work ahead");
    ok(!!state.desired_order, "and the order is composed");
  }

  console.log("\n[4] today's job is not 'the past'");
  {
    // Compiled at midday for a shift that started at 08:00. A same-day booking is real
    // work ops still act on, which is why the grace is a whole day rather than "before
    // now".
    const { state } = await run([{ date: "2026-08-27", start_time: "08:00", end_time: "18:00", size: 4, task: "Build" }]);
    ok(!(state.notes ?? []).some((n) => /NOT BOOKED/.test(n)), "same-day still books");
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
