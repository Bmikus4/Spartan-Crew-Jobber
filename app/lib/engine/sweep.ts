// ============================================================================
// THE SWEEP — every bound thread, checked against OnSinch, on a cadence.
// ----------------------------------------------------------------------------
// Until now the engine only ever looked at a thread when an email arrived in it. That is
// the whole reason a silent write failure was invisible: nothing re-read a booking once
// the conversation went quiet, and most of them do go quiet. Lead time from writing an
// order to the job happening is a median of 7 days and a p90 of 199, so a booking spends
// most of its life with nobody asking after it.
//
// NO MODEL CALL HAPPENS HERE, and that is a design constraint rather than an optimisation.
// Everything this needs is already on the state row — the facts the client stated, the
// venue they resolved to, the shape we asked OnSinch for, the ids we hold. Re-deriving any
// of it from the email would spend money to reproduce an answer already on disk, and would
// let a model's reading drift between sweeps on text that has not changed.
//
// Three questions per thread, in order, and each one gates the next:
//
//   1. Is the order still there?   Staff delete our To Confirm orders in sweeps — 49
//      deletions across 31 sittings by three named people. A binding to a deleted order
//      is not a booking, and going on to amend it writes into nothing.
//   2. If it is gone, what did it become?  Ben, Q3: "if it doesnt exist anymore, look for
//      it again, exact matches should create the ammendment." That is `matchExistingOrder`
//      run against the stored facts — deterministic, free, and the same rule the inbound
//      path uses.
//   3. If it is there, does it hold what the thread asks for?  See reconcile.ts. An API
//      write leaves no audit row, so this is the only way a change that silently did not
//      land is ever noticed.
//
// A THREAD IS NEVER MADE WORSE BY BEING SWEPT. Every branch either changes nothing or
// moves the order towards the shape the client asked for; nothing here deletes, and a read
// that fails is treated as "nothing is known" rather than as evidence.
// ============================================================================
import type { ConversationState, DesiredOrder } from "./types";
import { logAction, type PipelineDeps } from "./pipeline";
import { readLiveShape, driftAgainst, driftKey, describeDrift } from "./reconcile";
import { matchExistingOrder, rNumbersIn, type OrderRec } from "./resolve";

/** How many times one unchanged difference is re-asserted before the thread gives up. */
export const SWEEP_RECONCILE_CEILING = 3;

export type SweepAction =
  | "skipped"
  | "holds"
  | "reasserted"
  | "rebound"
  | "lost"
  | "unreconciled"
  | "error";

export interface SweepOutcome {
  thread_id: string;
  order_id?: number;
  action: SweepAction;
  detail?: string;
}

const day = (s: unknown) => String(s ?? "").slice(0, 10);

/**
 * The shape this thread says its order should have — from `desired_order` where it is
 * there, and otherwise rebuilt from the blocks we last wrote.
 *
 * The fallback is not belt-and-braces. Until 2026-09-14 the compiler overwrote
 * `desired_order` with null on every pass that composed nothing, which is most messages in
 * a booked thread, so 171 of 267 live bindings hold null with a full block set still
 * sitting in `last_ordered_teams`. The compiler now carries the field forward, but those
 * rows are already written and no sweep can reconcile them without this.
 *
 * `last_ordered_teams` is in one way the better source anyway: it is what we actually
 * ASSERTED to OnSinch, where `desired_order` is what we composed. What it does not carry
 * is the order-level fields, so those simply go unreconciled on a row that has only this —
 * unreconciled, never reset to a default, which would overwrite a value with a guess.
 */
export function reconcileTarget(state: ConversationState): DesiredOrder | null {
  if (state.desired_order?.slot_teams?.length) return state.desired_order;
  const teams = state.last_ordered_teams;
  if (!teams?.length) return null;
  return {
    company_id: state.company_id ?? 0,
    slot_teams: teams,
  } as DesiredOrder;
}

