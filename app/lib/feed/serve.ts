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
import type { Job } from "../jobsDb";
import { portedCards } from "./ported";
import { project, type FeedCard, type FeedMark, type FeedWant, type ReplyNeed } from "./project";
import { v2Sources, type V2Row } from "./v2";
import { intakeHealth } from "../intakeHealth";
import type { ConversationState } from "../engine/types";

/** An order the minute sweep cannot find (links.ts), on the TV once held long enough. */
export type HeldLink = { thread_id: string; r_number: string | null; company: string | null; subject: string | null; since: string; note: string | null };

export interface FeedDeps {
  held?: () => Promise<HeldLink[]>;
  states(): Promise<ConversationState[]>;
  /** Newest client message per thread, and the newest message of any kind (intake). */
  inbound(): Promise<{ byThread: Map<string, number>; outByThread?: Map<string, number>; latest: number | null }>;
  marks(): Promise<FeedMark[]>;
  /** Null when the follow-up feature is switched off: the reply lane does not exist. */
  replies: (() => Promise<ReplyNeed[]>) | null;
  /** Runs at most once per window across every screen; returns how many marks it wrote. */
  verify?: (cards: FeedCard[], now: number, marks: FeedMark[], wants: Map<string, FeedWant>) => Promise<{ ran: boolean; wrote: number; note: string }>;
  verifyStatus?: () => Promise<{ last_verify_at: string | null; note: string | null }>;
  /** Stores the projection's `open` and `resolved` marks; insert-once, so two screens agree. */
  remember?: (marks: Array<Omit<FeedMark, "at">>) => Promise<void>;
  /** The rebuild's decisions that need a person or made a change (v2_decisions). */
  v2?: () => Promise<V2Row[]>;
  /** Items whose email or write is older than this (ms) are not shown (FEED_FROM in production). */
  from?: number;
  /** The jobs board's tickets, carried onto the TV as completed (ported.ts). */
  jobs?: () => Promise<Job[]>;
}

export async function serveFeed(deps: FeedDeps, now: number): Promise<{ status: number; body: Record<string, unknown> }> {
  let states: ConversationState[], inbound: Awaited<ReturnType<FeedDeps["inbound"]>>, marks: FeedMark[], replies: ReplyNeed[] | null, v2rows: V2Row[];
  try {
    [states, inbound, marks, replies, v2rows] = await Promise.all([
      deps.states(), deps.inbound(), deps.marks(), deps.replies ? deps.replies() : Promise.resolve(null), deps.v2 ? deps.v2() : Promise.resolve([]),
    ]);
  } catch (err) {
    console.error("[feed] read failed", err);
    return { status: 500, body: { ok: false, error: "could not read the feed" } };
  }

  const v2 = v2Sources(v2rows, now);
  let p = project(states, inbound.byThread, marks, replies, now, inbound.outByThread, v2, deps.from);
  let reread = false;

  // Like verification, memory is extra: a failed write leaves a resolved need off the list
  // for one refresh, which is what the feed did before it had memory at all.
  if (deps.remember && p.remember.length) {
    try {
      await deps.remember(p.remember);
      reread = p.remember.some((m) => m.mark === "resolved");
    } catch (err) {
      console.error("[feed] remember failed", err);
    }
  }

  let verify: { ran: boolean; wrote: number; note: string } | null = null;
  if (deps.verify) {
    try {
      verify = await deps.verify(p.cards, now, marks, p.wants);
      if (verify.wrote > 0) reread = true;
    } catch (err) {
      console.error("[feed] verify failed", err);
      verify = { ran: true, wrote: 0, note: `verify failed: ${String((err as Error)?.message ?? err).slice(0, 160)}` };
    }
  }
  if (reread) p = project(states, inbound.byThread, await deps.marks(), replies, now, inbound.outByThread, v2, deps.from);
  const status = deps.verifyStatus ? await deps.verifyStatus().catch(() => null) : null;

  // The board's history is extra: if it cannot be read the live list is still the live list.
  const jobs = deps.jobs ? await deps.jobs().catch((err) => { console.error("[feed] jobs board read failed", err); return [] as Job[]; }) : [];
  const ported = portedCards(jobs, states, new Set(p.cards.map((c) => c.thread_id)));

  // THE TV SHOWS ONLY WHAT THE SYSTEM COULD NOT DO (Ben, 10-13: "Only those cases should be
  // moved to the display TV"). An order the bot made or changed is the system's own work and a
  // question is answered from the inbox; both are counted, not shown. A need a person has since
  // dealt with stays for its dwell, as before.
  // A need, open or just dealt with. Until 10-15 any green card counted, so an order the bot made
  // showed on the list the moment someone ticked it: a success on the failures list.
  const isFailure = (c: (typeof p.cards)[number]) => c.items.some((i) => i.kind === "needs-created" || i.kind === "needs-updated");
  const shown = p.cards.filter(isFailure);
  const done_by_system = p.cards.filter((c) => !c.green && c.items.every((i) => i.kind === "created-check" || i.kind === "updated-check")).length;
  const held = deps.held ? await deps.held().catch(() => [] as HeldLink[]) : [];
  const heldCards = held.filter((h) => !shown.some((c) => c.thread_id === h.thread_id)).map((h) => ({
    thread_id: h.thread_id, colour: "blue" as const, lane: "need" as const,
    items: [{ item_key: `held:${h.thread_id}:${h.r_number ?? ""}`, kind: "needs-updated" as const, status: "Order not found in OnSinch", at: Date.parse(h.since) || now, green: null }],
    green: false, at: Date.parse(h.since) || now, order_id: null, company_id: null, company: h.company, contact: null,
    dates: [], starts_at: null, awaiting_reply_since: null, crew: null, venue: null, r_number: h.r_number ? `R${h.r_number}` : null, j_number: null,
    subject: h.subject ?? "", quiet: false, follow_up: false, note: "Order not found in OnSinch · Find it or rebuild it",
  }));

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
      counts: { ...p.counts, done_by_system, held: heldCards.length },
      items: [...shown, ...heldCards, ...ported],
      // THE EVERYTHING TAB (Ben, 10-15): every job on the TV, the system's own orders included,
      // until its last shift is over. The Gmail labels read the same cards (mail/threadLabels.ts).
      everything: [...p.cards, ...heldCards],
    },
  };
}
