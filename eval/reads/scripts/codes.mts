// reason_code distribution of the live week's flagged items (handoffs and writes that did not run). Counts only.
import fs from "node:fs";
import { coded } from "../../../app/lib/v2/reasons.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const ids = new Set<string>(J(".tmp-v2/reads/ids.json"));
const REPLY = /asked for a quote|the request is unclear|: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;
const rows = J(".tmp-data/gold/decisions.json").filter((d: any) => ids.has(d.message_id) && d.kind !== "none");
const n: Record<string, Record<string, number>> = { listed: {}, "needs-reply": {}, "write did not run": {} };
for (const r of rows) {
  const d = coded(r.decision) as any;
  let lane: string | null = null;
  if (r.kind === "write") { const ex = r.executed ?? []; if (ex.length && ex.length === d.ops.length && ex.every((e: any) => e.status === "verified")) continue; lane = "write did not run"; }
  else lane = (d.reply ?? (d.reasons ?? []).every((x: string) => REPLY.test(x))) ? "needs-reply" : "listed";
  const code = d.code ?? (r.kind === "write" ? `write: ${(r.executed ?? []).map((e: any) => e.status).join("+") || "not run"}` : "uncoded");
  n[lane][code] = (n[lane][code] ?? 0) + 1;
}
for (const [k, v] of Object.entries(n)) console.log(k, Object.values(v).reduce((a, b) => a + b, 0), JSON.stringify(Object.fromEntries(Object.entries(v).sort((a, b) => b[1] - a[1]))));
