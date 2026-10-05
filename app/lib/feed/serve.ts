// ============================================================================
// GET /api/feed's whole answer, with its reads injected so the failure posture is
// testable without a database.
// ----------------------------------------------------------------------------
// A FAILED READ IS A 500 AND NEVER AN EMPTY LIST. An empty feed on the office TV reads
// as "all clear", and intake was silently down for 53 hours on 2026-10-01..03 — so the
// one thing this must never do is answer a broken query with nothing to do.
//
// Verification is the opposite: it is extra evidence, and the feed is right without it.
// A verifier that throws is reported in `health.verify` and the feed is served anyway.
// ============================================================================
import { project, type FeedCard, type FeedMark, type FeedWant, type ReplyNeed } from "./project";
import { intakeHealth } from "../intakeHealth";
import type { ConversationState } from "../engine/types";

export interface FeedDeps {
  states(): Promise<ConversationState[]>;
  /** Newest client message per thread, and the newest message of any kind (intake). */
  inbound(): Promise<{ byThread: Map<string, number>; outByThread?: Map<string, number>; latest: number | null }>;
  marks(): Promise<FeedMark[]>;
  /** Null when the follow-up feature is switched off: the reply lane does not exist. */
  replies: (() => Promise<ReplyNeed[]>) | null;
  /** Runs at most once per window across every screen; returns how many marks it wrote. */
  verify?: (cards: FeedCard[], now: number, marks: FeedMark[], wants: Map<string, FeedWant>) => Promise<{ ran: boolean; wrote: number; note: string }>;
  verifyStatus?: () => Promise<{ last_verify_at: string | null; note: string | null }>;
}

export async function serveFeed(deps: FeedDeps, now: number): Promise<{ status: number; body: Record<string, unknown> }> {
  let states: ConversationState[], inbound: Awaited<ReturnType<FeedDeps["inbound"]>>, marks: FeedMark[], replies: ReplyNeed[] | null;
  try {
    [states, inbound, marks, replies] = await Promise.all([
      deps.states(), deps.inbound(), deps.marks(), deps.replies ? deps.replies() : Promise.resolve(null),
    ]);
  } catch (err) {
    console.error("[feed] read failed", err);
    return { status: 500, body: { ok: false, error: "could not read the feed" } };
  }

  let p = project(states, inbound.byThread, marks, replies, now, inbound.outByThread);

  let verify: { ran: boolean; wrote: number; note: string } | null = null;
  if (deps.verify) {
    try {
      verify = await deps.verify(p.cards, now, marks, p.wants);
      if (verify.wrote > 0) p = project(states, inbound.byThread, await deps.marks(), replies, now, inbound.outByThread);
    } catch (err) {
      console.error("[feed] verify failed", err);
      verify = { ran: true, wrote: 0, note: `verify failed: ${String((err as Error)?.message ?? err).slice(0, 160)}` };
    }
  }
  const status = deps.verifyStatus ? await deps.verifyStatus().catch(() => null) : null;

  const intake = intakeHealth({ lastReceivedAt: inbound.latest, now });
  return {
    status: 200,
    body: {
      ok: true,
      generated_at: new Date(now).toISOString(),
      health: {
        last_email_at: intake.last_received_at,
        minutes_since_email: intake.minutes_since,
        intake_stale: intake.stale,
        within_working_hours: intake.within_working_hours,
        quiet_minutes: intake.quiet_minutes,
        replies_enabled: deps.replies !== null,
        verify: { last_at: status?.last_verify_at ?? null, note: verify?.note ?? status?.note ?? null },
      },
      counts: p.counts,
      items: p.cards,
    },
  };
}
