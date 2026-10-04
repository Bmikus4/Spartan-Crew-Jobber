// ============================================================================
// expirePast — a needs-a-person flag on a job whose every day is over comes off.
// ----------------------------------------------------------------------------
// 232 threads carried needs_human on 10-03, 189 of them older than 7 days and the oldest
// from 07-29, with 43 stale pending_order rows (SP-40). Nothing ever cleared them, so the
// Needs labels and the TV's "needs" list were mostly jobs that had already happened, and
// the live ones were lost among them. A thread whose every requested and desired day is
// more than a day past is expired: its flags clear, its Needs label comes off (the caller
// runs flagManualIfNeeded), and a note says why. Capped per run so the label traffic
// stays inside Manual Tag's normal rate.
// ============================================================================
import type { ConversationState } from "./types";

export const MAX_EXPIRED_PER_RUN = 20;

/** Every day this thread asks for, from its requests and its desired shape. */
function daysOf(s: ConversationState): string[] {
  const asked = (s.facts?.requests ?? []).map((r) => String(r.date ?? "")).filter(Boolean);
  const shaped = (s.desired_order?.slot_teams ?? []).map((t) => String(t.beginning ?? "").slice(0, 10)).filter(Boolean);
  return [...asked, ...shaped];
}

/** The expired copies of up to MAX_EXPIRED_PER_RUN threads; the caller stores and labels them. */
export function expirePast(states: ConversationState[], todayISO: string, max = MAX_EXPIRED_PER_RUN): ConversationState[] {
  const cutoff = new Date(Date.parse(`${todayISO.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const out: ConversationState[] = [];
  for (const s of states) {
    if (out.length >= max) break;
    if (!s.needs_human && !s.pending_order && !s.attention && !s.retry_pending) continue;
    const days = daysOf(s);
    // No day at all is not "past": an undated enquiry may still be live.
    if (!days.length || !days.every((d) => d < cutoff)) continue;
    out.push({
      ...s,
      // These three statuses alone keep cannotBeBooked() true, which would keep the label on.
      // compile() sets status afresh on the client's next email, so a revived thread is read anew.
      status: s.status === "proposed" || s.status === "error" || s.status === "needs-info" ? "ignored" : s.status,
      needs_human: false,
      pending_order: undefined,
      attention: undefined,
      retry_pending: undefined,
      retry_attempts: undefined,
      notes: [...(s.notes ?? []), "the job's dates have passed; expired from the needs-a-person list"],
    });
  }
  return out;
}
