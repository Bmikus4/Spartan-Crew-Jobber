// ============================================================================
// A stable code on every decision, and the defaults a write used (addendum 5.1, 10-24).
// ----------------------------------------------------------------------------
// The scoreboard sorted decisions by matching their reason TEXT (real-email-scoreboard.mts), so
// rewording a message moved the stats and two weeks could not be compared. The code is now
// stamped on the decision when it is made and stored with it: a tally reads codes, never prose.
// The table sits beside the planner's words on purpose; test/reasonCodes.ts runs every reason
// the planner's own tests produce through it, so a reason reworded without its code here fails
// the gate instead of turning into "other".
//
// The prefix is the family the weekly numbers are counted by: reply_ (a person writes back),
// policy_ (a rule hands it to a person whatever the reading), booking_ (which order is meant),
// request_ (a shape the system does not perform), reading_ (the reader's values not borne out by
// the words), system_ (a failure), none_ (nothing to do).
// ============================================================================
import type { Decision } from "./interpret/plan";
import type { RunResult } from "./bot/run";

/** First match wins. */
export const REASON_CODES: ReadonlyArray<readonly [string, RegExp]> = [
  ["reply_quote", /the client asked for a quote/],
  ["reply_unclear", /the request is unclear/],
  ["reply_detail_missing", /: no (day|start time|end time or duration|crew count|new time or length|venue) the client wrote$|^no venue in the email$/],
  ["policy_lead_days", /within \d+ days of the email/],
  ["policy_short_call", /Spartan books 2 hours at least/],
  ["policy_past_day", /before the email was sent/],
  ["policy_day_over", /is already over/],
  ["policy_confirmed_proposal", /the client confirmed/],
  // Before system_failed: "linked to order N, which the system could not read" is a booking gone, not a fault.
  ["booking_link_unreadable", /linked to order \d+, which the system could not read/],
  ["system_failed", /could not (read|plan|decide)|replay threw|not decided when it arrived/],
  ["client_unknown", /no single client company/],
  ["booking_not_identified", /no order is named|could be the one meant|does not single out|of the client's orders have a shift on|the email names \d+ orders|existing bookings in one email|of the client's orders fit equally|orders are named, each holding the days asked/],
  ["booking_near_miss", /possibly the same booking/],
  ["booking_not_found", /\bR\d+ not found|belongs to another client|could not read|no shift on \d{4}-\d\d-\d\d/],
  ["venue_not_identified", /locations; which one|one call at \d+ venues|venues are named|is not an OnSinch venue|no OnSinch venue/],
  ["request_inconsistent", /the email says \d+ crew, the shift has|makes \d+, not the \d+ written|already has PO|changes in one email|position to re-time$/],
  ["request_unsupported", /not an operation the system performs|count other than adding|no words cancelling|no crew position|has no length|is not one|a crew change for \d\d:\d\d-\d\d:\d\d|which positions are theirs/],
  ["partly_booked", /part of this is already booked/],
  ["reading_unproven", /is not in the email|reads as .*, not |a value with no words quoted/],
  ["none_not_client", /not a client's email/],
  ["none_read_together", /read together with the later email/],
  ["none_already_booked", /already booked/],
  // A change whose ops are all already true: the reason is the line that would have been written.
  ["none_already_as_asked", /shift \d+: (times to \d\d:\d\d-\d\d:\d\d|\d+ crew in all)/],
  ["none_nothing_to_do", /nothing is booked on|no change asked for|left off: no order is named|nothing to/],
];

/** What a write booked without the client's words for it. */
export const DEFAULT_CODES: ReadonlyArray<readonly [string, RegExp]> = [
  ["default_start", /no start time written/],
  ["default_end", /no end time written/],
  ["default_trade_as_crew", /no live OnSinch profession, booked as Crew/],
  ["default_venue_most_used", /the one most of its shifts/],
  ["default_venue_same_name", /OnSinch venues are named .*; booked at/],
  ["default_venue_none", /no venue written, booked at No Location/],
];

/**
 * ONE test of "the system failed on its own part", for the owner's alert (process.ts): an earlier
 * copy tested `[verified, not verified]`, a shape no write ever had. The live week's 3 crew-chief
 * stops are one op each with status `mismatch` (red-team-B H6). A refusal by rule (signed-on crew,
 * workers on a position) is the client's need reaching ops, not a fault; the bot's own error on
 * OnSinch's page is a fault. Not booking_link_unreadable: a linked order the system cannot read is a
 * booking gone (above).
 */
export function systemFailureOf(decision: Decision, executed: ReadonlyArray<Pick<RunResult, "status" | "reasons">> | null | undefined): string | null {
  const ran = executed ?? [];
  if (ran.some((x) => x.status === "mismatch") || (ran.some((x) => x.status === "verified") && ran.some((x) => x.status !== "verified"))) return "a write stopped part-way";
  if (ran.some((x) => x.status === "blocked" && (x.reasons ?? []).some((r) => /^bot error|^form changed|did not open a new|is not in .*'s fill list|is not on order \d+'s builder|: \d+ inputs$|^company: \d+ options match/.test(r)))) return "the bot failed on OnSinch's page";
  // The plan named a contact OnSinch does not hold for the company: the system's own plan, not a rule (red-team-B2 B2-8).
  if (ran.some((x) => x.status === "blocked" && (x.reasons ?? []).some((r) => /is not a contact of /.test(r)))) return "a write used a contact OnSinch does not hold for its client";
  return coded(decision).code === "system_failed" ? "the system could not read, plan or decide an email" : null;
}

export const codeOfReason = (reason: string): string => REASON_CODES.find(([, re]) => re.test(reason))?.[0] ?? "other";

/**
 * WHAT A REASON MEANS IS READ HERE AND NOWHERE ELSE (addendum F52). The TV's reply test and the planner's
 * "ask the client" test each kept their own copy of these words, and both had already lost the venue
 * form this table holds. A reason reworded with its code here keeps every reader right.
 */
export const isReplyReason = (reason: string): boolean => codeOfReason(reason).startsWith("reply_");
/** A detail only the client can give: the client is asked, nobody can book it without them. */
export const isMissingDetail = (reason: string): boolean => codeOfReason(reason) === "reply_detail_missing";
/** Mail that is not a client's: one wording, written and matched from here. */
export const NOT_CLIENT = "not a client's email";

/** The decision with its code, and for a write the defaults it used. A decision already coded keeps its code. */
export function coded<D extends Decision>(d: D): D {
  if (d.code) return d;
  if (d.kind === "write") {
    const defaults = [...new Set(d.why.flatMap((w) => DEFAULT_CODES.filter(([, re]) => re.test(w)).map(([c]) => c)))];
    return { ...d, code: "write", ...(defaults.length ? { defaults } : {}) };
  }
  const said = d.kind === "handoff" ? d.reasons : [d.reason];
  const codes = said.map(codeOfReason);
  return { ...d, code: codes.find((c) => c !== "other") ?? "other" };
}
