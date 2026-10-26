// Prospective batch (red-team-B H1, 10-26): every decided client email sent after the 10-22 copy was taken,
// read from the 10-26 copy. No tuning step has read these, so they are the locked test set. Same blind format
// as build.mts and build2.mts.   npx tsx eval/reads/scripts/build5.mts
import fs from "node:fs";
import { latestText } from "../../../app/lib/v2/interpret/ground.ts";
const GOLD = ".tmp-data/gold-1026";
const AFTER = "2026-10-22T22:51:00Z";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const msgs: any[] = J(`${GOLD}/messages.json`); const byId = new Map(msgs.map((m) => [m.message_id, m]));
const byThread = new Map<string, any[]>(); for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
for (const l of byThread.values()) l.sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
const rows = J(`${GOLD}/decisions.json`).filter((d: any) => Date.parse(d.sent_at) > Date.parse(AFTER) && byId.has(d.message_id) && !byId.get(d.message_id)?.is_from_spartan);
const out = rows.map((d: any) => { const m: any = byId.get(d.message_id);
  const earlier = (byThread.get(m.thread_id) ?? []).filter((x) => Date.parse(x.date_iso) < Date.parse(m.date_iso)).slice(-3)
    .map((x) => ({ from: x.is_from_spartan ? "SPARTAN" : "CLIENT", date_iso: x.date_iso, text: latestText(String(x.body ?? "")).slice(0, 1200) }));
  return { message_id: m.message_id, thread_id: m.thread_id, date_iso: m.date_iso, subject: m.subject ?? "", newest: latestText(String(m.body ?? "")).slice(0, 4000),
    full_body: String(m.body ?? "").slice(0, 6000), attachments: m.attachment_names ?? null, earlier_in_thread: earlier }; })
  .sort((a: any, b: any) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
fs.mkdirSync(".tmp-v2/reads", { recursive: true });
fs.writeFileSync(".tmp-v2/reads/emails-5.json", JSON.stringify(out, null, 1));
fs.writeFileSync(".tmp-v2/reads/ids5.json", JSON.stringify(out.map((o: any) => o.message_id)));
console.log({ emails: out.length, first: out[0]?.date_iso, last: out[out.length - 1]?.date_iso });