/**
 * Has this job already happened? A booking in the past cannot be corrected and must not be
 * touched — re-asserting a shape onto last month's job is noise at best and, if anybody is
 * still attached to it, a change to a record of work that was done.
 *
 * Read off the desired blocks rather than `Order.happening`, because that is the only side
 * available without a read, and this runs before any read.
 *
 * THE JOB'S DATE IS THE ONLY THING THAT RETIRES A THREAD. Not how old the last message is,
 * and this is a decision rather than an omission — it is written here because here is where
 * a retention sweep would otherwise be added.
 *
 * Measured lead time from writing an order to the job happening: median 7 days, p75 30,
 * **p90 199, maximum 423**. A retention rule keyed on message age — 30 days, 90 days, any of
 * the obvious numbers — would drop a quarter of the tenant's live bookings, and it would drop
 * exactly the ones nobody is emailing about, which are the ones only this sweep is watching.
 * A thread goes quiet because the booking is settled, not because it is finished.
 *
 * So `conversation_state` is never purged by age, and the sweep skips a thread only once its
 * last block has ended. If a purge is ever needed, key it on this and on nothing else.
 */
function alreadyHappened(desired: DesiredOrder | undefined, todayISO: string): boolean {
  const ends = (desired?.slot_teams ?? []).map((t) => t.end).filter(Boolean).sort();
  if (!ends.length) return false;
  return day(ends[ends.length - 1]) < day(todayISO);
}

/**
 * One thread, checked and corrected. Returns what it did and mutates `state` in place;
 * the caller persists.
 *
 * Every early return is a reason NOT to touch the order, and each is a case where acting
 * would be worse than waiting for the next sweep.
 */
