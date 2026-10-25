import fs from "node:fs";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const joined = fs.readFileSync(".tmp-v2/reads/joined.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const cands = new Map(J(".tmp-v2/reads/cands.json").map((c: any) => [c.id, c]));
const csv = (p: string) => fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c] as [string, string[]]; });
const A = new Map([...csv("eval/reads/A-1.csv"), ...csv("eval/reads/A-2.csv")]), B = new Map([...csv("eval/reads/B-1.csv"), ...csv("eval/reads/B-2.csv")]);
const has = (a: string | undefined, k: string) => (a ?? "").split("+").includes(k);
const unverified = new Set(["1a139d57839581af", "1a13f6fc5782f7c3", "1a1401fd187dd300", "1a15344a323ab432"]);
const nothingToDo = new Set(J(".tmp-v2/reads/none-inquiries.json").none_nothing_to_do);
const out = ["message_id,why_listed,system,asks_A,asks_B,sure_A,sure_B,staff_acts_on_named_day,first_reply_from_us_h"];
const n: Record<string, number> = {};
for (const [id, sys, , , , , strict] of joined) {
  const a = A.get(id)!, b = B.get(id)!;
  const quoteOnly = has(a[1], "quote_or_availability") && has(b[1], "quote_or_availability") && !/new_booking|change|cancel/.test(a[1] + b[1]);
  let why = "";
  if (strict === "disputed") why = "readers disagree on booking work";
  else if (strict === "inquiry" && sys === "none" && nothingToDo.has(id)) why = "silent: none, model read no change";
  else if (strict === "inquiry" && sys === "needs-reply") why = "silent: needs-reply, shown nowhere";
  else if (quoteOnly && (sys === "none" || sys === "needs-reply")) why = `quote request, ${sys}`;
  else if (unverified.has(id)) why = "already booked per system, order absent from snapshot";
  if (!why) continue;
  n[why] = (n[why] ?? 0) + 1;
  const c: any = cands.get(id);
  out.push([id, why, sys, a[1], b[1], a[5], b[5], c ? c.on_named_day : "", c?.reply_h ?? ""].join(","));
}
fs.writeFileSync("eval/reads/adjudicate.csv", out.join("\n") + "\n");
console.log(n, out.length - 1);
