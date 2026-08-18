// ============================================================================
// Two threads, one job — the floor, and what a match is allowed to produce.
//
// Ben, Q4 (2026-08-18): same client AND same date AND same venue. All three.
// Ben, Q6: the output is an INTERNAL draft to bookings@, never a client email.
// Ben, standing: a cross-thread suspicion produces a draft email only, NEVER an order.
//
// Run: npx tsx test/crossThread.ts
// ============================================================================
import { findCrossThreadMatches, crossThreadDraft, type ThreadShape, type InternalDraft } from "../app/lib/engine/crossThread";
import { handleThread, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const shape = (over: Partial<ThreadShape>): ThreadShape => ({
  thread_id: "t", company_id: 42, place_id: 88,
  dates: ["2026-03-09"], windows: ["08:00-18:00"], sizes: [6], ...over,
});

console.log("\n[1] the floor is all three, never two");
{
  const current = shape({ thread_id: "a" });
  ok(findCrossThreadMatches(current, [shape({ thread_id: "b" })]).length === 1, "client + date + venue matches");
  ok(findCrossThreadMatches(current, [shape({ thread_id: "b", company_id: 43 })]).length === 0,
    "a different client does not");
  ok(findCrossThreadMatches(current, [shape({ thread_id: "b", dates: ["2026-03-10"] })]).length === 0,
    "a different date does not");
  ok(findCrossThreadMatches(current, [shape({ thread_id: "b", place_id: 99 })]).length === 0,
    "a different venue does not — 121 of 870 company+date keys already carry more than one order");
}

console.log("\n[2] a thread with nothing to match on matches nothing");
{
  ok(findCrossThreadMatches(shape({ thread_id: "a", company_id: undefined }), [shape({ thread_id: "b" })]).length === 0,
    "no client, no match");
  ok(findCrossThreadMatches(shape({ thread_id: "a", dates: [] }), [shape({ thread_id: "b" })]).length === 0,
    "no date, no match");
  ok(findCrossThreadMatches(shape({ thread_id: "a" }), []).length === 0, "nothing to compare against");
  ok(findCrossThreadMatches(shape({ thread_id: "a" }), [shape({ thread_id: "a" })]).length === 0,
    "and a thread never matches itself");
}

console.log("\n[3] an unresolved venue does not become a wildcard");
{
  const noPlace = (over: Partial<ThreadShape>) => shape({ place_id: undefined, ...over });
  ok(findCrossThreadMatches(noPlace({ thread_id: "a", location_text: "ExCeL London" }),
    [noPlace({ thread_id: "b", location_text: "excel  london" })]).length === 1,
    "two unresolved venues match on the words");
  ok(findCrossThreadMatches(noPlace({ thread_id: "a", location_text: "ExCeL London" }),
    [noPlace({ thread_id: "b", location_text: "Olympia London" })]).length === 0,
    "different words do not");
  ok(findCrossThreadMatches(noPlace({ thread_id: "a" }), [noPlace({ thread_id: "b" })]).length === 0,
    "and two threads that both named NO venue are not a match");
  ok(findCrossThreadMatches(noPlace({ thread_id: "a", location_text: "ExCeL" }),
    [noPlace({ thread_id: "b", location_text: "ExCeL" })]).length === 0,
    "a venue string too short to mean anything is not enough");
}

console.log("\n[4] a different window is an EXTRA slot team, not a duplicate");
{
  // The same rule that splits teams inside one thread, arriving as a second email.
  const m = findCrossThreadMatches(
    shape({ thread_id: "a", windows: ["08:00-12:00"] }),
    [shape({ thread_id: "b", windows: ["14:00-22:00"] })]
  );
  ok(m[0]?.relation === "extension", "relation is extension", m[0]?.relation);
  ok(m[0].reasons.some((r) => /extra slot team/.test(r)), "and the reason says so, not 'duplicate'");

  const dup = findCrossThreadMatches(shape({ thread_id: "a" }), [shape({ thread_id: "b" })]);
  ok(dup[0]?.relation === "duplicate", "same window and same size IS a duplicate", dup[0]?.relation);

  const vague = findCrossThreadMatches(
    shape({ thread_id: "a", windows: [], sizes: [] }),
    [shape({ thread_id: "b", windows: [], sizes: [] })]
  );
  ok(vague[0]?.relation === "unclear", "and neither is claimed when neither stated a time", vague[0]?.relation);
}

console.log("\n[5] reinforcers rank, they do not gate");
{
  const m = findCrossThreadMatches(shape({ thread_id: "a" }), [
    shape({ thread_id: "weak", windows: ["06:00-09:00"], sizes: [2] }),
    shape({ thread_id: "strong" }),
  ]);
  ok(m.length === 2, "both are through the floor", String(m.length));
  ok(m[0].thread_id === "strong", "the stronger one is named first", m[0].thread_id);
  ok(m[1].score < m[0].score, "on score, not on order of arrival");
}

console.log("\n[6] Q6: the output is an internal draft, and it commits to nothing");
{
  const current = shape({ thread_id: "a", subject: "Crew for the 9th" });
  const draft = crossThreadDraft(current, findCrossThreadMatches(current, [shape({ thread_id: "b" })]))!;
  ok(draft.to === "bookings@spartancrew.co.uk", "addressed to ops, never the client", draft.to);
  ok(/No order has been created or changed/.test(draft.body), "says plainly that nothing was written");
  ok(/will not guess/.test(draft.body), "and asks for a decision rather than making one");
  ok(draft.body.includes("b"), "names the other thread");
  ok(crossThreadDraft(current, []) === null, "no match, no draft — this must cost nothing when it finds nothing");
}

async function throughThePipeline() {
  console.log("\n[7] through the pipeline: a twin HOLDS the order, it never writes one");
  // The whole point. A cross-thread same-job suspicion produces a draft email only,
  // because the failure being prevented is a second OnSinch order for a job that
  // already exists — and crew booked twice for it.
  const store = new InMemoryStore();
  const written: unknown[] = [];
  const drafts: InternalDraft[] = [];
  const onsinch = new OnsinchClient(mockTransport);
  let clock = 1;
  const deps: PipelineDeps = {
    reasoner: mockReasoner, onsinch, now: () => ++clock, store,
    metrics: new InMemoryMetrics(), settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => JSON.stringify(o),
    executor: {
      async createReplyDraft() { return "d"; },
      async createOrder(o) { written.push(o); return onsinch.createOrder(buildOrderBody(o)); },
      async patchOrder() {},
      async createInternalDraft(d) { drafts.push(d); return "internal-1"; },
    },
  };
  const body = "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?";
  const first = await handleThread({ thread_id: "x1", messages: [msg({ message_id: "x1a", body })] }, deps);
  ok(first.onsinch_order_id === 9001, "the first thread books normally", String(first.onsinch_order_id));
  ok(drafts.length === 0, "and raises no question");

  const second = await handleThread({ thread_id: "x2", messages: [msg({ message_id: "x2a", body })] }, deps);
  ok(written.length === 1, "the SECOND thread wrote no order", String(written.length));
  ok(second.onsinch_order_id === undefined, "it has no order id of its own");
  ok(second.status === "proposed" && !!second.pending_order, "it is held, with the composed order kept");
  ok(second.notes.some((n) => /same job as thread x1/.test(n)), "the ticket names the thread it clashed with",
    JSON.stringify(second.notes));
  ok(drafts.length === 1 && drafts[0].to === "bookings@spartancrew.co.uk", "and ops got one internal draft",
    String(drafts.length));
}

throughThePipeline().then(() => {
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
});
