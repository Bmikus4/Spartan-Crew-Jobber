// ============================================================================
// Merge what a new message said into what the thread already knew.
// ----------------------------------------------------------------------------
// Reading each message once means the model no longer sees the earlier messages, so
// the only record of them is the facts we stored. That makes one failure mode much
// worse than it was: a reply that answers narrowly ("yes, confirmed") and returns a
// thin facts object would, on a straight overwrite, delete the venue, the company and
// the dates that took four emails to establish.
//
// So the merge is conservative and lives in code, not in a prompt instruction. A
// prompt asking the model not to forget things holds until the next prompt edit; this
// holds always. It is the same COALESCE-merge rule the House of Hud tickets table uses
// for sparse follow-ups, for the same reason.
//
// What it will NOT do: reconcile a genuine contradiction. If the client moves a job
// from the 12th to the 19th, the new requests replace the old ones wholesale — that is
// the model's judgement to make, because only it saw the wording. The merge's job is
// narrower: never lose a field to silence.
// ============================================================================
import type { ConversationFacts } from "./types";

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Scalar fields, in the order they appear on ConversationFacts. */
const SCALARS = [
  "company_name", "contact_name", "contact_email", "contact_phone",
  "customer_reference", "location_text",
] as const;

export interface MergeReport {
  /** Fields the new message supplied that the thread did not have. */
  filled: string[];
  /** Fields the new message CHANGED — the interesting ones for a human reviewing. */
  changed: string[];
  /** Fields kept from prior state because the new answer was blank. */
  kept: string[];
  /** True when the new answer carried no work blocks and the prior ones were kept. */
  requestsKept: boolean;
}

/**
 * prior ∪ next, with next winning on every field it actually answered.
 *
 * Returns the merged facts and a report of what moved, because "the venue changed on
 * message 6" is exactly what a human reviewing a draft order needs told, and after this
 * merge it is no longer visible by diffing the mail.
 */
export function mergeFacts(
  prior: ConversationFacts | undefined,
  next: ConversationFacts | undefined
): { facts: ConversationFacts; report: MergeReport } {
  const p = prior ?? { requests: [] };
  const n = next ?? { requests: [] };
  const report: MergeReport = { filled: [], changed: [], kept: [], requestsKept: false };

  const merged: ConversationFacts = { requests: [] };
  for (const k of SCALARS) {
    const pv = p[k], nv = n[k];
    if (!blank(nv)) {
      merged[k] = nv;
      if (blank(pv)) report.filled.push(k);
      else if (String(pv).trim() !== String(nv).trim()) report.changed.push(k);
    } else if (!blank(pv)) {
      merged[k] = pv;
      report.kept.push(k);
    }
  }

  // Work blocks are replaced as a set, not merged item by item: there is no stable id on
  // a request, so pairing "the 12th, 4 crew" against "the 19th, 4 crew" would be a guess
  // about whether the client moved the job or added a second day. An EMPTY answer,
  // though, is silence rather than a decision, so the prior blocks stand.
  const nextRequests = Array.isArray(n.requests) ? n.requests.filter((r) => r && Object.keys(r).length) : [];
  if (nextRequests.length) {
    merged.requests = nextRequests;
    const before = JSON.stringify(p.requests ?? []);
    if (before !== JSON.stringify(nextRequests) && (p.requests ?? []).length) report.changed.push("requests");
    else if (!(p.requests ?? []).length) report.filled.push("requests");
  } else {
    merged.requests = p.requests ?? [];
    report.requestsKept = (merged.requests ?? []).length > 0;
  }

  return { facts: merged, report };
}

/** One line for the ticket notes, or "" when the message changed nothing. */
export function describeMerge(r: MergeReport): string {
  const bits: string[] = [];
  if (r.changed.length) bits.push(`changed ${r.changed.join(", ")}`);
  if (r.filled.length) bits.push(`filled ${r.filled.join(", ")}`);
  return bits.length ? `this message ${bits.join("; ")}` : "";
}
