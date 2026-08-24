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
// and stands down unless the live order is still `provisional`, still belongs to the
// company we think, and the replacement actually has crew in it.
//
// CUSTODY USED TO BE A SECOND GATE AND IS NOT ANY MORE (Ben, 2026-08-18). It refused
// any order this engine had not created, on the reasoning that an ops-raised draft is
// not ours to delete. Ben overruled it: an amendment rebuilds the order whoever raised
// it, because the alternative is a booking that disagrees with the client's latest
// email and a human who has to notice on their own. `provisional` now carries the
// whole guarantee by itself — a CONFIRMED order is never touched, whoever raised it.
//
// That widening is why carryForward exists. Rebuilding an ops draft from the engine's
// own idea of the order would return it correct in crew and blank in every field a
// person had typed, so the live order's values are read back and put on the
// replacement, and anything a rebuild cannot preserve refuses instead of dropping it.
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
import { preflightOrder } from "./orderPreflight";

export interface ReplaceResult {
  /** Set when the replacement was created. */
  created?: { id: number; number?: string };
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
  args: { order_id: number; desired: DesiredOrder; alreadyDeleted?: boolean; weCreatedIt: boolean },
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

  /**
   * Does the order exist, is it still a draft, and is it this client's?
   *
   * Shared with the in-place amendment path (orderPreflight.ts). `provisional` is the
   * flag a human clears when they take the order on, and since custody was dropped as a
   * gate (Ben, 2026-08-18 — an amendment rebuilds an ops-raised draft too) it is the
   * ONLY thing standing between an amendment and a live booking. One implementation, so
   * the two paths cannot drift on the rule that protects a confirmed order.
   */
  const pre = await preflightOrder(client, { order_id, company_id: desired.company_id });
  if (!pre.live) return { deleted: false, refused: pre.refused };
  const live = pre.live;

  /**
   * IS ANYBODY BOOKED ON IT? This is the gate `provisional` was wrongly carrying.
   *
   * A draft was assumed to be nobody's booking yet. It is not: on the live tenant, 18
   * of the 40 most recent provisional orders already had crew signed on, one of them 94
   * people. Deleting the order cascades to its slots, and the replacement's slots are
   * new and empty, so every one of those people is silently detached from a job they
   * think they are working — and the job is left unstaffed with nobody told.
   *
   * That is worse than the failure this whole path exists to fix. An amendment that
   * cannot be applied leaves a booking that disagrees with the client's latest email,
   * which a human can read and correct; an amendment that unbooks fourteen people is
   * discovered on the day, at the venue.
   *
   * So a staffed order is never rebuilt. The crew change goes to a human instead, with
   * the count in the message so they know what they are being asked to preserve.
   */
  const assigned = await client.attendanceCount(order_id).catch(() => -1);
  if (assigned !== 0) {
    return {
      deleted: false,
      refused:
        assigned < 0
          ? `could not check whether anyone is booked on order #${order_id} — refusing to rebuild it blind`
          : `order #${order_id} already has ${assigned} crew signed on; rebuilding it would detach them. ` +
            `Crew and times must be changed by hand so the people keep their shifts`,
    };
  }

  /**
   * Carry forward what the engine does not model.
   *
   * A rebuild posts the engine's idea of the order, and the engine's idea has no room
   * for most of what a person types into OnSinch. On an order we raised that costs
   * nothing — there was never anything else on it. On an ops-raised draft, which is
   * now in scope, everything they set by hand would quietly cease to exist: the order
   * would come back correct in crew and blank in every field somebody filled in.
   *
   * So the live order's own values win for every field the engine does not set, and a
   * field it cannot carry stops the rebuild rather than being dropped silently. Losing
   * ops' hand-entered detail is the failure they would notice and we would not.
   */
  const carried = carryForward(live, desired);
  if (carried.unsupported.length) {
    return {
      deleted: false,
      refused:
        `order #${order_id} carries ${carried.unsupported.join(", ")}, which a rebuild cannot preserve — ` +
        `refusing to delete it rather than dropping what somebody set by hand`,
    };
  }

  // From here on the order is going away, so the record of it goes down first.
  await hooks.onIntent(live);
  await client.deleteOrders([order_id]);
  await hooks.onDeleted();

  // If this throws, the caller sees the error with deleted:true already persisted, so
  // the retry re-posts rather than deleting a second time.
  const created = await client.createOrder(buildOrderBody(carried.desired));
  return { deleted: true, created, snapshot: live };
}

/**
 * Fields OnSinch accepts on an order that the engine never sets. Read off the live
 * order and put back on the rebuild, so a hand-raised draft comes back whole.
 *
 * `supervisor_id` and the job's `admin_note` live on the Job rather than the order and
 * are set through it; the rest are top-level.
 */
const CARRIED_FIELDS = [
  "agency_invoice_address_id",
  "reverse_charge",
  "order_manager_id",
  "intern_name",
  "specification",
] as const;

/**
 * Anything present on the live order that a rebuild would silently lose. Attachments
 * are the one that matters: DELETE /orders cascades, and a PDF somebody uploaded is
 * not recreatable from anything the engine holds.
 */
const CANNOT_CARRY: Array<[string, (live: Record<string, unknown>) => boolean]> = [
  ["an attachment", (l) => Array.isArray(l.Attachment) && (l.Attachment as unknown[]).length > 0],
];

export function carryForward(
  live: Record<string, unknown>,
  desired: DesiredOrder
): { desired: DesiredOrder; carried: string[]; unsupported: string[] } {
  const mine = desired as unknown as Record<string, unknown>;
  const add: Record<string, unknown> = {};
  const carried: string[] = [];
  for (const f of CARRIED_FIELDS) {
    const v = live[f];
    /**
     * Only a value somebody actually set. Every field here is an id, a string or a
     * flag whose unset state is falsy, so a blanket falsy test is right and a
     * null/undefined test is not: `order_manager_id: 0` is not a manager, and
     * `reverse_charge: false` is the default rather than a choice. Carrying either
     * would write OnSinch's own emptiness back as though it were ops' intent.
     */
    if (!v) continue;
    // Only when the engine is not itself setting it: the amendment is the newer truth
    // for anything it actually read out of the email.
    if (mine[f] !== undefined && mine[f] !== "") continue;
    add[f] = v;
    carried.push(f);
  }
  const out = { ...desired, ...add } as DesiredOrder;
  const unsupported = CANNOT_CARRY.filter(([, has]) => has(live)).map(([name]) => name);
  return { desired: out, carried, unsupported };
}
