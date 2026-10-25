// For the 26 no-reply requests: resolve a company by the production sender rule, then look for a staff
// act on that company's orders within 72 h whose order has a shift on a day the readers named. Counts and ids only.
import fs from "node:fs";
import { matchCompanyBySender } from "../../../app/lib/engine/resolve.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const list: string[] = J(".tmp-v2/reads/none-inquiries.json").none_not_client;
const msgs = new Map(J(".tmp-data/gold/messages.json").map((m: any) => [m.message_id, m]));
const companies = J(".tmp-data/gold/companies.json");
const acts: any[] = J(".tmp-data/week-truth-acts.json");
const orders = new Map(J(".tmp-data/week-truth-orders.json").map((o: any) => [Number(o.id), o]));
const gold = new Map(J(".tmp-data/gold/orders.json").map((o: any) => [Number(o.id), o]));
const csv = (p: string) => new Map(fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c]; }));
const A = new Map([...csv("eval/reads/A-1.csv"), ...csv("eval/reads/A-2.csv")]), B = new Map([...csv("eval/reads/B-1.csv"), ...csv("eval/reads/B-2.csv")]);
const addr = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();
const daysOf = (o: any) => { const out = new Set<string>(); for (const j of [].concat(o?.Job ?? [])) for (const t of [].concat((j as any)?.SlotTeam ?? [])) { const b = String((t as any).beginning ?? (t as any).start ?? "").slice(0, 10); if (b) out.add(b); } return out; };
let resolved = 0, acted = 0, domains = new Set<string>(); const rows: string[] = [];
for (const id of list) {
  const m: any = msgs.get(id); const from = addr(String(m.from_address)); domains.add(from.split("@")[1]);
  const co = matchCompanyBySender(from, companies);
  const days = new Set([...(A.get(id)?.[3] ?? "").split(";"), ...(B.get(id)?.[3] ?? "").split(";")].filter(Boolean));
  const t0 = Date.parse(m.date_iso);
  const hits = co ? acts.filter((a) => Number(a.company_id) === Number(co) && a.by !== 2257 && String(a.by) !== "2257" && Date.parse(a.at) >= t0 && Date.parse(a.at) <= t0 + 72 * 3600e3) : [];
  const onDay = hits.filter((a) => { const o = orders.get(Number(a.order_id)) ?? gold.get(Number(a.order_id)); const ds = daysOf(o); return [...days].some((d) => ds.has(d)); });
  if (co) resolved++; if (onDay.length) acted++;
  rows.push(`${id} company=${co ?? "none"} days=${days.size} staff_acts_72h=${hits.length} on_named_day=${onDay.length} first=${onDay[0] ? onDay[0].what : ""}`);
}
console.log({ emails: list.length, sender_domains: domains.size, resolved_to_company: resolved, staff_act_on_named_day_within_72h: acted });
console.log(rows.join("\n"));