export async function reconcileThread(
  state: ConversationState,
  deps: PipelineDeps,
  opts: { todayISO: string }
): Promise<SweepOutcome> {
  const { onsinch, executor, store, now } = deps;
  const thread_id = state.thread_id;
  const order_id = Number(state.onsinch_order_id);

  if (!Number.isInteger(order_id) || order_id <= 0) return { thread_id, action: "skipped", detail: "no order" };
  const target = reconcileTarget(state);
  if (!target) {
    // Nothing to compare against. A thread whose shape was never recorded cannot be
    // reconciled towards anything, and inventing one from the order would make OnSinch
    // the source of truth for what the client asked for.
    return { thread_id, order_id, action: "skipped", detail: "no desired shape on the thread" };
  }
  if (alreadyHappened(target, opts.todayISO)) {
    return { thread_id, order_id, action: "skipped", detail: "the job is in the past" };
  }
  if ((state.reconcile?.attempts ?? 0) > SWEEP_RECONCILE_CEILING) {
    // Already a dead end and already labelled. Re-asserting costs two reads and a write
    // every sweep for the life of the thread and changes nothing.
    return { thread_id, order_id, action: "skipped", detail: "already unreconciled" };
  }

  // ---- 1. is it still there? --------------------------------------------------------
  let live;
  try {
    live = await readLiveShape(onsinch, order_id);
  } catch (err: any) {
    return { thread_id, order_id, action: "error", detail: String(err?.message ?? err) };
  }

  if (live.unreadable) {
    /**
     * ABSENCE NEEDS A POSITIVE CONTROL. This API answers an unsupported filter with an
     * empty list rather than an error, so "the order read back empty" and "the order is
     * gone" are the same response. Before treating it as deleted, the company's own order
     * list has to come back POPULATED — if that is empty too, the API is not answering and
     * nothing here is evidence of anything.
     */
    const company_id = Number(state.company_id);
    if (!Number.isInteger(company_id) || company_id <= 0) {
      return { thread_id, order_id, action: "skipped", detail: `unreadable and no client to check against: ${live.unreadable}` };
    }
    let orders: OrderRec[] = [];
    try {
      orders = (await onsinch.companyOrdersWithJob(company_id)) as OrderRec[];
    } catch (err: any) {
      return { thread_id, order_id, action: "error", detail: String(err?.message ?? err) };
    }
    if (!orders.length) {
      return { thread_id, order_id, action: "skipped", detail: "the client's order list came back empty — no evidence either way" };
    }
    if (orders.some((o) => Number(o.id) === order_id)) {
      // It IS in the list, so it exists and the single read was the thing that failed.
      return { thread_id, order_id, action: "skipped", detail: `read failed but the order exists: ${live.unreadable}` };
    }

    // ---- 2. it is gone. what did it become? -----------------------------------------
    const days = (state.facts?.requests ?? []).map((r) => r.date).filter((d): d is string => !!d);
    /**
     * THE PLACE LIST IS NOT OPTIONAL HERE, and leaving it out was silently disabling the
     * only venue comparison strong enough to refuse on. Without it `venueVerdict` falls
     * back to matching two raw strings, which never returns "differ-id" — so this branch
     * could not refuse a sole candidate however wrong it was. On the live set that is a
     * measured wrong bind: thread "PO - Tottenham Hotspur Stadium - 02/09/26" takes
     * "Blackout - MCS Prods @ The Tower Hotel", because it is the only order that client
     * has on the day, and a stadium crew change lands on a hotel.
     *
     * It is one extra read, and only on the branch where the order is already gone.
     *
     * R numbers still come from the SUBJECT alone rather than the message bodies, because
     * no message text is on the state row and this function is deliberately free of
     * model calls and thread reads. 83% of threads name no number at all, and over the
     * 96 deleted-order threads the fuller text moved exactly two of them, so the read is
     * not yet worth its cost — see scripts/score-successor-recovery.ts.
     */
    let places;
    try { places = await onsinch.allPlaces(); } catch { places = undefined; }
    const found = matchExistingOrder(days.sort()[0], orders, {
      days,
      location_text: state.facts?.location_text,
      place_id: state.place_id ? Number(state.place_id) : null,
      places,
      r_numbers: rNumbersIn(String(state.subject ?? "")),
    });
    if (found && "order_id" in found) {
      state.onsinch_order_id = found.order_id;
      state.onsinch_order_number = found.order_number ?? state.onsinch_order_number;
      state.onsinch_job_id = found.job_id ?? state.onsinch_job_id;
      /**
       * The ids we held belonged to the order that is gone. Clearing them is what makes
       * the next amendment DECLINE rather than PATCH blocks on the successor by position
       * — which is how one block's times get written onto another.
       */
      state.last_ordered_team_ids = undefined;
      state.last_ordered_teams = undefined;
      state.last_ordered_teams_hash = undefined;
      state.reconcile = undefined;
      state.notes = [
        ...state.notes,
        `order #${order_id} no longer exists — this thread is now order #${found.order_id}` +
          (found.order_number ? ` (R${found.order_number})` : "") +
          `, matched on ${found.by}`,
      ];
      await store.put(state);
      return { thread_id, order_id: found.order_id, action: "rebound", detail: `from #${order_id} by ${found.by}` };
    }

    /**
     * Gone, and nothing replaced it. The booking this thread believed in does not exist,
     * which ops must see — but a LABEL, never a queue (Ben, 2026-09-13). `built_flagged`
     * is left for flagBuiltIfNeeded to clear on the next pass, which is what takes the
     * "Order Built" tag off a thread with no order.
     */
    state.onsinch_order_id = undefined;
    state.onsinch_order_number = undefined;
    state.onsinch_job_id = undefined;
    state.last_ordered_team_ids = undefined;
    state.last_ordered_teams = undefined;
    state.last_ordered_teams_hash = undefined;
    state.reconcile = undefined;
    state.needs_human = true;
    state.review_only = false;
    state.notes = [...state.notes, `order #${order_id} has been deleted in OnSinch and nothing has replaced it`];
    await store.put(state);
    return { thread_id, order_id, action: "lost" };
  }

  // ---- 3. does it hold what the thread asks for? ------------------------------------
  const drift = driftAgainst(live, target, state.last_ordered_team_ids);
  if (!drift.length) {
    if (state.reconcile) {
      state.reconcile = undefined;
      await store.put(state);
    }
    return { thread_id, order_id, action: "holds" };
  }

  const key = driftKey(drift);
  const same = state.reconcile?.order_id === order_id && state.reconcile.key === key;
  const attempts = (same ? state.reconcile!.attempts : 0) + 1;
  state.reconcile = { order_id, key, attempts, first_ts: same ? state.reconcile!.first_ts : now() };

  if (attempts > SWEEP_RECONCILE_CEILING) {
    state.needs_human = true;
    state.review_only = false;
    state.notes = [
      ...state.notes,
      `order #${order_id} has not taken this change after ${SWEEP_RECONCILE_CEILING} attempts — ${describeDrift(drift)}`,
    ];
    logAction(state, now, {
      ts: now(),
      kind: "amend-refused",
      order_id,
      ok: false,
      error: `unreconciled after ${SWEEP_RECONCILE_CEILING} attempts`,
    });
    await store.put(state);
    return { thread_id, order_id, action: "unreconciled", detail: describeDrift(drift) };
  }

  // Re-assert. The crew blocks first, then the order-level fields, exactly as the inbound
  // path does — one pass produces one complete correction rather than half of one.
  let applied = 0;
  try {
    if (executor.amendOrderInPlace && state.last_ordered_teams?.length) {
      const res = await executor.amendOrderInPlace({
        order_id,
        previous: state.last_ordered_teams,
        desired: target,
        known: { job_id: state.onsinch_job_id, team_ids: state.last_ordered_team_ids },
        async onCreated(team_id) {
          // `POST /slotTeams` is the one non-idempotent call on this path, so an appended
          // block's id is on disk before the next one is sent.
          state.last_ordered_team_ids = [...(state.last_ordered_team_ids ?? []), team_id];
          await store.put(state);
        },
      });
      if (res.amended) applied += res.amended.patched + res.amended.added.length;
      // A decline is not a failure here. It means the correspondence between our blocks
      // and OnSinch's cannot be established — ops added a block by hand, or this order was
      // never ours — and the sweep must not guess its way past that. The order-level
      // fields below still go.
    }
    const fields = (await executor.patchOrder({ order_id, desired: target })) || [];
    applied += fields.length;
  } catch (err: any) {
    state.notes = [...state.notes, `re-assertion against order #${order_id} failed: ${String(err?.message ?? err)}`];
    await store.put(state);
    return { thread_id, order_id, action: "error", detail: String(err?.message ?? err) };
  }

  logAction(state, now, { ts: now(), kind: "amend", order_id, ok: true });
  state.notes = [
    ...state.notes,
    `OnSinch did not hold what this thread asks for — re-asserted (attempt ${attempts}): ${describeDrift(drift)}`,
  ];
  await store.put(state);
  return { thread_id, order_id, action: "reasserted", detail: `${applied} field(s) sent; ${describeDrift(drift)}` };
}

