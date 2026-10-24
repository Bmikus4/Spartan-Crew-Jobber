// The real-email scoreboard (no model call): every stored client email since shadow began,
// re-grounded and re-planned by the code on disk, against OnSinch as it was when the email
// arrived (orders created later are hidden). Read-only.
//   npx tsx --env-file=.env.local scripts/real-email-scoreboard.mts [--json out] [--list]
import { readOnlySql, proveReadOnly } from "./_readonly.mts";
import { linkedOrderId } from "../app/lib/v2/threadOrder";
import { assumeLinksTable } from "../app/lib/v2/links";
import { writeFileSync } from "node:fs";
import { ground } from "../app/lib/v2/interpret/interpret";
import { latestText } from "../app/lib/v2/interpret/ground";
import { plan } from "../app/lib/v2/interpret/plan";
import { onsinchWorld } from "../app/lib/v2/process";
const sql: any = readOnlySql();
console.log(`database read-only: ${(await proveReadOnly(sql)).slice(0, 80)}`);
assumeLinksTable();
const live = onsinchWorld();
const cache = new Map<number, any[]>();
const orders = async (c: number) => { if (!cache.has(c)) cache.set(c, await live.companyOrders(c)); return cache.get(c)!; };
const worldAt = (sent: string) => ({ ...live, companyOrders: async (c: number) => (await orders(c)).filter((o: any) => Date.parse(o.created) <= Date.parse(sent)) });
const rows = (await sql`SELECT d.message_id, d.kind, d.decision, d.interpretation->'extraction' AS x, d.from_address, d.company, m.thread_id, m.subject, m.body, m.date_iso
  FROM v2_decisions d JOIN thread_messages m USING (message_id) WHERE coalesce(d.code_version,'') <> 'local' AND d.created_at > '2026-10-09T10:20:00Z' AND d.interpretation IS NOT NULL ORDER BY d.created_at`) as any[];

// Tallied by the code stamped on each decision (app/lib/v2/reasons.ts), never by matching its words:
// until 10-24 a regex list here sorted the reasons, so rewording one moved the counts.
const out: any[] = [];
const priorBy = new Map<string, any[]>();
for (const r of rows) {
  const text = latestText(r.body);
  const g = ground(r.x, `${r.subject}\n${text}`, r.date_iso, { subject: r.subject ?? "", prior: priorBy.get(r.thread_id) ?? [] });
  priorBy.set(r.thread_id, [...(priorBy.get(r.thread_id) ?? []), ...g.requests]);
  // The thread's link as production reads it (threadOrder.ts); conversation_state was retired 10-21.
  const linked = await linkedOrderId(sql, r.thread_id).catch(() => null);
  const d: any = await plan({ message_id: r.message_id, from: r.from_address, subject: r.subject, sentIso: r.date_iso, text }, g, worldAt(r.date_iso), linked);
  const said: string[] = d.why ?? d.reasons ?? [d.reason];
  out.push({ id: r.message_id, at: r.date_iso, company: r.company, subject: r.subject, intent: g.intent, kind: d.kind === "handoff" && d.reply ? "reply" : d.kind, category: d.code ?? "uncoded", said, ops: d.ops?.map((o: any) => o.op) });
}
const asked = out.filter((o) => o.kind !== "none");
const tally: Record<string, number> = {};
for (const o of asked) tally[o.category] = (tally[o.category] ?? 0) + 1;
const writes = asked.filter((o) => o.kind === "write").length;
const replies = asked.filter((o) => o.kind === "reply").length;
const failed = asked.length - writes - replies;
console.log(`emails ${out.length}; needing action ${asked.length}; written ${writes}; reply needed ${replies}; order left for a person ${failed} (${Math.round((failed / Math.max(1, writes + failed)) * 100)}% of order work)`);
const together = (await sql`SELECT count(*)::int n FROM v2_decisions WHERE coalesce(code_version,'') <> 'local' AND created_at > '2026-10-09T10:20:00Z' AND interpretation IS NULL AND kind = 'handoff' AND (decision::text ILIKE '%later email%' OR decision::text ILIKE '%later client message%')`) as any[];
console.log(`older messages of a multi-message delivery (handed off unread before; read together now): ${together[0].n}`);
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), k);
const json = process.argv.indexOf("--json");
if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(out, null, 1));
if (process.argv.includes("--list")) for (const o of asked) console.log(`${o.at.slice(5, 16)} ${o.kind.padEnd(7)} ${String(o.company).slice(0, 22).padEnd(22)} | ${String(o.subject).slice(0, 40).padEnd(40)} | ${o.said.join("; ").slice(0, 160)}`);
