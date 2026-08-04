// ============================================================================
// A cheap model answers; an expensive one is asked again only when it should be.
// ----------------------------------------------------------------------------
// Input dominates this bill and a small model's input is 16.7x cheaper
// ($0.30/Mtok against $5.00), so the largest remaining saving is not to send less
// but to send it somewhere cheaper. The obvious objection is the right one: a
// cheaper model reading a booking wrong costs far more than the tokens it saved.
//
// So escalation is DETERMINISTIC. Not the cheap model's own confidence — a model
// that misreads a shift is usually confident about it — but code checking the answer
// against the words on the page:
//
//   1. it called the thread a job and produced no usable work block
//   2. the deterministic parser CONTRADICTS its dates, times or crew
//   3. it called the thread junk while the text plainly states a date AND a crew size
//   4. it produced a job with neither a company nor a venue
//
// Each is a case where the answer is checkably suspect, and each is testable without
// a provider. When one fires, the strong model is asked the same question and its
// answer wins outright — the cheap answer is discarded, not merged, because two
// readings of one email blended together belong to neither.
//
// OFF unless SPARTAN_MODEL_CHEAP is set. Turning it on changes which model reads
// Spartan's mail, and that judgement should not arrive as a side effect of a deploy.
// Nothing here has been verified against a live call: the escalation RATE is the one
// figure that needs a paid run to establish, and the account is capped. The triggers
// are proven offline; the rate is not, and is reported by the counters rather than
// assumed.
// ============================================================================
import type { Reasoner, ClassifyResult } from "./reason";
import type { ConversationFacts, ThreadMessage } from "./types";
import { reconcileRequests } from "./parseWork";

export interface TierReport {
  cheapCalls: number;
  escalations: number;
  reasons: Record<string, number>;
}

type Combined = ClassifyResult & { facts: ConversationFacts };

/**
 * Why this answer cannot be trusted, or null when it can.
 * Exported for its own tests: the whole safety argument rests on these four rules.
 */
export function escalationReason(
  latest: ThreadMessage,
  result: Combined
): string | null {
  const isJob = result.classification === "new-job" || result.classification === "update";
  const requests = result.facts?.requests ?? [];
  const text = `${latest.subject}\n${latest.body}`;
  const ref = new Date(Date.parse(latest.date_iso) || Date.now());

  const usable = requests.filter((r) => Number(r.size) > 0 && r.date);
  if (isJob && !usable.length) return "job with no usable work block";

  const { report } = reconcileRequests(text, requests, ref);
  if (report.conflicts.length) return `text contradicts the model (${report.conflicts.length})`;

  if (!isJob) {
    // The study's expensive failure: 20 of 21 discarded threads that a human booked
    // anyway. A rejection is worth a second opinion when the page says otherwise.
    const { requests: recovered } = reconcileRequests(text, [], ref);
    if (recovered.length) return "rejected, but the text states a date and a crew size";
  }

  if (isJob && !result.facts?.company_name && !result.facts?.location_text) {
    return "job with neither company nor venue";
  }
  return null;
}

/**
 * Wrap two reasoners. Everything that is not the combined classify+extract call goes
 * straight to the strong model: composeReply writes prose in Spartan's voice that a
 * client reads, and there is no deterministic check on prose, so there is no safe way
 * to escalate it after the fact.
 */
export function tieredReasoner(
  cheap: Reasoner,
  strong: Reasoner,
  opts: { onEscalate?: (reason: string) => void } = {}
): Reasoner & { tiers: () => TierReport } {
  const state: TierReport = { cheapCalls: 0, escalations: 0, reasons: {} };

  const escalate = (reason: string) => {
    state.escalations++;
    state.reasons[reason] = (state.reasons[reason] ?? 0) + 1;
    opts.onEscalate?.(reason);
  };

  return {
    tiers: () => ({ ...state, reasons: { ...state.reasons } }),

    classifyAndExtract: cheap.classifyAndExtract
      ? async (latest, history, priorOrderExists) => {
          state.cheapCalls++;
          const first = await cheap.classifyAndExtract!(latest, history, priorOrderExists);
          const reason = escalationReason(latest, first);
          if (!reason) return first;
          escalate(reason);
          return strong.classifyAndExtract
            ? strong.classifyAndExtract(latest, history, priorOrderExists)
            : {
                ...(await strong.classify(latest, history, priorOrderExists)),
                facts: await strong.extractFacts(latest, history),
              };
        }
      : undefined,

    classifyAndExtractIncremental: cheap.classifyAndExtractIncremental
      ? async (latest, priorFacts, priorCls, priorOrderExists) => {
          state.cheapCalls++;
          const first = await cheap.classifyAndExtractIncremental!(latest, priorFacts, priorCls, priorOrderExists);
          const reason = escalationReason(latest, first);
          if (!reason) return first;
          escalate(reason);
          return strong.classifyAndExtractIncremental
            ? strong.classifyAndExtractIncremental(latest, priorFacts, priorCls, priorOrderExists)
            : strong.classifyAndExtract
              ? strong.classifyAndExtract(latest, [], priorOrderExists)
              : first;
        }
      : undefined,

    classify: (...a) => strong.classify(...a),
    extractFacts: (...a) => strong.extractFacts(...a),
    composeReply: (...a) => strong.composeReply(...a),
  };
}
