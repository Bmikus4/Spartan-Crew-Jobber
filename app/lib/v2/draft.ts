// ============================================================================
// What the drafter is told about a rebuild decision, whichever TV label it carries.
// ----------------------------------------------------------------------------
// EVERY DRAFT ASSUMES THE ORDER IS ALREADY MADE (Ben, 10-11: "drafts should assume the [DECISIONS V6]
// order was already created so that the team can just send them"). A card the system
// could not act on is acted on by a person, who then sends the draft unedited; a draft
// that said "being updated" or "will confirm shortly" promised a second email nobody
// writes (simulation C1, C2, 10-11).
//
// What the client never wrote is still asked for, because a person cannot make it up
// either. Only the planner's own "no X the client wrote" reasons become questions: a
// reason about OnSinch ("2 shifts could be the one meant") is the team's to settle, and
// asking the client about it reads as Spartan not knowing its own bookings.
// ============================================================================
import type { ReplyContext } from "../engine/reason";
import type { Decision } from "./interpret/plan";

const ASKS: Array<[RegExp, string]> = [
  [/no venue/i, "the venue"],
  [/no day the client wrote/i, "the date"],
  [/no start time the client wrote/i, "the start time"],
  [/no end time or duration the client wrote/i, "the finish time"],
  [/no crew count the client wrote/i, "how many crew"],
];

export function draftContext(d: Decision): ReplyContext {
  const said = d.kind === "handoff" ? d.reasons : [];
  const ask_for = [...new Set(said.flatMap((r) => r.split(";")).flatMap((r) => ASKS.filter(([re]) => re.test(r)).map(([, a]) => a)))];
  return { order_state: "assumed-done", ask_for, quote_attached: said.some((r) => /asked for a quote/.test(r)) };
}
