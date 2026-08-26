// ============================================================================
// A job this engine could not book gets tagged "Manual" — and a job it later books
// stops wearing the tag.
// ----------------------------------------------------------------------------
// Ben, 2026-08-26: "any that cannot be booked should pipe into n8n via webhook and
// mark the thread with a tag 'Manual'."
//
// TWO THINGS DECIDE WHETHER THIS IS USEFUL OR NOISE, and both are pinned here.
//
// WHAT COUNTS. A job the client asked for that is not, right now, correctly in
// OnSinch. `ignored` does NOT count — a newsletter, an out-of-office, a machine
// sender. Tagging those would put "Manual" on most of the mailbox inside a week and
// ops would stop reading it, which costs more than the tag saves.
//
// The shape that matters most is the easiest to miss: `needs_human` on a thread that
// HAS an order. The board shows an order and everything looks done, but the order
// disagrees with the client's latest email because the change could not be applied.
//
// ONCE PER TRANSITION, IN BOTH DIRECTIONS. A thread is re-read on every new message,
// so without the marker the tag would be re-posted on every reply — and a thread that
// later got booked would keep the tag forever, which is how a tag stops being read.
//
// Run: npx tsx test/manualTag.ts
// ============================================================================
import { cannotBeBooked, flagManualIfNeeded, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const st = (o: Partial<ConversationState>): ConversationState =>
  ({
    thread_id: "t1", classification: "new-job", status: "ordered",
    needs_human: false, notes: [], order_action_log: [], ...o,
  } as ConversationState);

/** A deps with a recording flagger, and a store so the marker can be read back. */
function rig(opts: { fail?: boolean } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const store = new InMemoryStore();
  const deps = {
    store,
    async flagForManual(a: Record<string, unknown>) {
      if (opts.fail) throw new Error("n8n said 200 with an empty body");
      sent.push(a);
    },
  } as unknown as PipelineDeps;
  return { sent, store, deps };
}

(async () => {
  console.log("\n[1] what counts as 'cannot be booked'");
  {
    ok(cannotBeBooked(st({ status: "error" })), "error");
    ok(cannotBeBooked(st({ status: "needs-info" })), "needs-info — held rather than guessed");
    ok(cannotBeBooked(st({ status: "ordered", needs_human: true, onsinch_order_id: 14866 })),
      "an order EXISTS but disagrees with the client — the one that looks done");
    ok(cannotBeBooked(st({ classification: "update", status: "error" })), "an update, not only a new job");
  }

  console.log("\n[2] what must NOT be tagged");
  {
    ok(!cannotBeBooked(st({ status: "ordered" })), "a booked job");
    ok(!cannotBeBooked(st({ status: "drafted" })), "a drafted reply");
    ok(!cannotBeBooked(st({ status: "proposed" })), "an order staged for a click");
    ok(!cannotBeBooked(st({ classification: "not-a-job", status: "ignored" })), "not a job at all");
    ok(!cannotBeBooked(st({ classification: "confirmation-only", status: "ordered" })), "a 'thanks, confirmed'");
    ok(!cannotBeBooked(st({ classification: "not-a-job", status: "error" })),
      "an out-of-office that ERRORED is still not something anyone asked to be booked");
  }

  console.log("\n[3] it fires once, carrying the engine's own last word");
  {
    const { sent, deps } = rig();
    const s = st({
      status: "needs-info",
      notes: ["read the whole conversation", "no rate card for \"Kestrel Brand Live\" — set one when confirming"],
      subject: "Crew for Thursday",
      onsinch_order_id: 14866,
      desired_order: { slot_teams: [{ size: 4, beginning: "2027-03-02T08:00:00+00:00" }, { size: 2, beginning: "2027-03-03T08:00:00+00:00" }] } as never,
    });
    await flagManualIfNeeded(s, deps);
    ok(sent.length === 1, "one post", String(sent.length));
    ok(sent[0].state === "manual", "state manual", String(sent[0].state));
    ok(String(sent[0].reason).includes("rate card"), "the reason is the LAST substantive note, not an invented summary", String(sent[0].reason));
    ok(sent[0].crew === 6, "crew totalled across the blocks", String(sent[0].crew));
    ok(Array.isArray(sent[0].dates) && (sent[0].dates as string[]).length === 2, "one entry per distinct date", JSON.stringify(sent[0].dates));
    ok(s.manual_flagged === true, "the marker is written so the next email does not re-post");

    // Second pass, nothing changed.
    await flagManualIfNeeded(s, deps);
    ok(sent.length === 1, "a re-read of the same thread posts nothing", String(sent.length));
  }

  console.log("\n[4] it comes OFF again when the job books");
  {
    const { sent, deps } = rig();
    const s = st({ status: "needs-info", notes: ["no date given"] });
    await flagManualIfNeeded(s, deps);
    ok(sent.length === 1 && sent[0].state === "manual", "tagged first");

    // The next email supplies the date and the order lands.
    s.status = "ordered";
    s.needs_human = false;
    s.onsinch_order_id = 15338;
    await flagManualIfNeeded(s, deps);
    ok(sent.length === 2, "a second post", String(sent.length));
    ok(sent[1].state === "cleared", "state cleared, so ops stop seeing it", String(sent[1].state));
    ok(String(sent[1].reason).includes("15338"), "and it says which order booked it", String(sent[1].reason));
    ok(s.manual_flagged === false, "the marker is cleared too");

    await flagManualIfNeeded(s, deps);
    ok(sent.length === 2, "and it does not keep announcing the good news", String(sent.length));
  }

  console.log("\n[5] a failed post is retried, never recorded as done");
  {
    const { deps } = rig({ fail: true });
    const s = st({ status: "error", notes: ["createOrder 500"] });
    await flagManualIfNeeded(s, deps);
    ok(s.manual_flagged !== true,
      "the marker stays unset, so the next email tries again rather than the thread going untagged forever",
      String(s.manual_flagged));
  }

  console.log("\n[6] no webhook configured means no tagging, and no error");
  {
    const s = st({ status: "error", notes: ["boom"] });
    await flagManualIfNeeded(s, { store: new InMemoryStore() } as unknown as PipelineDeps);
    ok(s.manual_flagged === undefined, "a preview deploy does not write labels into the live mailbox");
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
