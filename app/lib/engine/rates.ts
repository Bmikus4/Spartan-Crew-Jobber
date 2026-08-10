// ============================================================================
// rates — resolve a company's rate card (Job.pricelist_category_id). I1: an
// order NEVER goes out without an explicit card (OnSinch silently assigns a
// default, e.g. 245, otherwise). Order of truth:
//   1. seeded lookup (Phase B rate_cards table) — injected, so the engine stays
//      DB-agnostic / offline-testable;
//   2. else a live A4 scan of the company's recent orders (0.5^rank weighting,
//      accept top card iff >=70% share);
//   3. else null -> caller routes to needs-human.
// ============================================================================
import type { OnsinchClient } from "./onsinch";

export interface RateDeps {
  onsinch: OnsinchClient;
  seededRateCard?: (companyId: number) => Promise<number | null>;
  /**
   * The card to fall back on when a company has no history to derive one from —
   * a brand-new client, or an existing one whose recent orders are genuinely
   * mixed. Settings.default_rate_card; 0 or undefined means no fallback and the
   * thread holds, which is the behaviour before this existed.
   */
  defaultCard?: number | null;
}

export interface RateResult {
  card: number | null;
  /**
   * WHERE the number came from, which decides how much it can be trusted.
   * "default" is a house standard applied to a client nobody has priced yet, so
   * it is never auto-written — see pipeline.ts.
   */
  source: "seeded" | "history" | "default" | "none";
}

export async function resolveRateCard(company_id: number, deps: RateDeps): Promise<RateResult> {
  if (deps.seededRateCard) {
    const c = await deps.seededRateCard(company_id);
    if (Number.isInteger(c as number) && (c as number) > 0) return { card: c as number, source: "seeded" };
  }
  const orders = await deps.onsinch.companyOrdersWithJob(company_id);
  const rows = orders
    .map((o) => {
      const jobs = Array.isArray(o?.Job) ? o.Job : o?.Job ? [o.Job] : [];
      const card = jobs.map((j: any) => j?.pricelist_category_id).find((x: any) => x != null) ?? null;
      return { id: o?.id ?? 0, card: card as number | null };
    })
    .sort((a, b) => b.id - a.id)
    .slice(0, 20);

  const weight = new Map<number, number>();
  let total = 0;
  rows.forEach((r, rank) => {
    if (r.card == null) return;
    const w = Math.pow(0.5, rank);
    weight.set(r.card, (weight.get(r.card) ?? 0) + w);
    total += w;
  });
  /** The house standard, for a client with no history of their own. */
  const fallback = (): RateResult =>
    Number.isInteger(deps.defaultCard as number) && (deps.defaultCard as number) > 0
      ? { card: deps.defaultCard as number, source: "default" }
      : { card: null, source: "none" };

  if (total === 0) return fallback();
  let top = -1;
  let card: number | null = null;
  for (const [c, v] of weight) if (v > top) { top = v; card = c; }
  // A client whose own recent orders agree is priced by that agreement, whatever
  // the house standard is. The fallback is for silence, not for disagreement being
  // overruled - but genuinely mixed history is silence about what to charge NEXT,
  // so it takes the standard too rather than stranding the job.
  return top / total >= 0.7 ? { card, source: "history" } : fallback();
}
