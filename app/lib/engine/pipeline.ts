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
import type { Actions, ConversationState, HydratedThread, Settings } from "./types";

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
}

export interface PipelineDeps extends CompileDeps {
  store: StateStore;
  metrics: MetricSink;
  executor: Executor;
  settings: Settings;
  hashOrder: (o: unknown) => string;
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
    if (settings.order_mode === "auto") {
      // hands-free: write straight to OnSinch
      await executeOrder(next, intended, deps, emit);
    } else {
      // draft-only (launch default): stage for one-click human confirm
      next.pending_order = intended;
      next.status = "proposed";
      await emit("order_proposed", {
        kind: intended.kind,
        size: intended.desired.slot_teams.reduce((n, s) => n + s.size, 0),
      });
    }
  }

  await store.put(next);
  return next;
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
      next.status = "ordered";
      next.pending_order = undefined;
      next.order_action_log = [...next.order_action_log, { ts: now(), kind: "create", order_id: created.id, ok: true }];
      await emit("order_created", { order_id: created.id, size: intended.desired.slot_teams.reduce((n, s) => n + s.size, 0) });
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
