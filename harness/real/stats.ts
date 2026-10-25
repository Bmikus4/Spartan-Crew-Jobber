// ============================================================================
// Exact (Clopper-Pearson) intervals. The live-week figures were stated with these
// (eval/reads/scripts/cp.mjs); the harness must print the same interval for the same k/n,
// so this is the same beta-quantile bisection, not the Wilson interval in harness/core/stats.ts.
// ============================================================================
function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const k of c) s += k / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
const lbeta = (a: number, b: number) => lgamma(a) + lgamma(b) - lgamma(a + b);
function cf(x: number, a: number, b: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; d = 1 / d; c = 1 + aa / c; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; d = 1 / d; c = 1 + aa / c;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b));
  return x < (a + 1) / (a + b + 2) ? (bt * cf(x, a, b)) / a : 1 - (bt * cf(1 - x, b, a)) / b;
}
function quantile(p: number, a: number, b: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (ibeta(m, a, b) < p) lo = m; else hi = m; }
  return lo;
}

/** The 95% exact interval for k of n, as fractions. */
export function exact(k: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  return { lo: k === 0 ? 0 : quantile(0.025, k, n - k + 1), hi: k === n ? 1 : quantile(0.975, k + 1, n - k) };
}

/** "74/90 = 82.2% (CI 72.7-89.5)". */
export function rate(k: number, n: number, dp = 1): string {
  if (!n) return `${k}/0 (no denominator)`;
  const ci = exact(k, n);
  return `${k}/${n} = ${((100 * k) / n).toFixed(dp)}% (CI ${(100 * ci.lo).toFixed(dp)}-${(100 * ci.hi).toFixed(dp)})`;
}

/** Cohen's kappa for two raters on a yes/no question. */
export function kappa(both: number, neither: number, aOnly: number, bOnly: number): number {
  const n = both + neither + aOnly + bOnly, po = (both + neither) / n;
  const pa = (both + aOnly) / n, pb = (both + bOnly) / n, pe = pa * pb + (1 - pa) * (1 - pb);
  return (po - pe) / (1 - pe);
}

/** Nearest-rank percentile of numbers. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
