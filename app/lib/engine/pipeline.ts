// ============================================================================
// pipeline — the real per-event handler. This is what a Gmail push/cron calls.
// It runs the compile loop, executes the returned actions, persists state, and
// emits one metric event per pipeline transition (funnel + quality). Keeping
// metrics here (not inside pure compile()) preserves compile's re-runnability.
// ============================================================================
import { compile, type CompileDeps } from "./compiler";
import { selectLatest } from "./normalize";
import type { StateStore } from "./store";
import type { MetricSink } from "./metrics";
import type { Actions, ConversationState, DesiredOrder, DesiredSlotTeam, HydratedThread, Settings } from "./types";
import { findCrossThreadMatches, crossThreadDraft, type ThreadShape, type InternalDraft } from "./crossThread";
import { assessAmendment } from "./amendment";
import type { AmendResult } from "./amendOrder";

/**
 * The shape the cross-thread check compares. Built from the state row rather than
 * the email, so a thread already recorded is comparable without re-reading its mail.
 */
function shapeOf(s: ConversationState): ThreadShape {
  const reqs = s.facts?.requests ?? [];
  return {
    thread_id: s.thread_id,
    subject: s.subject,
    company_id: s.company_id,
    place_id: s.place_id,
    location_text: s.facts?.location_text,
    dates: reqs.map((r) => r.date).filter(Boolean) as string[],
    windows: reqs.filter((r) => r.start_time && r.end_time).map((r) => `${r.start_time}-${r.end_time}`),
    sizes: reqs.map((r) => r.size).filter((n): n is number => typeof n === "number"),
    onsinch_order_id: s.onsinch_order_id,
  };
}

/** The side-effecting edges. Injected so the pipeline stays testable. */
export interface Executor {
  createReplyDraft(a: NonNullable<Actions["createReplyDraft"]>): Promise<string>; // -> draft id
  createOrder(order: NonNullable<Actions["createOrder"]>): Promise<{
    id: number;
    number?: string;
    /** The job the crew blocks hang off, so an amendment can append to it. */
    job_id?: number;
    /**
     * One slot-team id per block, in the order written. Optional because a test executor
     * or an older stored order may not have them, and the amendment falls back to the
     * audit read when they are missing.
     */
    team_ids?: number[];
  }>;
  /**
   * Apply what can safely be applied to an EXISTING order, and report which
   * fields actually went. Returning the applied list is what stops the engine
   * claiming success for a write that carried nothing — OnSinch's PATCH /orders
   * is top-level only, so the substance of most updates (crew size, times) can
   * never be applied this way, and there is no GET /slotTeams to even diff it.
   */
  patchOrder(p: NonNullable<Actions["patchOrder"]>): Promise<string[] | void>;
  /**
   * An internal email to ops — today only the cross-thread "is this one job or two"
   * question (Ben, Q6). Optional: a deployment without it still HOLDS the order,
   * which is the part that protects the booking.
   */
  createInternalDraft?(d: InternalDraft): Promise<string | void>;
  /**
   * Apply a crew or time change to a DRAFT order WITHOUT destroying it: PATCH the crew
   * blocks that moved, POST the ones that are new (see amendOrder.ts).
   *
   * Tried before `replaceOrder` and, unlike it, NOT optional in practice — it destroys
   * nothing, so it stays available even with the delete kill switch thrown, and a crew
   * change still reaches OnSinch instead of reaching a note.
   *
   * `previous` is the team array last written to the order, in the order it was written.
   * It is the correspondence for the ids read back from OnSinch and there is no
   * substitute: nothing in the API returns a live team's size, window or place.
   *
   * `onCreated` must have persisted before it returns. `POST /slotTeams` is the one
   * non-idempotent call on this path.
   */
  amendOrderInPlace?(p: {
    order_id: number;
    previous: DesiredSlotTeam[];
    desired: DesiredOrder;
    alreadyCreated?: number[];
    /**
     * What the create recorded: the job id and one slot-team id per block. Where these
     * are present the amendment addresses the blocks directly and skips the audit read,
     * which returns nothing for an order created through the API (API reference §12).
     */
    known?: { job_id?: number; team_ids?: number[] };
    onCreated(team_id: number): Promise<void>;
  }): Promise<AmendResult>;
  /**
   * Apply a crew or time change to a DRAFT order by deleting it and posting the
   * corrected one — the fallback for the changes PATCH cannot express, chiefly a crew
   * block that has been dropped (see replaceOrder.ts).
   *
   * Optional so an executor that has no business destroying orders (a test double, a
   * read-only deployment) simply omits it, and the pipeline falls back to patching what
   * it can and telling a human the rest.
   *
   * The hooks are the crash-safety contract, not a convenience: `onIntent` must have
   * persisted the snapshot before the delete happens, and `onDeleted` before the
   * replacement is attempted.
   */
  replaceOrder?(p: {
    order_id: number;
    desired: DesiredOrder;
    /**
     * Whether this engine raised the order, established from the thread's own action
     * log. REQUIRED: it is the only thing separating our draft from a client order ops
     * raised by hand, now that no flag combination does. See replaceOrder.ts.
     */
    weCreatedIt: boolean;
    alreadyDeleted?: boolean;
    onIntent(snapshot: unknown): Promise<void>;
    onDeleted(): Promise<void>;
  }): Promise<{ created?: { id: number; number?: string }; refused?: string; deleted: boolean }>;
  /**
   * The identifiers a human types into OnSinch, read back after a create.
   *
   * POST /orders returns `{ id }` and nothing else — not the nested job's id, and not
   * the order's own `number` (probed live: the response is `{"id":13744}` while a GET
   * on it returns `number: "10638"`). Both of the numbers anybody can search on
   * therefore cost one read, and it is the same read, so they are fetched together.
   *
   * Optional, and a failure to read them is never a failure of the write: the order
   * exists either way, and an identifier missing from the board is a worse outcome
   * only than an order that was created twice.
   */
  identifiersForOrder?(order_id: number): Promise<{ job_id?: number; order_number?: string }>;
}

