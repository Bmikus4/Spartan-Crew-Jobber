// ============================================================================
// Changing the crew or the times on a draft order: delete it and post it again.
// ----------------------------------------------------------------------------
// PATCH /orders is top-level only. Slot teams created nested in the original POST
// expose no ids, and there is no GET /slot_teams, so a crew or time change cannot be
// applied to an existing order and cannot even be diffed against it. Until now a
// client moving a shift reached nobody: patchOrder sent `specification` and the PO,
// and the crew change was left in a note for a human who may never read it.
//
// The only route the API leaves is to delete the order and post the corrected one.
// Deleting an order cascades to its job and slot teams (verified live on TEST company
// 515 in July), so the replacement is clean rather than half-attached.
//
// This is the most destructive thing in the codebase, so the shape of it is defensive
// rather than convenient:
//
// REFUSES, rather than destroying, when anything is off. It re-reads the order from
// OnSinch first — never trusting our stored copy, which is what we wrote weeks ago —
// and stands down unless the live order is still `provisional` AND `quote`, still
// belongs to the company we think, and the replacement actually has crew in it. An
// order a human has approved is theirs; we do not delete it to apply an email.
//
// CANNOT LOSE THE ORDER. The sequence is persist-intent, delete, persist-deleted,
// create, and the caller supplies the persistence. Every interruption is recoverable:
//   crash after intent, before delete   -> retry finds the order alive, deletes it
//   crash after delete, before persist  -> retry finds it GONE, treats it as deleted
//   crash after persist-deleted         -> retry skips the delete, only creates
//   create fails after delete           -> loud error, needs-human, intent KEPT with a
//                                          full snapshot of what was deleted, so the
//                                          retry re-posts instead of deleting again
// The snapshot is why a failed replace is an incident and not a data loss: the order
// that was destroyed is written down in full before it is destroyed.
//
// It NEVER deletes twice. `alreadyDeleted` short-circuits to the create, and that flag
// comes from persisted state, not from anything in this process.
// ============================================================================
import type { OnsinchClient } from "./onsinch";
import type { DesiredOrder } from "./types";
import { buildOrderBody } from "./format";

export interface ReplaceResult {
  /** Set when the replacement was created. */
  created?: { id: number; number: string };
  /** Set when we declined to touch anything, with the reason for a human. */
  refused?: string;
  /** True when the old order was deleted during THIS call. */
  deleted: boolean;
  /** What the old order looked like before deletion — the recovery record. */
  snapshot?: unknown;
}

export interface ReplaceHooks {
  /**
   * Persist that a delete is ABOUT to happen, with the snapshot. Must have committed
   * before it returns — everything after this point depends on it being on disk.
   */
  onIntent(snapshot: unknown): Promise<void>;
  /** Persist that the old order is gone, before the replacement is attempted. */
  onDeleted(): Promise<void>;
}

/**
 * Replace a provisional order with a corrected one.
 *
 * `alreadyDeleted` is for the resumed case only: it says a previous attempt got as far
 * as removing the old order, so this call must go straight to the create.
 */
export async function replaceProvisionalOrder(
  client: OnsinchClient,
  args: { order_id: number; desired: DesiredOrder; alreadyDeleted?: boolean },
  hooks: ReplaceHooks
): Promise<ReplaceResult> {
  const { order_id, desired } = args;

  // A replacement with no crew in it is not a correction, it is a deletion wearing one.
  const teams = desired.slot_teams ?? [];
  if (!teams.length) {
    return { deleted: false, refused: `refusing to replace order #${order_id}: the replacement carries no slot teams` };
  }
  if (teams.some((t) => !t.beginning || !t.end)) {
    return { deleted: false, refused: `refusing to replace order #${order_id}: a slot team has no start or finish (the date is still TBC)` };
  }

  if (args.alreadyDeleted) {
    // Resuming: the old order is already gone. Do not preflight — there is nothing left
    // to preflight, and re-reading a deleted order would look like "refuse" and strand
    // the thread with no order at all.
    const created = await client.createOrder(buildOrderBody(desired));
    return { deleted: false, created };
  }

  const live = await client.orderById(order_id);
  if (!live) {
    // Someone deleted it, or our stored id is stale. Either way there is nothing to
    // replace, and creating silently could duplicate a job booked elsewhere.
    return { deleted: false, refused: `order #${order_id} no longer exists in OnSinch — not recreating it blindly` };
  }
  // BOTH flags are the draft posture the engine writes. Either one missing means a human
  // has taken the order on, and it stops being ours to delete.
  if (live.provisional !== true || live.quote !== true) {
    return {
      deleted: false,
      refused:
        `order #${order_id} is no longer a draft (provisional=${String(live.provisional)}, quote=${String(live.quote)}) — ` +
        `crew and times must be changed by hand`,
    };
  }
  if (desired.company_id && live.company_id && Number(live.company_id) !== Number(desired.company_id)) {
    return {
      deleted: false,
      refused: `order #${order_id} belongs to company ${live.company_id}, not ${desired.company_id} — refusing to delete another client's order`,
    };
  }

  // From here on the order is going away, so the record of it goes down first.
  await hooks.onIntent(live);
  await client.deleteOrders([order_id]);
  await hooks.onDeleted();

  // If this throws, the caller sees the error with deleted:true already persisted, so
  // the retry re-posts rather than deleting a second time.
  const created = await client.createOrder(buildOrderBody(desired));
  return { deleted: true, created, snapshot: live };
}
