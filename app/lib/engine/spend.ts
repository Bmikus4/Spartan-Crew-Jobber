// ============================================================================
// A ceiling on model calls, enforced in code rather than remembered.
// ----------------------------------------------------------------------------
// On 2026-08-03 a corpus labelling script spent $57 in one night and took the
// OpenRouter key to its $150 cap. Nothing in the code stopped it: a script that
// loops over 5,835 threads calling a model is indistinguishable, to the process,
// from a script that handles one email.
//
// So the ceiling is not a convention. Every Reasoner passes through here, counts its
// own calls, and REFUSES once past the limit. The default is deliberately small
// enough to be useless for a batch: anything wanting to process a corpus has to say
// so out loud, with a number, and that number appears in the error when it is hit.
//
//   SPARTAN_MAX_MODEL_CALLS   ceiling for this process (default 25)
//   SPARTAN_ALLOW_BULK=1      required before the ceiling may exceed 100
//
// The estimate it prints is not a bill. It is char-count arithmetic at list price —
// enough to answer "is this about to cost cents or hundreds?" before it does.
// ============================================================================
import type { Reasoner } from "./reason";

/** Raised instead of making the call that would breach the ceiling. */
export class SpendCeilingError extends Error {
  constructor(calls: number, limit: number, label: string, estUsd: number) {
    super(
      `Model-call ceiling reached: ${label} has made ${calls} calls, limit ${limit} ` +
        `(~$${estUsd.toFixed(2)} estimated so far). ` +
        `This is a guard against a batch quietly spending real money — the last one cost $57. ` +
        `To run a bulk pass deliberately: SPARTAN_ALLOW_BULK=1 SPARTAN_MAX_MODEL_CALLS=<n>. ` +
        `Test against fixtures instead if you only need to know the code works.`
    );
    this.name = "SpendCeilingError";
  }
}

export interface SpendReport {
  calls: number;
  inputChars: number;
  outputCharsEstimated: number;
  estimatedUsd: number;
}

/** List price per million tokens. Kept beside the guard so the estimate is auditable. */
const PRICES: Record<string, { in: number; out: number }> = {
  "anthropic/claude-opus-4.6": { in: 5.0, out: 25.0 },
  "anthropic/claude-opus-4.8": { in: 5.0, out: 25.0 },
  "anthropic/claude-sonnet-4": { in: 3.0, out: 15.0 },
  "google/gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.60 },
};
const DEFAULT_PRICE = { in: 5.0, out: 25.0 };   // assume the expensive tier, never the cheap one

// MEASURED from 532 real label rows: a combined reply averages 429 characters of fields.
const OUTPUT_CHARS_TYPICAL = 429 * 1.25;

export function priceOf(model: string) {
  return PRICES[model] ?? DEFAULT_PRICE;
}

export function ceilingFromEnv(): number {
  const raw = Number(process.env.SPARTAN_MAX_MODEL_CALLS || 0);
  const asked = Number.isFinite(raw) && raw > 0 ? raw : 25;
  // A high ceiling without the explicit bulk opt-in is almost always someone raising a
  // number to make an error go away. Clamp it and say so at the point of use.
  if (asked > 100 && process.env.SPARTAN_ALLOW_BULK !== "1") return 100;
  return asked;
}

/**
 * Wrap a Reasoner so every call is counted and the ceiling is enforced.
 *
 * Counting happens BEFORE the call, so a breach costs nothing. The report is live —
 * read it at any point, including from a catch block, to say what was spent.
 */
export function guardReasoner(
  inner: Reasoner,
  opts: { model: string; label?: string; limit?: number; onCall?: (r: SpendReport) => void } = { model: "unknown" }
): Reasoner & { spend: () => SpendReport } {
  const limit = opts.limit ?? ceilingFromEnv();
  const label = opts.label ?? "reasoner";
  const price = priceOf(opts.model);
  const state = { calls: 0, inputChars: 0 };

  const report = (): SpendReport => {
    const inTok = state.inputChars / 4;
    const outTok = (state.calls * OUTPUT_CHARS_TYPICAL) / 4;
    return {
      calls: state.calls,
      inputChars: state.inputChars,
      outputCharsEstimated: Math.round(state.calls * OUTPUT_CHARS_TYPICAL),
      estimatedUsd: (inTok / 1e6) * price.in + (outTok / 1e6) * price.out,
    };
  };

  const charge = (chars: number) => {
    if (state.calls >= limit) throw new SpendCeilingError(state.calls, limit, label, report().estimatedUsd);
    state.calls++;
    state.inputChars += chars;
    opts.onCall?.(report());
  };

  // The thread text the inner reasoner will build. Counted here rather than reported by
  // the adapter so the guard cannot be bypassed by a new method that forgets to report.
  const size = (latest: { body?: string; subject?: string }, history: Array<{ body?: string }> = []) =>
    (latest.body?.length ?? 0) + (latest.subject?.length ?? 0) +
    history.reduce((n, m) => n + (m.body?.length ?? 0), 0);

  return {
    spend: report,
    classifyAndExtract: inner.classifyAndExtract
      ? (latest, history, prior) => { charge(size(latest, history)); return inner.classifyAndExtract!(latest, history, prior); }
      : undefined,
    // The incremental call is charged on the new message plus the serialised facts — the
    // whole point is that it does NOT carry the history, and the estimate has to show that.
    classifyAndExtractIncremental: inner.classifyAndExtractIncremental
      ? (latest, priorFacts, priorCls, priorOrder) => {
          charge(size(latest) + JSON.stringify(priorFacts ?? {}).length);
          return inner.classifyAndExtractIncremental!(latest, priorFacts, priorCls, priorOrder);
        }
      : undefined,
    classify: (latest, history, prior) => { charge(size(latest, history)); return inner.classify(latest, history, prior); },
    extractFacts: (latest, history) => { charge(size(latest, history)); return inner.extractFacts(latest, history); },
    composeReply: (latest, history, cls) => { charge(size(latest, history)); return inner.composeReply(latest, history, cls); },
  };
}