export interface PipelineDeps extends CompileDeps {
  store: StateStore;
  metrics: MetricSink;
  executor: Executor;
  settings: Settings;
  hashOrder: (o: unknown) => string;
  /**
   * THE IDENTITY GATE - the first thing done to every message, before any
   * inference. Answers both questions from keys: has this exact message been
   * processed, and has this conversation been seen.
   *
   * Optional so every existing test double keeps working, and it FAILS OPEN: a
   * claim that could not be made (`ok: false`) processes the thread normally,
   * because a database outage must never drop an enquiry.
   */
  claimMessage?: (input: {
    message_id: string;
    thread_id?: string;
    subject?: string;
    from_address?: string;
  }) => Promise<{
    ok: boolean;
    first_seen: boolean;
    seen_count: number;
    thread_first_seen: boolean;
    thread_message_count: number;
    degraded?: string;
  }>;
  /** Feeds the sender ledger that triage reads. Injected; absent in tests. */
  recordSender?: (a: { addr: string; thread_id: string; wasJob: boolean; subject?: string }) => Promise<void>;
  /**
   * A JOB THIS ENGINE COULD NOT BOOK, HANDED TO A PERSON.
   *
   * Ben, 2026-08-26: "any that cannot be booked should pipe into n8n via webhook and
   * mark the thread with a tag 'Manual'."
   *
   * The engine cannot label a Gmail thread itself — the mailbox credential lives inside
   * n8n and cannot be read out of it — so this posts and n8n labels. Same shape and same
   * shared secret as the reply-draft webhook, because a second delivery mechanism is a
   * second thing to keep working.
   *
   * `state` distinguishes the two edges rather than only the bad one. A thread that
   * needed a human and later gets booked must stop wearing the tag, or the tag decays
   * into "threads that ever went wrong" — which nobody can work from. Ops act on the
   * label, so the label has to mean "needs you NOW".
   *
   * Optional, and a failure is logged and swallowed. The board already shows the thread;
   * an undelivered tag means ops find it there instead of in their inbox, which is
   * slower, not dangerous. Silently failing to BOOK would be dangerous — this is not
   * that.
   */
  flagForManual?: (a: {
    thread_id: string;
    state: "manual" | "cleared";
    /** Why a person is needed, in the words already on the ticket. */
    reason: string;
    status: string;
    subject?: string;
    /** The order the thread points at, when it has one that simply disagrees. */
    order_id?: number;
    /** What the client asked for, so ops can act without opening the board. */
    crew?: number;
    dates?: string[];
  }) => Promise<void>;
  /**
   * The permanent record of an order about to be deleted, and what replaced it.
   * Injected so the pipeline stays testable with no database. Absent, a rebuild still
   * happens — the archive is how the old numbers stay answerable, not a safety.
   */
  archiveOrder?: (a: {
    thread_id: string;
    order_id: number;
    order_number?: string;
    job_id?: number;
    live_order?: Record<string, unknown> | null;
    slot_teams: DesiredSlotTeam[];
    slot_teams_are_reconstruction: boolean;
    reason?: string;
    created?: string | null;
  }) => Promise<number | null>;
  recordReplacement?: (
    archive_id: number,
    by: { order_id: number; order_number?: string; job_id?: number }
  ) => Promise<void>;
}

