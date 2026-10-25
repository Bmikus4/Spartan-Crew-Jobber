import fs from "node:fs";
import { utcToLondon } from "../../../app/lib/v2/bot/ops.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const list = J(".tmp-v2/reads/none-inquiries.json");
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));
const ordersByNo = new Map<string, any>(); for (const f of [".tmp-data/gold/orders.json", ".tmp-data/week-truth-orders.json"]) for (const o of J(f)) ordersByNo.set(String(o.number), o);
const csv = (p: string) => fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c] as [string, string[]]; });
const A = new Map([...csv("eval/reads/A-1.csv"), ...csv("eval/reads/A-2.csv")]), B = new Map([...csv("eval/reads/B-1.csv"), ...csv("eval/reads/B-2.csv")]);
const days = (o: any) => { const s = new Set<string>(); for (const j of [].concat(o?.Job ?? [])) for (const t of [].concat((j as any)?.SlotTeam ?? [])) for (const sl of [].concat((t as any)?.Slot ?? [])) if ((sl as any).beginning && !(sl as any).cancelled) s.add(utcToLondon(String((sl as any).beginning)).date); return s; };
for (const code of ["other"]) for (const id of list[code] ?? []) console.log(id, "reason:", String((dec.get(id) as any).decision.reason ?? (dec.get(id) as any).decision.reasons).replace(/R\d+/g, "R#").replace(/\b\d{4,}\b/g, "#").slice(0, 110));
let ok = 0, noR = 0, dayMiss = 0; const bad: string[] = [];
for (const code of ["none_already_booked", "none_already_as_asked"]) for (const id of list[code] ?? []) {
  const reason = String((dec.get(id) as any).decision.reason ?? "");
  const rs = [...reason.matchAll(/R(\d{3,6})/g)].map((m) => m[1]);
  const asked = new Set([...(A.get(id)?.[3] ?? "").split(";"), ...(B.get(id)?.[3] ?? "").split(";")].filter(Boolean));
  if (!rs.length) { noR++; bad.push(id + " no R in reason"); continue; }
  const hit = rs.some((r) => { const o = ordersByNo.get(r); return o && (!asked.size || [...asked].some((d) => days(o).has(d))); });
  if (hit) ok++; else { dayMiss++; bad.push(`${id} R not found with a live shift on the asked day (${rs.map((r) => ordersByNo.has(r) ? "R in snapshot" : "R absent").join(",")})`); }
}
console.log({ already_checked: ok + noR + dayMiss, order_with_shift_on_asked_day: ok, no_R_in_reason: noR, not_matched: dayMiss }); console.log(bad.join("\n"));
