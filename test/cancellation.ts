// ============================================================================
// A cancellation is recognised, and never acted on.
//
// The engine had no way to say "cancellation" at all: classify returns new-job |
// update | confirmation-only | not-a-job, so "please cancel Tuesday" arrived as an
// update and composed as an order with Tuesday missing — which, applied, would strip
// a live booking on the strength of a class the model was never given.
//
// It is a FLAG, not a fifth class. A cancellation IS an update, one email can cancel
// one day and add another, and every consumer of the enum branches on four values.
// The swept corpus already models it the same way (sweep_labels.is_cancellation).
//
// The engine never acts on it: cancelling in OnSinch is destructive with no undo, and
// the flag comes from the same model that reads "postponed" and "we may need to pull
// Thursday". Being wrong empties a job that is still happening.
//
// Run: npx tsx test/cancellation.ts
// ============================================================================
import { handleThread, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import type { Reasoner } from "../app/lib/engine/reason";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const BODY = "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?";

/** The mock brain, with the cancellation flag forced on for the second message. */
function reasonerThatCancels(): Reasoner {
  return {
    ...mockReasoner,
    async classify(latest, history, priorOrderExists) {
      const base = await mockReasoner.classify(latest, history, priorOrderExists);
      return { ...base, cancellation: /cancel/i.test(latest.body) };
    },
    // The mock has no combined call; the compiler falls back to classify + extract,
    // which is the path this needs anyway.
    classifyAndExtract: undefined,
    classifyAndExtractIncremental: undefined,
  } as Reasoner;
}

function build() {
  const store = new InMemoryStore();
  const written: unknown[] = [];
  const patched: unknown[] = [];
  const onsinch = new OnsinchClient(mockTransport);
  let clock = 1;
  const deps: PipelineDeps = {
    reasoner: reasonerThatCancels(), onsinch, now: () => ++clock, store,
    metrics: new InMemoryMetrics(), settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => JSON.stringify(o),
    executor: {
      async createReplyDraft() { return "d"; },
      async createOrder(o) { written.push(o); return onsinch.createOrder(buildOrderBody(o)); },
      async patchOrder(p) { patched.push(p); },
    },
  };
  return { deps, written, patched, store };
}

async function main() {
  console.log("\n[1] an ordinary booking is unaffected");
  {
    const { deps, written } = build();
    const s = await handleThread({ thread_id: "c1", messages: [msg({ message_id: "a", body: BODY })] }, deps);
    ok(s.cancellation === false, "the flag is off", String(s.cancellation));
    ok(written.length === 1 && s.onsinch_order_id === 9001, "and it books normally", String(written.length));
  }

  console.log("\n[2] a cancellation holds, and writes NOTHING");
  {
    const { deps, written, patched } = build();
    await handleThread({ thread_id: "c2", messages: [msg({ message_id: "a", body: BODY })] }, deps);
    const before = written.length;
    const s = await handleThread({ thread_id: "c2", messages: [
      msg({ message_id: "a", date_iso: "2026-02-12T10:00:00Z", body: BODY }),
      msg({ message_id: "b", date_iso: "2026-02-13T10:00:00Z", body: "Please cancel this job, the event is off." }),
    ] }, deps);
    ok(s.cancellation === true, "the flag is set", String(s.cancellation));
    ok(written.length === before, "no order was created", `${written.length} vs ${before}`);
    ok(patched.length === 0, "and none was patched — the engine does not shrink a booking", String(patched.length));
    ok(s.status === "proposed" && !!s.pending_order, "it is held, with the composed order kept to look at");
    ok(s.notes.some((n) => /does not cancel or shrink/.test(n)), "the ticket says the engine will not do it",
      JSON.stringify(s.notes.slice(-1)));
  }

  console.log("\n[3] the order it already has is left alone");
  {
    const { deps } = build();
    const first = await handleThread({ thread_id: "c3", messages: [msg({ message_id: "a", body: BODY })] }, deps);
    const s = await handleThread({ thread_id: "c3", messages: [
      msg({ message_id: "a", date_iso: "2026-02-12T10:00:00Z", body: BODY }),
      msg({ message_id: "b", date_iso: "2026-02-13T10:00:00Z", body: "Cancel the Tuesday please." }),
    ] }, deps);
    ok(s.onsinch_order_id === first.onsinch_order_id,
      "the live order is still linked to the thread — holding must not orphan it",
      `${s.onsinch_order_id} vs ${first.onsinch_order_id}`);
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}
main();