export async function handleThread(
  thread: HydratedThread,
  deps: PipelineDeps
): Promise<ConversationState> {
  const { store, metrics, executor, settings, now, hashOrder } = deps;
  const tid = thread.thread_id;
  const emit = (type: any, meta?: Record<string, unknown>) =>
    metrics.emit({ ts: now(), thread_id: tid, type, meta });

  const prior = await store.get(tid);

  /**
   * IDENTITY BEFORE INFERENCE. The exact same message can never be processed
   * twice, and that is settled by the message id rather than by anything the
   * model reads. The fast-path below is a cache check against what we last
   * stored; this is the durable claim, and it sees a message however it arrived.
   *
   * Fails open on purpose. `ok: false` means the ledger could not answer - not
   * that the message is new - and dropping an enquiry because a database was
   * unreachable is the worse failure. handleThread is idempotent, so the cost of
   * processing twice is a wasted model call.
   */
  const newest = selectLatest(thread.messages)?.latest;
  if (deps.claimMessage && newest?.message_id) {
    const claim = await deps.claimMessage({
      message_id: newest.message_id,
      thread_id: tid,
      subject: newest.subject,
      from_address: newest.from,
    }).catch((err) => {
      console.error("[identity-gate] claim failed, processing anyway", err);
      return null;
    });
    if (claim?.ok && !claim.first_seen) {
      await emit("duplicate_message", { message_id: newest.message_id, seen_count: claim.seen_count });
      // handleThread's declared return type is Promise<ConversationState>, not
      // ConversationState | undefined — widening it is out of scope here, so a
      // duplicate on a thread with no prior stored state (only reachable if the
      // ledger and the state store disagree) returns `prior` cast rather than
      // changing the signature.
      return prior as ConversationState;
    }
  }

  // Idempotency fast-path (the "never miss an email" enabler): a re-POST of a
  // thread we've already processed at its CURRENT latest message is a no-op —
  // no LLM calls, no writes. This lets the interval + nightly Gmail sweeps run
  // aggressively (re-POSTing everything for full coverage) at ~zero cost; only
  // genuinely new/changed threads run the model. A new email changes the latest
  // message id, so it always processes.
  // Key on the newest CLIENT message: our own Spartan replies land in the thread
  // but must not count as new activity, or every drafted reply would retrigger
  // processing. selectLatest is the SAME choice the compiler acts on — if the
  // two ever diverged, the key would never match what was stored and the thread
  // would re-run the model on every sweep.
  const latestId = selectLatest(thread.messages)?.latest.message_id ?? "";
  if (prior && prior.last_message_id === latestId) {
    return prior;
  }

  await emit("email_received", { new_messages: thread.messages.length });

  const { state, actions } = await compile(thread, prior, deps);
  await emit("thread_processed", { classification: state.classification });

  if (state.classification === "not-a-job") await emit("filtered_out");
  else await emit("job_detected", { classification: state.classification, priority: state.priority });

  const next = { ...state };

  if (actions.createReplyDraft) {
    next.reply_draft_id = await executor.createReplyDraft(actions.createReplyDraft);
    await emit("reply_drafted", { priority: state.priority });
  }

  if (state.needs_human) await emit("needs_human", { notes: state.notes });

  // Normalize the intended order write (create or patch), if any.
  const intended = actions.createOrder
    ? { kind: "create" as const, desired: actions.createOrder }
    : actions.patchOrder
    ? { kind: "patch" as const, desired: actions.patchOrder.desired, order_id: actions.patchOrder.order_id }
    : null;

  if (intended) {
    /**
     * An ASSUMED rate is never written hands-free.
     *
     * default_rate_card lets a brand-new client get an order at all, instead of
     * holding on a number they have no history for. Three in four are priced
     * right by it. The fourth is why this exists: auto mode would put a guessed
     * price on a real booking and bill it, which is the exact failure — OnSinch's
     * silent card 245 — that I1 was written to stop. Staging costs one click.
     *
     * Deliberately checked on the order being written rather than on settings, so
     * it holds for a patch as well as a create, and cannot be switched off from
     * the dashboard.
     */
    /**
     * Ben, Q1 (2026-08-18): an order goes to OnSinch as To Confirm the moment it
     * composes. The Neon staging queue stops being a gate.
     *
     * It was one. In 90 days the engine created 2 orders and updated 23, while 101
     * sat in a Postgres table nobody opened — every OnSinch id on those tickets was
     * an order ops raised by hand. To Confirm is already a human gate, and it lives
     * where the humans work; a second gate in a dashboard is not safety, it is a
     * drawer. `order_mode` retires with it.
     *
     * The queue itself stays, as the record: every inbound request is still visible
     * in the tool with the order it produced. What it no longer does is hold.
     *
     * The ONE case that still holds is money, and it is not a mode — it is checked
     * on the order being written, so it holds for a patch as well as a create and
     * cannot be switched off from the dashboard. An assumed rate card is a guess
     * that reaches an invoice; card 245, the silent OnSinch default, is Tracy's
     * original wrong-rate failure.
     *
     * The obvious objection to keeping it is Ben's own Q1 argument: a gate nobody
     * opens is a drawer, not safety. What answers that is the volume. A card is only
     * assumed for a company with NO order history, and over the tenant's 6,686 orders
     * there are 557 such companies — 8.3% of all orders ever, and 5.6% of the last
     * thousand. It is one click per NEW CLIENT, not one per order: the moment that
     * first order exists, every later one derives its card from history and writes
     * straight through. A first booking for a company nobody has priced before is the
     * one moment in the life of an account where a human should see the number.
     */
    /**
     * Before anything is written: is this the same job as a thread we already hold?
     *
     * Ben's standing constraint — a cross-thread same-job suspicion produces a DRAFT
     * EMAIL ONLY, never a draft order. So a hit holds the order rather than writing
     * it, which is the whole point: the failure this prevents is a second order for
     * a job that already exists, and crew booked twice for it.
     *
     * The floor is client + date + venue (Q4). It fires rarely by construction, and
     * when it fires nothing has been written that would need undoing.
     */
    // store.all() is the 500 most recently updated threads, not every thread ever.
    // That is the right window — a twin arrives days apart, not months — but it IS a
    // window: a job re-enquired about after 500 other threads have moved will not be
    // seen, and the check will say nothing rather than saying no.
    const twin = findCrossThreadMatches(shapeOf(next), (await store.all()).map(shapeOf));
    if (twin.length) {
      const draft = crossThreadDraft(shapeOf(next), twin)!;
      next.notes = [
        ...next.notes,
        `held: looks like the same job as thread ${twin[0].thread_id} (${twin[0].relation}) — ops asked, no order written`,
      ];
      next.pending_order = intended;
      next.status = "proposed";
      try {
        await executor.createInternalDraft?.(draft);
      } catch (err) {
        // The email is how a human hears about this, but failing to draft it must not
        // turn a held thread into an errored one — the hold is the safety, not the mail.
        console.error("[cross-thread] internal draft not created", err);
      }
      await emit("cross_thread_suspected", { other: twin[0].thread_id, relation: twin[0].relation });
      await store.put(next);
      return next;
    }

    /**
     * May an amendment shrink the order? Yes — see amendment.ts. Emptying it is the
     * one shape that holds, because a cancellation arrives labelled "update" and
     * would otherwise strip a real booking to nothing.
     */
    /**
     * A cancellation is never acted on, only reported.
     *
     * Cancelling or shrinking a booking in OnSinch is destructive and there is no
     * undo — and the flag comes from the same model that has to tell a real
     * cancellation apart from "postponed", "on hold", and "we may need to pull
     * Thursday". Being wrong here empties a job that is still happening, which is
     * the one failure worse than doing nothing: the client turns up to no crew.
     *
     * So it holds, keeps the composed order so a human can see what the thread now
     * asks for, and says so. This is the case the empty-order guard below was
     * catching blind — with the flag it is caught by name, and caught even when the
     * cancellation is partial and the order is not empty at all.
     */
    if (next.cancellation) {
      next.notes = [
        ...next.notes,
        `the client is cancelling. The engine does not cancel or shrink a booking — nothing was written, a human must do it in OnSinch.`,
      ];
      next.pending_order = intended;
      next.status = "proposed";
      await emit("cancellation_suspected", { order_id: next.onsinch_order_id });
      await store.put(next);
      return next;
    }

    const amend = assessAmendment(prior?.desired_order, intended.desired);
    if (amend.note) next.notes = [...next.notes, amend.note];
    if (amend.action === "hold") {
      next.pending_order = intended;
      next.status = "proposed";
      await emit("order_proposed", { kind: intended.kind, size: amend.after });
      await store.put(next);
      return next;
    }

    /**
     * AN ASSUMED RATE CARD FLAGS THE ORDER; IT NO LONGER HOLDS IT.
     *
     * Ben, 2026-08-27: "there are meant to be as little unnecessary blockers to creating
     * a job as possible, as long as the actual content of the order can be created
     * properly."
     *
     * A rate card is not order content. Everything that decides what crew turn up, when,
     * and where is fully determined — the card decides what the job is INVOICED at, and
     * it is Spartan's own number to set, not something the client supplies. Holding the
     * whole booking for it stopped the wrong thing.
     *
     * It held for a real reason, so here is why that reason no longer applies. The
     * original argument was that an assumed price reaches an invoice, and a human should
     * see the number once per new client. The objection to it was Ben's own Q1 point: a
     * gate nobody opens is a drawer, not safety. What was missing was any way for the
     * flag to reach a person — so holding the order WAS the notification.
     *
     * That changed today. `needs_human` now puts the "Manual" label on the thread in the
     * bookings mailbox (deps.flagForManual), which is where ops actually work. The price
     * still gets a human's eyes; the booking no longer waits for them.
     *
     * Measured cost of the old behaviour, live on 2026-08-27: of four test enquiries with
     * everything else correct — professions resolved by cue, chief bands right, venues
     * matched on postcode — two were held solely because the client was new. Nothing was
     * wrong with either order.
     *
     * `rate_card_source` stays on the order, and `needs_human` is set in compile() for
     * exactly this case, so nothing downstream loses the fact that the number was a
     * default rather than a derivation.
     *
     * WHAT STILL HOLDS, because these are order CONTENT and not a review note:
     *   - nothing bookable composed (no crew size, no date) — there is no order to write
     *   - every shift already in the past — crew cannot work a day that has gone
     *   - a cross-thread twin — the risk is a SECOND order for one job, and crew booked
     *     twice for it
     *   - a cancellation — the engine never cancels or shrinks a booking
     */
    await executeOrder(next, intended, deps, emit);
  }

  // Teach the sender ledger what this thread turned out to be. It is what lets triage
  // decide by identity next time — 88.2% of thread-appearances come from a sender seen
  // before — and it is recorded per THREAD, so a chatty enquiry counts once.
  //
  // After the classification and never before it: the ledger's whole value is knowing
  // who produces bookings, and that is not known until the thread has been read.
  if (deps.recordSender) {
    const author = selectLatest(thread.messages)?.latest;
    if (author && !author.is_from_spartan) {
      const wasJob = next.classification === "new-job" || next.classification === "update";
      try {
        await deps.recordSender({ addr: author.from, thread_id: tid, wasJob, subject: next.subject });
      } catch (err) {
        // An optimisation that cannot be written must not fail the email it described.
        console.error("[sender-ledger] record skipped", err);
      }
    }
  }

  await store.put(next);
  await flagManualIfNeeded(next, deps);
  return next;
}

