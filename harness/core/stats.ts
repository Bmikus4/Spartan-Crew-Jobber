/**
 * The 95% Wilson score interval for k successes in n. Chosen over the normal approximation
 * because it stays inside [0, 1] and is honest at n = 10 and at 10 of 10, which is where most
 * branches of a 500-case run sit.
 */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - r) / d), hi: Math.min(1, (c + r) / d) };
}

export const pct = (v: number) => `${(100 * v).toFixed(1)}%`;

/** Coverage depth, as the prompt names it. */
export const depth = (n: number) => (n >= 300 ? "full" : n >= 30 ? `partial (${n})` : n > 0 ? `thin (${n})` : "untested");
