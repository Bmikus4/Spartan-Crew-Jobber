// The harness's project-agnostic vocabulary. An adapter supplies cases and scores them; the
// core runs, records, checks isolation and reports. Nothing here knows about Spartan.

/** Where a case's expected answer came from, strongest first. Only the first two are ground truth. */
export type Authority = "human-reviewed" | "operator-approved" | "ops-action" | "synthetic-by-construction" | "system-derived";

export type Case<I = unknown, E = unknown> = {
  id: string;
  /** Branch id from 01-discovery.md section 2.2. */
  branch: string;
  /** Prompt rule ids (P1.R*) this case exercises. */
  rules: string[];
  source: Authority;
  input: I;
  expected: E;
};

/**
 * ONE OBSERVATION IS 1 OR 0 (Ben, 2026-10-10). A node's accuracy is the count of 1s over n;
 * there are no partial credits and no graded scores anywhere in the harness.
 */
export type Observation = { case_id: string; branch: string; node: string; ok: 0 | 1; detail?: string };

/** Invariants are hard gates, reported apart from accuracy and never averaged into it. */
export const INVARIANT = "inv.";

export type CaseResult = { case_id: string; branch: string; observations: Observation[]; ms: number; cost_usd: number; summary: string };