/**
 * WHAT "CANNOT BE BOOKED" MEANS, stated once so it cannot drift.
 *
 * A job the client asked for that is not, right now, correctly in OnSinch. Three shapes
 * reach it and all three need the same person:
 *
 *   error       something threw, or a write was refused outright
 *   needs-info  the engine held rather than guessed — no date, no rate card, a trade
 *               nobody recognised, an ambiguity it will not resolve alone
 *   needs_human an order EXISTS but disagrees with the client's latest email, because
 *               the change could not be applied — the most easily missed of the three,
 *               since the board shows an order and everything looks done
 *
 * NOT INCLUDED, deliberately: `ignored`. That is a newsletter, an out-of-office, a
 * machine sender — nothing anyone asked to be booked. Tagging those would put "Manual"
 * on most of the mailbox within a week and the tag would stop being read, which costs
 * more than it saves.
 *
 * Also not included: a thread with no job in it. `confirmation-only` and `not-a-job` are
 * answers, not failures.
 */
export function cannotBeBooked(s: ConversationState): boolean {
  const isJob = s.classification === "new-job" || s.classification === "update";
  if (!isJob) return false;
  if (s.status === "error" || s.status === "needs-info") return true;
  /**
   * `review_only` is the third shape, and it is NOT one of the three above: an order
   * that wrote cleanly and carries a stand-in somebody should look at — a client or a
   * venue created from a name alone, a placeholder contact, an assumed rate card.
   *
   * Those used to HOLD, and while they held, needs_human and "cannot be booked" were the
   * same sentence. Ben's rule that creating a client is never gated on information, and
   * the change that made an assumed rate card book rather than wait, made them different
   * sentences — and this predicate went on reading the old one. So every new-client
   * booking landed in the mailbox labelled unbookable, with a reason that read
   * "crew-chief rule: team of 6 -> 5 + 1 chief".
   *
   * The status check stays ABOVE this deliberately: a thread that held or threw has
   * nothing booked to review, whatever the compiler flagged on the way there.
   */
  return s.needs_human === true && s.review_only !== true;
}

/**
 * Post the tag, or take it back, exactly once per transition.
 *
 * Runs AFTER the state is persisted, so a webhook that hangs or throws can never cost
 * the record of what the engine decided. The flag is written back on success only — a
 * failed post leaves `manual_flagged` untouched, so the next email retries it.
 */
