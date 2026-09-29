// ============================================================================
// Dismissing a follow-up mutes ONE silence, not a client.
// ----------------------------------------------------------------------------
// The obvious shape for "stop chasing this" is a boolean on the thread. It is also
// the shape with the failure nobody notices: a thread muted in September is still
// muted in December, a real enquiry arrives, and the row that exists to stop work
// being forgotten is the thing forgetting it. Nobody ever unmutes, because an
// unmuted thread and a thread nobody is waiting on look identical from outside.
//
// So a dismissal records the flip point it dismissed — the exact moment clock.ts
// says the current wait began. When anybody speaks, the flip point moves, the stored
// value stops matching, and the thread is live again with a fresh clock. Nothing has
// to expire and nobody has to remember anything.
//
// Offline. No network, no database.  npx tsx test/followupSuppression.ts
// ============================================================================
import { isSuppressed, type Suppression } from "../app/lib/followup/suppressionDb";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const MONDAY = "2026-09-14T09:00:00.000Z";
const FRIDAY = "2026-09-18T11:00:00.000Z";

const dismissal = (since: string): Suppression => ({
  thread_id: "t1", waiting_since_iso: since, suppressed_by: "ben@spartancrew.co.uk", reason: null,
});

console.log("\n[1] the wait that was dismissed stays dismissed");
{
  ok(isSuppressed(dismissal(MONDAY), MONDAY), "same flip point, still muted");
}

console.log("\n[2] a LATER wait on the same thread is not muted by an older click");
{
  /**
   * THE CASE A THREAD-LEVEL BOOLEAN GETS WRONG. Somebody dismissed Monday's silence
   * because the client had rung. On Friday the client writes again, nobody answers,
   * and a new wait opens at a new flip point. That one has never been dismissed by
   * anyone and must raise an alert.
   */
  ok(!isSuppressed(dismissal(MONDAY), FRIDAY),
    "a new silence is a new question, and nobody has answered it yet");
}

console.log("\n[3] no dismissal means no suppression");
{
  ok(!isSuppressed(undefined, MONDAY), "an absent row mutes nothing");
}

console.log("\n[4] the comparison is exact, because a flip point is an identity not a range");
{
  ok(!isSuppressed(dismissal(MONDAY), "2026-09-14T09:00:01.000Z"),
    "one second later is a different message, so a different wait");
  ok(!isSuppressed(dismissal(MONDAY), ""), "and an empty flip point matches nothing");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
