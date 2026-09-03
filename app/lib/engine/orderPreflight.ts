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
  args: { order_id: number; company_id?: number; happening_day?: string }
): Promise<Preflight> {
  const { order_id } = args;
  const live = (await client.orderById(order_id)) as LiveOrder | null;
  if (!live) {
    // Someone deleted it, or our stored id is stale. Either way there is nothing to
    // change, and creating silently could duplicate a job booked elsewhere.
    //
    // BUT THE JOB IS USUALLY STILL THERE, UNDER SOMEBODY ELSE'S ID. Measured on the
    // live tenant 2026-09-03: of the 54 recorded ids that read back absent, 24 have a
    // PRESENT order for the same company on the same day, raised by a named person,
    // with an id and an R number one or two away from ours (ours #15588 -> #15590 by
    // user 413; ours #15578 -> #15585; ours #13783 -> #13784). Ops re-key the engine's
    // order and the original goes. So "no longer exists" was true and useless: it sent
    // a human to look for a deleted order instead of at the live one.
    //
    // Naming it is a REPORT, NOT AN ADOPTION. Whether the engine may re-point a thread
    // at an order a person raised, and then amend it, is a business ruling and is
    // DECISIONS.md D6 — so nothing is written here and the refusal still refuses. This
    // only spends one read to turn a dead end into an order number.
    const successor = await successorFor(client, args);
    return {
      refused:
        `order #${order_id} no longer exists in OnSinch — not recreating it blindly` +
        (successor ? ` — ${successor}` : ""),
    };
  }
  /**
   * THIS GATE USED TO BE `provisional !== true` AND CANNOT BE ANY MORE.
   *
   * Orders are now created in the To Confirm posture, which means OnSinch's own
   * defaults, which means `provisional` is FALSE on every order this engine raises
   * (see format.ts). The old gate would therefore refuse every amendment the engine
   * ever attempted — including the delete-and-repost that a dropped block needs.
   *
   * So the gate moves from a flag to the harm it was standing in for. `provisional`
   * was never the thing that mattered; it was a proxy for "somebody has committed to
   * this booking". The direct measure of that is whether crew are signed on, and it
   * is measured per destructive action rather than here: `replaceOrder` refuses to
   * delete an order with ANY attendance, and `amendOrder` refuses to shrink a block
   * that has people on it. Both read the live tenant at the moment they act.
   *
   * A flag anyone can toggle in the UI was also never a guarantee. Attendance is a
   * fact about people's shifts, and it is what makes a mistake cost something.
   */
  if (args.company_id && live.company_id && Number(live.company_id) !== Number(args.company_id)) {
    return {
      refused: `order #${order_id} belongs to company ${live.company_id}, not ${args.company_id} — refusing to delete another client's order`,
    };
  }
  return { live };
}

/**
 * The order that probably replaced a vanished one, described for a human, or null.
 *
 * ONE READ, AND IT MAY ANSWER NOTHING. Both keys have to be known — a company and a
 * day — because either alone names the wrong thing: the company alone would offer up
 * whichever job that client last booked, and a day alone spans every client.
 *
 * THE R NUMBER IS NOT USABLE HERE AND THAT IS WHY THIS MATCHES ON THE DAY. R numbers
 * are `max(live)+1` and ARE REUSED after a delete — 10726 stands against two different
 * recorded orders in our own database — so "find the order with our R number" would
 * confidently return a stranger's booking. The numeric id is the only key, and the one
 * we hold is precisely the one that has stopped resolving.
 *
 * A FAILED LOOKUP RETURNS NULL, DELIBERATELY, unlike `findLostCreate` in onsinch.ts
 * which throws. The asymmetry is the point: there, an unanswered question could
 * authorise a second write, so it must not read as "absent"; here the caller is
 * refusing either way and the only thing at stake is whether the note is more useful
 * than it was. Degrading to the old message costs nothing.
 */
async function successorFor(
  client: OnsinchClient,
  args: { order_id: number; company_id?: number; happening_day?: string }
): Promise<string | null> {
  const day = (args.happening_day ?? "").slice(0, 10);
  if (!args.company_id || day.length !== 10) return null;
  try {
    // `id[eq]` is not used: this is a list by company, and the day is applied here
    // rather than as a `happening[eq]` filter because `happening` is a timestamp and
    // an [eq] against a bare date would compare it against midnight and match nothing.
    const rows = (await client.getOrders?.({ "company_id[eq]": args.company_id, limit: 100 })) ?? [];
    const sameDay = rows
      .filter((o: any) => {
        const job = (Array.isArray(o?.Job) ? o.Job[0] : o?.Job) ?? {};
        return String(o?.happening ?? "").slice(0, 10) === day || String(job?.min_beginning ?? "").slice(0, 10) === day;
      })
      // Never offer the dead order back to the caller if the filter happened to include
      // it, and prefer the highest id: after a re-key the replacement is the later row.
      .filter((o: any) => Number(o?.id) !== Number(args.order_id))
      .sort((a: any, b: any) => Number(b?.id) - Number(a?.id));
    const hit = sameDay[0];
    if (!hit) return null;
    const who = hit.creator == null ? "through the API" : `by user ${hit.creator}`;
    return (
      `order #${hit.id}${hit.number ? ` (R${hit.number})` : ""} exists for the same client on ${day}, raised ${who}` +
      ` — very probably this same job, re-keyed. Check that one rather than looking for #${args.order_id}.`
    );
  } catch {
    return null;
  }
}
