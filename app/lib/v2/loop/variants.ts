// ============================================================================
// Both versions of a rule, planned on the same email (ADDENDUM §12.3, DECISIONS O11).
// ----------------------------------------------------------------------------
// The owner, 28 Oct: "Where it's cheap, shadow-score both versions of a rule on the same emails rather than relying
// only on before/after days", and "record the without-the-rule plan for every rule-based hand-off". After an email
// is decided at intake, the planner runs again once per rule that touched it, with that rule switched: no model
// call, and the OnSinch reads are the decision's own (plan.ts shareReads). The loop judges each variant against
// what staff did, beside the decision. The decision itself is never changed: a variant that throws is kept as its
// error, and a variant equal to the decision is kept as "same", so how often a rule matters is counted too.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Decision, PlanOpts } from "../interpret/plan";
import type { Interpretation } from "../interpret/interpret";
import { canonical } from "../bot/ops";
import { ensureSchema } from "../../migrations";

export type VariantName = "no_lead" | "short_call_2h" | "acceptance_draft" | "start_keeps_end" | "start_keeps_length";
export type Variant = { name: VariantName; decision: Decision | null; same: boolean; error: string | null };

/** The rule versions this decision and reading can tell apart, each as the planner options that switch it. */
export function variantsFor(decision: Decision, i: Interpretation, opts: PlanOpts): Array<{ name: VariantName; opts: PlanOpts }> {
  const code = (decision as { code?: string }).code;
  const out: Array<{ name: VariantName; opts: PlanOpts }> = [];
  if (code === "policy_lead_days") out.push({ name: "no_lead", opts: { ...opts, leadDays: null } });
  if (code === "policy_short_call") out.push({ name: "short_call_2h", opts: { ...opts, shortCall: "default" } });
  if (code === "policy_confirmed_proposal") out.push({ name: "acceptance_draft", opts: { ...opts, acceptance: "draft" } });
  // A new start alone is where the two readings of a moved start part (O7 against V4).
  if (i.requests.some((r) => r.action === "change_times" && !!r.start && !r.end && !r.duration)) {
    const flip = opts.movedStart === "end" ? "length" : "end";
    out.push({ name: `start_keeps_${flip}`, opts: { ...opts, movedStart: flip } });
  }
  return out;
}

export async function planVariants(replan: (opts: PlanOpts) => Promise<Decision>, decision: Decision, i: Interpretation, opts: PlanOpts): Promise<Variant[]> {
  const out: Variant[] = [];
  for (const v of variantsFor(decision, i, opts)) {
    try {
      const d = await replan(v.opts);
      const same = canonical(d) === canonical(decision);
      out.push({ name: v.name, decision: same ? null : d, same, error: null });
    } catch (e) {
      out.push({ name: v.name, decision: null, same: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  }
  return out;
}

/** One row per variant; deciding an email again replaces its variants with the new ones. */
export async function recordVariants(sql: NeonQueryFunction<false, false>, message_id: string, vs: Variant[], code_version: string | null): Promise<void> {
  if (!vs.length) return;
  await ensureSchema(sql);
  const rows = vs.map((v) => ({ message_id, variant: v.name, decision: v.decision, same: v.same, error: v.error, code_version }));
  await sql`INSERT INTO v2_variants (message_id, variant, decision, same, error, code_version)
    SELECT message_id, variant, decision, same, error, code_version
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(message_id TEXT, variant TEXT, decision JSONB, same BOOLEAN, error TEXT, code_version TEXT)
    ON CONFLICT (message_id, variant) DO UPDATE SET decision = EXCLUDED.decision, same = EXCLUDED.same, error = EXCLUDED.error,
      code_version = EXCLUDED.code_version, created_at = now()`;
}
