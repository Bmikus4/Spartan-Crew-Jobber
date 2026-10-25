// Candidate silent misses: both readers say the email asks for booking work, and the system made no shown item.
import fs from "node:fs";
import { coded } from "../../../app/lib/v2/reasons.ts";
import { utcToLondon } from "../../../app/lib/v2/bot/ops.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const joined = fs.readFileSync(".tmp-v2/reads/joined.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));
const msgs: any[] = J(".tmp-data/gold/messages.json"); const byId = new Map(msgs.map((m) => [m.message_id, m]));
const byThread = new Map<string, any[]>(); for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
const acts: any[] = J(".tmp-data/week-truth-acts.json");
const ordersW = new Map(J(".tmp-data/week-truth-orders.json").map((o: any) => [Number(o.id), o]));
const ordersG = new Map(J(".tmp-data/gold/orders.json").map((o: any) => [Number(o.id), o]));
const csv = (p: string) => fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "")); return [c[0], c] as [string, string[]]; });
const A = new Map([...csv("eval/reads/A-1.csv"), ...csv("eval/reads/A-2.csv")]), B = new Map([...csv("eval/reads/B-1.csv"), ...csv("eval/reads/B-2.csv")]);
const daysOf = (o: any) => { const s = new Set<string>(); for (const j of [].concat(o?.Job ?? [])) for (const t of [].concat((j as any)?.SlotTeam ?? [])) for (const sl of [].concat((t as any)?.Slot ?? [])) { const b = (sl as any).beginning; if (b) try { s.add(utcToLondon(String(b)).date); } catch {} } return s; };
const want = process.argv[2] ?? "cands";
const out: any[] = [];
for (const [id, sys, , , , , strict] of joined) {
  const d: any = dec.get(id); const c = coded(d.decision) as any;
  const isCand = (strict === "inquiry" && ((sys === "none" && /none_nothing_to_do|^other$/.test(c.code)) || sys === "needs-reply")) || strict === "disputed";
  if (!isCand) continue;
  const m: any = byId.get(id); const t0 = Date.parse(m.date_iso);
  const days = new Set([...(A.get(id)?.[3] ?? "").split(";"), ...(B.get(id)?.[3] ?? "").split(";")].filter(Boolean));
  const co = d.company_id;
  const hits = co ? acts.filter((a) => Number(a.company_id) === Number(co) && String(a.by) !== "2257" && Date.parse(a.at) >= t0 - 3600e3 && Date.parse(a.at) <= t0 + 72 * 3600e3) : [];
  const onDay = hits.filter((a) => { const o = ordersW.get(Number(a.order_id)) ?? ordersG.get(Number(a.order_id)); return [...days].some((x) => daysOf(o).has(x)); });
  const reply = (byThread.get(m.thread_id) ?? []).filter((x) => x.is_from_spartan && Date.parse(x.date_iso) > t0).map((x) => (Date.parse(x.date_iso) - t0) / 3600e3).sort((a, b) => a - b)[0];
  out.push({ id, strict, sys, code: c.code, A: A.get(id)?.[1], B: B.get(id)?.[1], sureA: A.get(id)?.[5], sureB: B.get(id)?.[5], noteA: (A.get(id)?.[6] ?? "").slice(0, 90),
    company: co ?? null, staff_acts_72h: hits.length, on_named_day: onDay.length, act_kinds: [...new Set(onDay.map((a) => a.what))].join("+"), reply_h: reply != null ? +reply.toFixed(1) : null });
}
for (const r of out) console.log(JSON.stringify(r));
fs.writeFileSync(".tmp-v2/reads/cands.json", JSON.stringify(out, null, 1));
