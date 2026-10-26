// The 14 emails the two readers split on, settled by majority with a third blind reader (V, V2).
// Output: eval/reads/settled.csv, message_id,asks,source. Labels only.
import fs from "node:fs";
const csv = (p: string) => new Map(fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c] as [string, string[]]; }));
// Batch 5 is the prospective set (mail after the 10-22 copy), settled by V-v3 the same way.
const A = new Map([1, 2, 3, 4, 5].flatMap((n) => [...csv(`eval/reads/A-${n}.csv`)])), B = new Map([1, 2, 3, 4, 5].flatMap((n) => [...csv(`eval/reads/B-${n}.csv`)]));
const V = new Map([...csv("eval/reads/V-v.csv"), ...csv("eval/reads/V-v2.csv"), ...csv("eval/reads/V-v3.csv")]);
const strict = (a?: string) => /new_booking|change|cancel/.test(a ?? "");
const out = ["message_id,asks,days,crew,source"]; let n = 0, missing = 0;
for (const [id, a] of A) {
  const b = B.get(id)!; if (strict(a[1]) === strict(b[1])) continue;
  n++; const v = V.get(id); if (!v) { missing++; continue; }
  const win = strict(v[1]) === strict(a[1]) ? a : b;
  out.push([id, win[1], win[3], win[4], strict(v[1]) === strict(a[1]) ? "A+V" : "B+V"].join(","));
}
fs.writeFileSync("eval/reads/settled.csv", out.join("\n") + "\n");
console.log({ disagreements: n, settled: out.length - 1, without_third_reader: missing });
