import fs from "node:fs";
import { coded } from "../../../app/lib/v2/reasons.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const ids = new Set<string>(J(".tmp-v2/reads/ids.json"));
for (const r of J(".tmp-data/gold/decisions.json").filter((d: any) => ids.has(d.message_id) && d.kind === "handoff")) {
  const d: any = coded(r.decision);
  if (/system_failed|booking_link_unreadable/.test(d.code)) console.log(r.message_id, d.code, "|", (d.reasons ?? []).map((x: string) => x.replace(/R\d+/g, "R#").replace(/\d{3,}/g, "#").slice(0, 100)).join(" / "));
}
