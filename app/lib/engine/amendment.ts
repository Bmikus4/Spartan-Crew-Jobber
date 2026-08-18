// ============================================================================
// May an amendment SHRINK an order, or only grow it?
// ----------------------------------------------------------------------------
// It may shrink. Refusing would be the more expensive rule by far: a client who
// says "make it 4 instead of 6" and gets 6 is billed for two people they told us
// not to send, every time, and the tool would be systematically wrong in the
// direction that costs them money and us the account. Growth-only is a rule that
// protects the engine from embarrassment at the client's expense.
//
// What actually needs guarding is the shape of shrink that is far more likely to be
// a misread than a request:
//
//   to ZERO      "the order now needs nobody" is a CANCELLATION, and the engine has
//                no cancellation class at all — classify returns new-job | update |
//                confirmation-only | not-a-job, so a cancellation arrives labelled
//                "update" and composes as an empty order. Applied literally that
//                empties a real booking on the strength of a class the model was
//                never given. It holds for a human.
//
//   a DEEP cut   a thread that drops most of the crew is either a genuine scale-back
//                or a later message being read as the whole request instead of an
//                amendment to it. Both happen. It is applied — the client's latest
//                word is the order — but it is never applied quietly.
//
// The threshold is not a safety line, it is a loudness line: everything is applied
// except zero. Growth is never remarked on, because growth has no failure mode worse
// than a bigger order the client asked for.
// ============================================================================
import type { DesiredOrder } from "./types";

export interface AmendmentVerdict {
  /** Total people before and after, chiefs included. */
  before: number;
  after: number;
  /** apply = write it. hold = stage it and tell a human, write nothing. */
  action: "apply" | "hold";
  /** A sentence for the ticket, or null when there is nothing worth saying. */
  note: string | null;
}

const headcount = (o: DesiredOrder | null | undefined): number =>
  (o?.slot_teams ?? []).reduce((n, t) => n + t.size, 0);

/** How much of the crew has to go before it is worth saying out loud. */
const DEEP_CUT = 0.5;

export function assessAmendment(prior: DesiredOrder | null | undefined, next: DesiredOrder | null | undefined): AmendmentVerdict {
  const before = headcount(prior);
  const after = headcount(next);

  // Nothing existed to shrink. A first order is not an amendment.
  if (!before) return { before, after, action: "apply", note: null };

  if (after === 0) {
    return {
      before, after, action: "hold",
      note: `this would empty an order of ${before} — read as a cancellation, which the engine cannot classify. Nothing was written.`,
    };
  }
  if (after >= before) return { before, after, action: "apply", note: null };

  const dropped = before - after;
  const deep = dropped / before >= DEEP_CUT;
  return {
    before, after, action: "apply",
    note: deep
      ? `crew cut from ${before} to ${after} — more than half. Applied, because the client's latest word is the order, but check it is an amendment and not a later message read as the whole request.`
      : `crew reduced from ${before} to ${after}`,
  };
}
