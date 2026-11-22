// STAFF PAY IS NEVER STORED (O46; Stop 2 deletion D9). OnSinch puts seven wage fields on every Slot of an order body
// (wage_h, wage_fix, total_wage and their totals and percentages: 22 Nov, on 3,178 of 3,263 stored orders and 12,264
// of 12,293 kept bodies), and no code reads them. Every order body is passed through stripPay before it is written.
//
// The stems are the data home's (D:/spartan-data/tools/lib.mjs PAY_KEY), matched on key names at any depth, so the
// two stores never disagree on what counts as pay. A stem, not a list of the seven keys: a field OnSinch adds later
// is caught without anyone noticing it arrived. Never apply this to a body that is sent back to OnSinch, where a
// missing wage field could be saved as a blank one.

export const PAY_KEY = /wage|salary|payroll|(^|_)penalt|wallet|payment_?method|bank_?account|^(iban|swift|bic)$/i;

/** A copy with every pay key removed, at any depth. Not-object input comes back as it was. */
export function stripPay<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripPay) as T;
  if (!v || typeof v !== "object" || v instanceof Date) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!PAY_KEY.test(k)) out[k] = stripPay(x);
  return out as T;
}

/** Whether any key at any depth is pay: what the drain and the tests look for. */
export function holdsPay(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(holdsPay);
  if (!v || typeof v !== "object") return false;
  return Object.entries(v as Record<string, unknown>).some(([k, x]) => PAY_KEY.test(k) || holdsPay(x));
}
