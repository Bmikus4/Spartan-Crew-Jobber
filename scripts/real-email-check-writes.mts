// Read-only: each write the plan makes that a baseline run did not (or every write, --all), next to what ops built by hand.
//   npx tsx --env-file=.env.local scripts/real-email-check-writes.mts <now.json> [base.json] [--all]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { onsinchWorld } from "../app/lib/v2/process";
import { latestText } from "../app/lib/v2/interpret/ground";
import { utcToLondon } from "../app/lib/v2/bot/ops";
const sql = neon((process.env.DATABASE_URL || "").trim());
const w = onsinchWorld();
const base = new Map(process.argv.includes("--all") ? [] : (JSON.parse(readFileSync(process.argv[3] ?? ".tmp-data/score-base.json", "utf8")) as any[]).map((o) => [o.id, o]));
const now = JSON.parse(readFileSync(process.argv[2] ?? ".tmp-data/score-now.json", "utf8")) as any[];
const companies = await w.companies();
const slotsOf = (o: any) => ([] as any[]).concat(o.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []).flatMap((t: any) => ([] as any[]).concat(t.Slot ?? []).filter((s: any) => !s.cancelled).map((s: any) => ({ team: t.id, ...s }))));
const show = (o: any) => `R${o.number} created ${o.created.slice(0, 16)} by ${o.creator} po="${o.intern_name}" | ` + slotsOf(o).map((s: any) => `${utcToLondon(s.beginning).date} ${utcToLondon(s.beginning).time}-${utcToLondon(s.end).time} x${s.size} prof${s.profession_id}${Number(s.role) === 1 ? "(chief)" : ""} place${s.SlotLocation?.place_id}`).join("; ");
for (const o of now.filter((o) => o.kind === "write" && base.get(o.id)?.kind !== "write")) {
  const [r] = (await sql`SELECT m.body, d.company_id FROM thread_messages m JOIN v2_decisions d USING (message_id) WHERE message_id = ${o.id}`) as any[];
  console.log(`\n### ${o.at.slice(0, 16)} ${o.company} | ${o.subject}\nEMAIL: ${latestText(r.body).replace(/\s+/g, " ").slice(0, 420)}\nPLAN: ${o.said.join("; ")}\nOPS: ${JSON.stringify(o.ops).slice(0, 700)}`);
  const cid = Number(r.company_id);
  const orders = await w.companyOrders(cid);
  const days = new Set<string>((o.ops ?? []).flatMap((op: any) => op.shifts ? op.shifts.map((s: any) => s.date) : op.date ? [op.date] : []));
  const ids = new Set<number>((o.ops ?? []).map((op: any) => Number(op.order_id)).filter(Boolean));
  for (const x of orders.filter((x: any) => ids.has(Number(x.id)) || slotsOf(x).some((s: any) => days.has(utcToLondon(s.beginning).date)))) console.log("  NOW IN ONSINCH: " + show(x).slice(0, 600));
}