export async function flagManualIfNeeded(next: ConversationState, deps: PipelineDeps): Promise<void> {
  if (!deps.flagForManual) return;
  const should = cannotBeBooked(next);
  const already = next.manual_flagged === true;
  if (should === already) return; // no transition, nothing to say

  // The reason ops read is the last thing the engine wrote about the thread, not a
  // summary invented here — the notes already say why, in the engine's own words.
  const reason = should
    ? [...(next.notes ?? [])].reverse().find((n) => n && n.length > 12) ?? `status ${next.status}`
    : `booked as order #${next.onsinch_order_id ?? "?"}`;

  try {
    await deps.flagForManual({
      thread_id: next.thread_id,
      state: should ? "manual" : "cleared",
      reason,
      status: next.status,
      subject: next.subject,
      ...(next.onsinch_order_id ? { order_id: next.onsinch_order_id } : {}),
      ...(next.desired_order
        ? {
            crew: (next.desired_order.slot_teams ?? []).reduce((n, t) => n + (t.size || 0), 0),
            dates: [...new Set((next.desired_order.slot_teams ?? [])
              .map((t) => String(t.beginning ?? "").slice(0, 10))
              .filter(Boolean))],
          }
        : {}),
    });
    next.manual_flagged = should;
    await deps.store.put(next);
  } catch (err) {
    // The thread is already on the board with its reason. An untagged inbox is slower
    // for ops; a lost booking would be dangerous, and this is not that.
    console.error("[manual-tag] flag failed", err);
  }
}

/**
 * The J number and the R number for an order we just wrote, or nothing.
 *
 * Swallows its own failure on purpose. This runs immediately after a successful
 * POST /orders, so a throw here would land in the caller's catch and report an
 * order that exists as an order that errored — and the next run would try to
 * create it again.
 */
async function readIdentifiers(
  order_id: number,
  deps: PipelineDeps
): Promise<{ job_id?: number; order_number?: string }> {
  try {
    return (await deps.executor.identifiersForOrder?.(order_id)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Amend a draft order in place — the first thing tried when a crew or time change needs
 * to reach OnSinch, and the one that destroys nothing.
 *
 * Returns false when it does not apply, and the caller falls through to delete-and-repost
 * exactly as before. It declines, rather than refuses, whenever the change cannot be
 * expressed as PATCHes and appends — chiefly a dropped crew block, which OnSinch has no
 * way to remove — because for those the old path is still the right answer.
 *
 * A REFUSAL IS DIFFERENT AND IS FINAL. "The order has been confirmed" and "shrinking a
 * staffed block may unbook people" are reasons no path may write, so they stop here and
 * go to a human rather than falling through to a rebuild that would do worse.
 */
async function tryAmendInPlace(
  next: ConversationState,
  intended: NonNullable<ConversationState["pending_order"]>,
  deps: PipelineDeps,
  emit: (type: any, meta?: Record<string, unknown>) => Promise<void>
): Promise<boolean> {
  const { executor, store, now, hashOrder } = deps;
  const order_id = intended.order_id;
  if (!executor.amendOrderInPlace || !order_id) return false;

  // Resume first: a part-finished amendment outranks any judgement about whether one is
  // needed, because crew blocks may already have been appended to the order.
  const resuming = next.order_amend?.order_id === order_id;

  // Otherwise only when the crew or the times actually moved. A follow-up carrying a PO
  // number must not rewrite the crew blocks of a real order.
  const teamsHash = hashOrder(intended.desired.slot_teams ?? []);
  const teamsChanged = !!next.last_ordered_teams_hash && teamsHash !== next.last_ordered_teams_hash;
  if (!resuming && !teamsChanged) return false;

  /**
   * The set this engine last wrote, which is what the ids read back from OnSinch
   * correspond to. Absent on an order the engine did not raise — most often one matched
   * out of OnSinch history by company and date — and absent is not empty: with nothing
   * to pair against, the amendment declines and the rebuild path takes it, which is
   * where an order of unknown provenance belongs.
   */
  const previous = next.last_ordered_teams;
  if (!resuming && !previous?.length) return false;

  try {
    const res = await executor.amendOrderInPlace({
      order_id,
      previous: previous ?? [],
      desired: intended.desired,
      alreadyCreated: resuming ? next.order_amend?.created_ids : undefined,
      known: { job_id: next.onsinch_job_id, team_ids: next.last_ordered_team_ids },
      async onCreated(team_id) {
        next.order_amend = {
          order_id,
          created_ids: [...(next.order_amend?.created_ids ?? []), team_id],
          ts: now(),
        };
        await store.put(next);
      },
    });

    if (res.declined) {
      // Not our case. Say nothing to anyone and let the rebuild path decide.
      return false;
    }

    if (res.refused) {
      // Final. Nothing was written that matters, and no other path may try.
      next.status = "needs-info";
      next.notes = [...next.notes, `crew/time change NOT applied — ${res.refused}`];
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "amend-refused", order_id, ok: false, error: res.refused }];
      next.order_amend = undefined;
      await emit("order_updated", { order_id, applied: 0, refused: res.refused });
      return true;
    }

    if (res.amended) {
      /**
       * The order-level fields go through the SAME branch, so one email produces one
       * complete update. Before this existed a crew change and a PO number in the same
       * message reached OnSinch as a team rewrite plus a note asking a human to type the
       * PO in. A failure here is not a failure of the amendment — the crew blocks are
       * already correct — so it is recorded and not thrown.
       */
      let applied: string[] = [];
      try {
        applied = (await executor.patchOrder({ order_id, desired: intended.desired })) || [];
      } catch (err: any) {
        next.notes = [...next.notes, `order fields not updated on #${order_id} (${String(err?.message ?? err)})`];
      }

      const crew = (intended.desired.slot_teams ?? []).reduce((n, t) => n + (t.size || 0), 0);
      next.last_ordered_hash = hashOrder(intended.desired);
      next.last_ordered_teams_hash = teamsHash;
      next.last_ordered_teams = intended.desired.slot_teams ?? [];
      /**
       * An APPENDED block's id joins the record. Miss this and the next amendment sees
       * fewer stored ids than recorded blocks, declines on the mismatch, and the rebuild
       * destroys an order that was perfectly amendable.
       */
      next.last_ordered_team_ids = [
        ...(next.last_ordered_team_ids ?? []),
        ...(res.amended.added ?? []),
      ];
      next.onsinch_job_id = res.amended.job_id ?? next.onsinch_job_id;
      next.status = "ordered";
      next.pending_order = undefined;
      next.order_amend = undefined;
      next.notes = [
        ...next.notes,
        `crew/time change applied to order #${order_id} in place — ` +
          `${res.amended.patched} block(s) corrected` +
          (res.amended.added.length ? `, ${res.amended.added.length} added` : "") +
          (applied.length ? `, ${applied.join(", ")} updated` : "") +
          `; ${crew} crew across ${(intended.desired.slot_teams ?? []).length} block(s)`,
      ];
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "amend", order_id, ok: true }];
      await emit("order_updated", {
        order_id,
        applied: res.amended.patched + res.amended.added.length,
        in_place: true,
      });
      return true;
    }

    /**
     * Neither amended, declined nor refused. amendOrderInPlace always sets one, so this
     * is unreachable — but falling through to the rebuild after an unknown answer would
     * delete an order that may already have been corrected. An answer this path does not
     * understand is a failure, and it stops here.
     */
    next.status = "error";
    next.needs_human = true;
    // A real failure, so the compiler's review note does not stand: the order is
    // not merely worth a look, it is not right. See review_only in types.ts.
    next.review_only = false;
    next.notes = [...next.notes, `in-place amendment of order #${order_id} returned no result — nothing is known to have been applied`];
    next.order_action_log = [...next.order_action_log, { ts: now(), kind: "amend", order_id, ok: false, error: "no result" }];
    await store.put(next);
    await emit("order_error", { error: "amend returned no result", order_id });
    return true;
  } catch (err: any) {
    /**
     * A throw can leave the order half-corrected: the PATCHes are sent before the
     * appends, so some blocks may be right and a new one missing. Nothing is lost and
     * nothing is duplicated — order_amend holds every id already appended, so a retry
     * finishes the job — but it is not a completed update and is never recorded as one.
     */
    next.status = "error";
    next.needs_human = true;
    // A real failure, so the compiler's review note does not stand: the order is
    // not merely worth a look, it is not right. See review_only in types.ts.
    next.review_only = false;
    next.notes = [
      ...next.notes,
      `in-place amendment of order #${order_id} failed (${String(err?.message ?? err)}). Nothing was deleted; ` +
        `the order may hold some corrected blocks and be missing a new one. A retry completes it.`,
    ];
    next.order_action_log = [...next.order_action_log, { ts: now(), kind: "amend", order_id, ok: false, error: String(err?.message ?? err) }];
    await store.put(next);
    await emit("order_error", { error: String(err?.message ?? err), order_id });
    return true;
  }
}

