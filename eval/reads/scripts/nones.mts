import fs from "node:fs";
import { coded } from "../../../app/lib/v2/reasons.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const rows = fs.readFileSync(".tmp-v2/reads/joined.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));
const tax = new Map<string, string>();
for (const line of fs.readFileSync("eval/failure-taxonomy.md", "utf8").split("\n")) { const c = line.split("|").map((s) => s.trim()); if (/^1a[0-9a-f]{14}$/.test(c[1] ?? "") && c.length >= 10) tax.set(c[1], c[8]); }
const by: Record<string, number> = {}; const list: Record<string, string[]> = {};
for (const [id, sys, , , , , strict] of rows) {
  if (strict !== "inquiry" || sys !== "none") continue;
  const d: any = coded((dec.get(id) as any).decision);
  const k = `${d.code}${tax.has(id) ? " [tax:" + tax.get(id) + "]" : ""}`;
  by[k] = (by[k] ?? 0) + 1; (list[d.code] ??= []).push(id);
}
console.log(Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1])));
fs.writeFileSync(".tmp-v2/reads/none-inquiries.json", JSON.stringify(list, null, 1));
