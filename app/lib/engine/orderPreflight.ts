// ============================================================================
// The three questions asked before ANY write reaches an order somebody else can see.
// ----------------------------------------------------------------------------
// Two paths change an existing order now: amend-in-place (amendOrder.ts) and
// delete-and-repost (replaceOrder.ts). They differ in everything except the checks
// that decide whether the order is ours to touch at all — and those are the checks
// that stand between an amendment and a confirmed booking.
//
// Extracted so there is ONE implementation. Two copies of "a confirmed order is never
// touched" is one copy too many: the copies drift, and the one that drifts is the one
// nobody reads, on the path nobody exercises, protecting the booking that matters.
//
// The refusal strings are load-bearing. They are what ops read on the board when a
// change did not land, and test/replaceOrder.ts asserts them, so they are reproduced
// here verbatim rather than improved.
// ============================================================================
import type { OnsinchClient } from "./onsinch";

export interface LiveOrder extends Record<string, unknown> {
  id: number;
  provisional?: boolean;
  quote?: boolean;
  company_id?: number;
  status?: string;
}

export type Preflight =
  | { live: LiveOrder; refused?: undefined }
  | { live?: undefined; refused: string };

/**
 * Re-read the order from OnSinch and decide whether this engine may write to it.
 *
 * Reads it rather than trusting our stored copy, always. The stored copy is what we
 * wrote weeks ago; since then a human may have approved it, edited it, or deleted it.
 *
 * `provisional` carries the whole guarantee. Custody was dropped as a gate (Ben,
 * 2026-08-18 — an amendment applies to an ops-raised draft too, because the
 * alternative is a booking that disagrees with the client's latest email and a human
 * who has to notice on their own), so this flag is the only thing left standing
 * between a change and a live booking. A CONFIRMED order is never touched, whoever
 * raised it, and the change goes to a human instead.
 */
export async function preflightOrder(
  client: OnsinchClient,
  args: { order_id: number; company_id?: number }
): Promise<Preflight> {
  const { order_id } = args;
  const live = (await client.orderById(order_id)) as LiveOrder | null;
  if (!live) {
    // Someone deleted it, or our stored id is stale. Either way there is nothing to
    // change, and creating silently could duplicate a job booked elsewhere.
    return { refused: `order #${order_id} no longer exists in OnSinch — not recreating it blindly` };
  }
  if (live.provisional !== true) {
    return {
      refused:
        `order #${order_id} is no longer provisional (provisional=${String(live.provisional)}, quote=${String(live.quote)}) — ` +
        `it has been confirmed; crew and times must be changed by hand`,
    };
  }
  if (args.company_id && live.company_id && Number(live.company_id) !== Number(args.company_id)) {
    return {
      refused: `order #${order_id} belongs to company ${live.company_id}, not ${args.company_id} — refusing to delete another client's order`,
    };
  }
  return { live };
}
