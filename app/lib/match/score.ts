// ============================================================================
// The job matcher's score: one weight in bits per level of each family of evidence, fitted from
// the gold set (scripts/gold/weights.mts writes weights.json), summed per candidate, and set
// against "none of these" (a new job, or not about a job) as one more option.
// ----------------------------------------------------------------------------
// Fellegi-Sunter: w = log2(m / u), m the share of true links showing that level, u the share of
// other candidates showing it. A null level adds 0: absent evidence is not evidence against.
// u for the time, coverage and size families depends on how many of the client's orders hold an
// asked day (density): "same day" separates nothing for a client with eight jobs that day, and
// everything for a client with one. "None of these" scores by whether the email asks for new
// work, because a booking is often for a job not yet made and a change almost never is.
// ============================================================================
import type { Family, Match } from "./match";

export type LevelWeight = { w: number; m: number; u: number; n1: number; n0: number };
export type Weights = {
  version: string;
  fitted_on: string;
  /** Families whose u is split by density bucket. */
  stratified: Family[];
  levels: Partial<Record<Family, Record<string, Record<string, LevelWeight>>>>; // family -> stratum -> level
  /** Bits for "none of these", by whether the email asks for new work. */
  none: { new_work: number; other: number };
};

export const densityBucket = (d: number) => (d <= 1 ? "1" : d <= 3 ? "2-3" : "4+");

export type Scored = { order_id: number; bits: number; parts: Partial<Record<Family, number>>; p: number };
export type Scoring = { candidates: Scored[]; none: { bits: number; p: number }; top: { order_id: number | null; p: number } };

export function score(m: Pick<Match, "candidates" | "context">, W: Weights): Scoring {
  const stratum = densityBucket(m.context.density);
  const out: Scored[] = m.candidates.map((c) => {
    const parts: Partial<Record<Family, number>> = {};
    let bits = 0;
    for (const [f, levels] of Object.entries(W.levels) as [Family, Record<string, Record<string, LevelWeight>>][]) {
      const level = c.cmp[f];
      if (level == null) continue;
      const table = levels[W.stratified.includes(f) ? stratum : "all"] ?? levels.all;
      const w = table?.[level]?.w ?? 0;
      parts[f] = w;
      bits += w;
    }
    return { order_id: c.order_id, bits, parts, p: 0 };
  });
  const noneBits = m.context.asks_new ? W.none.new_work : W.none.other;
  const hi = Math.max(noneBits, ...out.map((c) => c.bits));
  const z = 2 ** (noneBits - hi) + out.reduce((a, c) => a + 2 ** (c.bits - hi), 0);
  for (const c of out) c.p = 2 ** (c.bits - hi) / z;
  out.sort((a, b) => b.bits - a.bits);
  const none = { bits: noneBits, p: 2 ** (noneBits - hi) / z };
  const top = out.length && out[0].p > none.p ? { order_id: out[0].order_id, p: out[0].p } : { order_id: null, p: none.p };
  return { candidates: out, none, top };
}
