// Third blind reader V against the A/B consensus on a 10% sample (40 agreements, 6 disagreements).
import fs from "node:fs";
const csv = (p: string) => new Map(fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c] as [string, string[]]; }));
const V = csv("eval/reads/V-v.csv");
const A = new Map([...csv("eval/reads/A-1.csv"), ...csv("eval/reads/A-2.csv")]), B = new Map([...csv("eval/reads/B-1.csv"), ...csv("eval/reads/B-2.csv")]);
const strict = (a?: string) => /new_booking|change|cancel/.test(a ?? "");
let agreeN = 0, agreeHit = 0, disN = 0, disA = 0, disB = 0, dayN = 0, daySame = 0; const misses: string[] = [];
for (const [id, v] of V) {
  const a = A.get(id)!, b = B.get(id)!;
  if (strict(a[1]) === strict(b[1])) { agreeN++; if (strict(v[1]) === strict(a[1])) agreeHit++; else misses.push(`${id} AB=${strict(a[1]) ? "work" : "not"} V=${v[1]}`);
    if (strict(a[1]) && strict(v[1])) { dayN++; if ((v[3] ?? "") === (a[3] ?? "")) daySame++; } }
  else { disN++; if (strict(v[1]) === strict(a[1])) disA++; else disB++; }
}
console.log({ sample: V.size, agreements: agreeN, V_matches_consensus: agreeHit, V_mismatches: misses, disagreements: disN, V_sides_with_A: disA, V_sides_with_B: disB, days_compared: dayN, days_same: daySame });