/**
 * Every bound thread, swept.
 *
 * `limit` exists because a serverless function has a wall clock and each thread costs two
 * reads. It counts threads that COST something, not threads visited, and the difference
 * is what makes a scheduled sweep cover the population rather than the same head of it
 * forever: the store returns threads most-recently-updated first, and 219 of 287 live
 * rows are decided from the state row alone — no desired shape, or the job is already in
 * the past — for no reads at all. Counting those against the limit meant a run of 40
 * spent its whole budget on rows it never read, stopped 40 threads in, and came back to
 * the same 40 on the next run. The threads it could never reach that way are the quiet
 * ones, and quiet is the condition this sweep exists for: lead time to the job is a
 * median of 7 days and a p90 of 199, so a booking spends most of its life with nobody
 * emailing about it.
 */
export async function sweepAll(
  states: ConversationState[],
  deps: PipelineDeps,
  opts: { todayISO: string; limit?: number }
): Promise<{ swept: number; outcomes: SweepOutcome[] }> {
  const outcomes: SweepOutcome[] = [];
  let swept = 0;
  for (const s of states) {
    if (opts.limit && swept >= opts.limit) break;
    let outcome: SweepOutcome;
    try {
      outcome = await reconcileThread(s, deps, { todayISO: opts.todayISO });
    } catch (err: any) {
      // One thread's failure must never end the sweep. The whole point of a cadence is
      // that the next run picks up whatever this one dropped.
      outcome = { thread_id: s.thread_id, action: "error", detail: String(err?.message ?? err) };
    }
    outcomes.push(outcome);
    // A "skipped" thread was decided before any OnSinch read — see the note above on why
    // those must be free. Everything else spent the wall clock the limit is protecting.
    if (outcome.action !== "skipped") swept++;
  }
  return { swept, outcomes };
}