/**
 * Delete-and-repost, when a crew or time change needs to reach a draft order.
 *
 * Returns false when it does not apply, and the caller then patches as before. That
 * fallback matters: every reason to decline here (no executor support, the order is
 * no longer a draft, only the PO changed) is a reason the OLD behaviour is correct.
 *
 * The two `store.put` calls are the whole point. The pipeline normally persists once,
 * at the end, which is fine when the worst interruption loses a write. Here an
 * interruption can leave a real order deleted, so the intent and the deletion are each
 * committed as they happen — a resumed run reads them and finishes the job instead of
 * repeating the destructive half.
 */
async function tryReplace(
  next: ConversationState,
  intended: NonNullable<ConversationState["pending_order"]>,
  deps: PipelineDeps,
  emit: (type: any, meta?: Record<string, unknown>) => Promise<void>
): Promise<boolean> {
  const { executor, store, now, hashOrder } = deps;
  const order_id = intended.order_id;
  if (!executor.replaceOrder || !order_id) return false;

  // Resume first: a part-finished replace outranks any judgement about whether one is
  // needed, because the order may already be gone.
  const resuming = next.order_replace?.order_id === order_id;

  // Otherwise only when the crew or the times actually moved. A follow-up carrying a PO
  // number must never delete a real order to apply it.
  const teamsHash = hashOrder(intended.desired.slot_teams ?? []);
  const teamsChanged = !!next.last_ordered_teams_hash && teamsHash !== next.last_ordered_teams_hash;
  if (!resuming && !teamsChanged) return false;

  /**
   * Did WE raise this order? The action log is the custody record: a successful create
   * or replace against this id, written by this pipeline at the moment it happened.
   * Anything else — most often an order matched out of OnSinch history by company and
   * date, which is how a thread inherits an order ops raised — is somebody else's, and
   * replaceOrder refuses to delete it. See the custody note in replaceOrder.ts.
   */
  const weCreatedIt = next.order_action_log.some(
    (a) => a.ok && (a.kind === "create" || a.kind === "replace") && Number(a.order_id) === Number(order_id)
  );

  let archiveId: number | null = null;
  const beforeCrew = (next.desired_order?.slot_teams ?? []).reduce((n, t) => n + t.size, 0);
  const afterCrew = (intended.desired.slot_teams ?? []).reduce((n, t) => n + t.size, 0);

  try {
    const res = await executor.replaceOrder({
      order_id,
      desired: intended.desired,
      weCreatedIt,
      alreadyDeleted: resuming ? next.order_replace?.deleted === true : false,
      async onIntent(snapshot) {
        next.order_replace = { order_id, deleted: false, snapshot, ts: now() };
        await store.put(next);
        /**
         * The permanent record of the order about to be destroyed, written BEFORE the
         * delete so a crash between the two leaves a row describing an order that still
         * exists — recoverable — rather than a deleted order nothing remembers.
         *
         * order_replace above is the crash-safety marker and is cleared on success.
         * This is the archive and is never cleared: a client quotes "J13918" months
         * later and it exists nowhere in OnSinch, because the booking they mean is
         * J14022 now. Ben, 2026-08-18.
         */
        archiveId = await deps.archiveOrder?.({
          thread_id: next.thread_id,
          order_id,
          order_number: next.onsinch_order_number,
          job_id: next.onsinch_job_id,
          live_order: snapshot as Record<string, unknown>,
          // The engine's own copy. There is no endpoint that returns an order's slot
          // teams, so on an order raised by hand in OnSinch this may not be what was
          // really on it — which is why the flag says so rather than leaving someone
          // to trust it. See orderArchiveDb.ts.
          slot_teams: next.desired_order?.slot_teams ?? [],
          slot_teams_are_reconstruction: !weCreatedIt,
          reason: `crew ${beforeCrew} -> ${afterCrew}`,
          created: (snapshot as { created?: string })?.created ?? null,
        }) ?? null;
      },
      async onDeleted() {
        next.order_replace = { ...(next.order_replace ?? { order_id, ts: now() }), order_id, deleted: true };
        await store.put(next);
      },
    });

    if (res.refused) {
      // Nothing was touched. Say why, keep the crew change visible to a human, and do
      // NOT claim the update landed.
      next.status = "needs-info";
      next.notes = [...next.notes, `crew/time change NOT applied — ${res.refused}`];
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "replace-refused", order_id, ok: false, error: res.refused }];
      next.order_replace = undefined;
      await emit("order_updated", { order_id, applied: 0, refused: res.refused });
      return true;
    }

    if (res.created) {
      const old = order_id;
      const ids = await readIdentifiers(res.created.id, deps);
      next.onsinch_order_id = res.created.id;
      next.onsinch_order_number = res.created.number ?? ids.order_number;
      next.onsinch_job_id = ids.job_id;
      next.last_ordered_hash = hashOrder(intended.desired);
      next.last_ordered_teams_hash = teamsHash;
      next.last_ordered_teams = intended.desired.slot_teams ?? [];
      next.status = "ordered";
      next.pending_order = undefined;
      next.order_replace = undefined;
      next.notes = [
        ...next.notes,
        `crew/time change applied by replacing draft order #${old} with #${res.created.id} — PATCH cannot carry slot teams`,
      ];
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "replace", order_id: res.created.id, ok: true }];
      // Close the chain, so the old number resolves to the job it became.
      if (archiveId) {
        await deps.recordReplacement?.(archiveId, {
          order_id: res.created.id, order_number: res.created.number, job_id: next.onsinch_job_id,
        }).catch?.((err: unknown) => console.error("[order-archive] replacement not recorded", err));
      }
      await emit("order_updated", {
        order_id: res.created.id,
        replaced: old,
        applied: (intended.desired.slot_teams ?? []).length,
      });
      return true;
    }

    // Neither created nor refused. replaceProvisionalOrder always sets one of them, so
    // this is unreachable — but the cost of being wrong about that is falling through to
    // the patch branch and PATCHing an order that may already be deleted, then recording
    // it as done. An answer this path does not understand is treated as a failure, and if
    // a delete did happen the marker is left in place for the retry.
    const deletedBlind = next.order_replace?.deleted === true;
    next.status = "error";
    next.needs_human = true;
    // A real failure, so the compiler's review note does not stand: the order is
    // not merely worth a look, it is not right. See review_only in types.ts.
    next.review_only = false;
    next.notes = [
      ...next.notes,
      `replace of order #${order_id} returned neither a replacement nor a reason` +
        (deletedBlind ? " AFTER the old order was deleted — see order_replace for the snapshot" : " — nothing was deleted"),
    ];
    next.order_action_log = [...next.order_action_log, { ts: now(), kind: "replace", order_id, ok: false, error: "no result" }];
    if (!deletedBlind) next.order_replace = undefined;
    await store.put(next);
    await emit("order_error", { error: "replace returned no result", order_id, deleted: deletedBlind });
    return true;
  } catch (err: any) {
    // The dangerous branch: if the delete went through and the create did not, a real
    // order is gone. order_replace is deliberately LEFT in place — it holds the snapshot
    // and the deleted flag, so the retry re-posts instead of deleting again — and the
    // thread is marked for a human rather than left looking merely errored.
    const deleted = next.order_replace?.deleted === true;
    next.status = "error";
    next.needs_human = true;
    // A real failure, so the compiler's review note does not stand: the order is
    // not merely worth a look, it is not right. See review_only in types.ts.
    next.review_only = false;
    next.notes = [
      ...next.notes,
      deleted
        ? `URGENT: draft order #${order_id} was DELETED and its replacement failed to post (${String(err?.message ?? err)}). ` +
          `The order it held is snapshotted in order_replace and will be re-posted on the next run.`
        : `replace of order #${order_id} failed before anything was deleted (${String(err?.message ?? err)}) — the order is untouched`,
    ];
    next.order_action_log = [...next.order_action_log, { ts: now(), kind: "replace", order_id, ok: false, error: String(err?.message ?? err) }];
    await store.put(next);
    await emit("order_error", { error: String(err?.message ?? err), order_id, deleted });
    return true;
  }
}

