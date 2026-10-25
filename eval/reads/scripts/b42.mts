// The owner's B42 (10-15): "Quotes that list shifts become orders". A quote request counts as an inquiry when
// either reader recorded a day AND a crew count for it. Counts only.
import fs from "node:fs";
const csv = (p: string) => new Map(fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c] as [string, string[]]; }));
const A = new Map([...csv("eval/reads/A-1.csv"), ...csv("eval/reads/A-2.csv")]), B = new Map([...csv("eval/reads/B-1.csv"), ...csv("eval/reads/B-2.csv")]);
const joined = fs.readFileSync(".tmp-v2/reads/joined.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const has = (a: string | undefined, k: string) => (a ?? "").split("+").includes(k);
const out: Record<string, Record<string, number>> = { quote_with_shifts: {}, quote_without: {} };
for (const [id, sys] of joined) {
  const a = A.get(id)!, b = B.get(id)!;
  const quoteOnly = has(a[1], "quote_or_availability") && has(b[1], "quote_or_availability") && !/new_booking|change|cancel/.test(a[1] + b[1]);
  if (!quoteOnly) continue;
  const shifts = (a[3] && a[4]) || (b[3] && b[4]);
  const k = shifts ? "quote_with_shifts" : "quote_without";
  out[k][sys] = (out[k][sys] ?? 0) + 1;
}
console.log(out);
