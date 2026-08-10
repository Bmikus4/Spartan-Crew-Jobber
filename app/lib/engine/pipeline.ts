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
import type { Actions, ConversationState, DesiredOrder, HydratedThread, Settings } from "./types";

/** The side-effecting edges. Injected so the pipeline stays testable. */
export interface Executor {
  createReplyDraft(a: NonNullable<Actions["createReplyDraft"]>): Promise<string>; // -> draft id
  createOrder(order: NonNullable<Actions["createOrder"]>): Promise<{ id: number; number: string }>;
  /**
   * Apply what can safely be applied to an EXISTING order, and report which
   * fields actually went. Returning the applied list is what stops the engine
   * claiming success for a write that carried nothing — OnSinch's PATCH /orders
   * is top-level only, so the substance of most updates (crew size, times) can
   * never be applied this way, and there is no GET /slotTeams to even diff it.
   */
  patchOrder(p: NonNullable<Actions["patchOrder"]>): Promise<string[] | void>;
  /**
   * Apply a crew or time change to a DRAFT order by deleting it and posting the
   * corrected one — the only route the API leaves (see replaceOrder.ts).
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
  }): Promise<{ created?: { id: number; number: string }; refused?: string; deleted: boolean }>;
}

export interface PipelineDeps extends CompileDeps {
  store: StateStore;
  metrics: MetricSink;
  executor: Executor;
  settings: Settings;
  hashOrder: (o: unknown) => string;
  /** Feeds the sender ledger that triage reads. Injected; absent in tests. */
  recordSender?: (a: { addr: string; thread_id: string; wasJob: boolean; subject?: string }) => Promise<void>;
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
    const assumedRate = intended.desired.rate_card_source === "default";
    if (settings.order_mode === "auto" && !assumedRate) {
      // hands-free: write straight to OnSinch
      await executeOrder(next, intended, deps, emit);
    } else {
      if (assumedRate && settings.order_mode === "auto") {
        next.notes = [
          ...next.notes,
          `held for confirmation despite auto mode: the rate card was assumed, not derived from this client's history`,
        ];
      }
      // draft-only (launch default): stage for one-click human confirm
      next.pending_order = intended;
      next.status = "proposed";
      await emit("order_proposed", {
        kind: intended.kind,
        size: intended.desired.slot_teams.reduce((n, s) => n + s.size, 0),
      });
    }
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
  return next;
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

  try {
    const res = await executor.replaceOrder({
      order_id,
      desired: intended.desired,
      weCreatedIt,
      alreadyDeleted: resuming ? next.order_replace?.deleted === true : false,
      async onIntent(snapshot) {
        next.order_replace = { order_id, deleted: false, snapshot, ts: now() };
        await store.put(next);
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
      next.onsinch_order_id = res.created.id;
      next.onsinch_order_number = res.created.number;
      next.last_ordered_hash = hashOrder(intended.desired);
      next.last_ordered_teams_hash = teamsHash;
      next.status = "ordered";
      next.pending_order = undefined;
      next.order_replace = undefined;
      next.notes = [
        ...next.notes,
        `crew/time change applied by replacing draft order #${old} with #${res.created.id} — PATCH cannot carry slot teams`,
      ];
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "replace", order_id: res.created.id, ok: true }];
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
      next.onsinch_order_id = created.id;
      next.onsinch_order_number = created.number;
      next.last_ordered_hash = hashOrder(intended.desired);
      next.last_ordered_teams_hash = hashOrder(intended.desired.slot_teams);
      next.status = "ordered";
      next.pending_order = undefined;
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "create", order_id: created.id, ok: true }];
      await emit("order_created", { order_id: created.id, size: intended.desired.slot_teams.reduce((n, s) => n + s.size, 0) });
    } else if (await tryReplace(next, intended, deps, emit)) {
      // Handled by delete-and-repost: the crew or the times moved, which PATCH cannot
      // carry. tryReplace returns false when it does not apply, and the patch path below
      // then runs exactly as it did before.
    } else {
      // An update to an EXISTING order is never fully applied by the API alone:
      // PATCH /orders takes top-level fields only, slot teams created nested in
      // the original POST have no exposed ids, and there is no GET /slotTeams to
      // diff against. So report exactly what went, and hand the rest to a human
      // instead of marking the job done.
      const applied = (await executor.patchOrder({ order_id: intended.order_id!, desired: intended.desired })) || [];
      const teams = intended.desired.slot_teams ?? [];
      const crew = teams.reduce((n, s) => n + (s.size || 0), 0);
      const manual =
        `crew and times must be applied by hand on OnSinch order #${intended.order_id}` +
        (teams.length ? ` — this thread asks for ${crew} crew across ${teams.length} block(s)` : "");

      next.last_ordered_hash = hashOrder(intended.desired);
      next.pending_order = undefined;
      next.needs_human = true; // always: the crew change cannot be verified as landed
      if (applied.length) {
        next.status = "ordered";
        next.notes = [...next.notes, `updated ${applied.join(", ")} on order #${intended.order_id}; ${manual}`];
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