/** Execute a staged/intended order write and fold the result into state. */
async function executeOrder(
  next: ConversationState,
  intended: NonNullable<ConversationState["pending_order"]>,
  deps: PipelineDeps,
  emit: (type: any, meta?: Record<string, unknown>) => Promise<void>
): Promise<void> {
  const { executor, now, hashOrder } = deps;
  try {
    if (intended.kind === "create") {
      const created = await executor.createOrder(intended.desired);
      const ids = await readIdentifiers(created.id, deps);
      next.onsinch_order_id = created.id;
      next.onsinch_order_number = created.number ?? ids.order_number;
      next.onsinch_job_id = ids.job_id;
      next.last_ordered_hash = hashOrder(intended.desired);
      next.last_ordered_teams_hash = hashOrder(intended.desired.slot_teams);
      // The array, not just its fingerprint: an in-place amendment on the NEXT email
      // pairs the ids OnSinch reads back against exactly this, position by position.
      next.last_ordered_teams = intended.desired.slot_teams ?? [];
      // The ids, beside the blocks they belong to. Without these the amendment on the
      // next email has nothing to address and declines to the rebuild.
      next.last_ordered_team_ids = created.team_ids ?? [];
      next.status = "ordered";
      next.pending_order = undefined;
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "create", order_id: created.id, ok: true }];
      await emit("order_created", { order_id: created.id, size: intended.desired.slot_teams.reduce((n, s) => n + s.size, 0) });
    } else if (await tryAmendInPlace(next, intended, deps, emit)) {
      // Handled in place: the crew blocks that moved were PATCHed and the new ones
      // appended, and the order — its R number, its attachments, anyone signed on to it
      // — was never destroyed. Returns false when the change cannot be expressed that
      // way, chiefly a dropped block, and the rebuild below then runs as before.
    } else if (await tryReplace(next, intended, deps, emit)) {
      // Handled by delete-and-repost: the fallback for what PATCH cannot carry.
      // tryReplace returns false when it does not apply, and the patch path below then
      // runs exactly as it did before.
    } else {
      // An update to an EXISTING order is never fully applied by the API alone:
      // PATCH /orders takes top-level fields only, slot teams created nested in
      // the original POST have no exposed ids, and there is no GET /slotTeams to
      // diff against. So report exactly what went, and hand the rest to a human
      // instead of marking the job done.
      const applied = (await executor.patchOrder({ order_id: intended.order_id!, desired: intended.desired })) || [];
      const teams = intended.desired.slot_teams ?? [];
      const crew = teams.reduce((n, s) => n + (s.size || 0), 0);

      /**
       * DID THE CREW ACTUALLY CHANGE? Reaching here does not mean it did.
       *
       * `tryAmendInPlace` and `tryReplace` both return false when the slot-team hash is
       * unchanged, so a follow-up that moves only a top-level field — a PO, a revised
       * summary — lands here having changed no crew at all. This branch used to tell a
       * human to apply crew and times by hand anyway, and set needs_human on the ticket.
       *
       * Measured on the 106-case corpus, 2026-08-25: 9 of 43 amendments took this path
       * and in every one the composed team set was IDENTICAL before and after — 0 patches
       * and 0 appends planned. Every one of those was a false alarm asking ops to go and
       * change nothing.
       *
       * That cost is not the noise. It is that a flag which cries wolf nine times in ten
       * stops being read, and the tenth is the one where the crew really did not land.
       *
       * `last_ordered_teams_hash` still holds the PREVIOUS write here — this branch does
       * not update it until below — so the comparison is valid at this point and would
       * silently invert if that stopped being true.
       */
      const teamsChanged =
        !next.last_ordered_teams_hash || hashOrder(teams) !== next.last_ordered_teams_hash;
      const manual = !teamsChanged
        ? `no crew or time change in this message — the blocks on order #${intended.order_id} are unchanged`
        : `crew and times must be applied by hand on OnSinch order #${intended.order_id}` +
          (teams.length ? ` — this thread asks for ${crew} crew across ${teams.length} block(s)` : "");

      next.last_ordered_hash = hashOrder(intended.desired);
      next.pending_order = undefined;
      // Only when a crew change could NOT be verified as landed. An unchanged team set
      // has nothing to verify and nothing to hand over.
      next.needs_human = teamsChanged;
      // Same rule: a crew change that could not be verified as landed is a broken
      // booking, not a stand-in inside a good one.
      if (teamsChanged) next.review_only = false;
      if (applied.length) {
        next.status = "ordered";
        next.notes = [...next.notes, `updated ${applied.join(", ")} on order #${intended.order_id}; ${manual}`];
      } else if (!teamsChanged) {
        /**
         * Nothing was sent AND nothing had changed. That is not a failed update, it is a
         * message that asked for nothing — a "thanks, confirmed" with a reworded subject.
         * Calling it needs-info sends ops to look at an order that already agrees with
         * the client, which is the same false alarm as the note above wearing a status.
         */
        next.status = "ordered";
        next.notes = [...next.notes, `no change requested — order #${intended.order_id} already matches this thread`];
      } else {
        // Nothing reached OnSinch. Saying "ordered" here is the bug this replaces.
        next.status = "needs-info";
        next.notes = [...next.notes, `update NOT applied — nothing could be sent to OnSinch; ${manual}`];
      }
      next.order_action_log = [
        ...next.order_action_log,
        { ts: now(), kind: "patch", order_id: intended.order_id, ok: applied.length > 0, ...(applied.length ? {} : { error: "patch carried no fields" }) },
      ];
      await emit("order_updated", { order_id: intended.order_id, applied: applied.length });
    }
  } catch (err: any) {
    next.status = "error";
    next.notes = [...next.notes, String(err?.message ?? err)];
    next.order_action_log = [...next.order_action_log, { ts: now(), kind: intended.kind, ok: false, error: String(err?.message ?? err) }];
    await emit("order_error", { error: String(err?.message ?? err) });
  }
}

/**
 * Confirm a staged order (the dashboard's one-click approve in draft-only mode).
 * Idempotent: no-op if the thread has no pending order.
 */
export async function confirmOrder(
  thread_id: string,
  deps: PipelineDeps
): Promise<ConversationState | undefined> {
  const { store, metrics, now } = deps;
  const state = await store.get(thread_id);
  if (!state?.pending_order) return state;
  const emit = (type: any, meta?: Record<string, unknown>) =>
    metrics.emit({ ts: now(), thread_id, type, meta });
  const next = { ...state };
  await emit("order_confirmed", { kind: state.pending_order.kind });
  await executeOrder(next, state.pending_order, deps, emit);
  await store.put(next);
  return next;
}
