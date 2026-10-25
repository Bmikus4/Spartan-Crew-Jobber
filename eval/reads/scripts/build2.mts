// Second reading batch: every decided client email in the snapshot outside the live week, decided on the TV-era
// build (created at or after V2_FROM) and sent from 2026-10-01. Same blind format as build.mts.
import fs from "node:fs";
import { latestText } from "../../../app/lib/v2/interpret/ground.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const week = new Set<string>(J(".tmp-v2/reads/ids.json"));
const msgs: any[] = J(".tmp-data/gold/messages.json"); const byId = new Map(msgs.map((m) => [m.message_id, m]));
const byThread = new Map<string, any[]>(); for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
for (const l of byThread.values()) l.sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
const rows = J(".tmp-data/gold/decisions.json").filter((d: any) => !week.has(d.message_id) && Date.parse(d.created_at) >= Date.parse("2026-10-09T10:20:00Z")
  && Date.parse(d.sent_at) >= Date.parse("2026-10-01T00:00:00Z") && !byId.get(d.message_id)?.is_from_spartan);
const out = rows.map((d: any) => { const m: any = byId.get(d.message_id);
  const earlier = (byThread.get(m.thread_id) ?? []).filter((x) => Date.parse(x.date_iso) < Date.parse(m.date_iso)).slice(-3)
    .map((x) => ({ from: x.is_from_spartan ? "SPARTAN" : "CLIENT", date_iso: x.date_iso, text: latestText(String(x.body ?? "")).slice(0, 1200) }));
  return { message_id: m.message_id, thread_id: m.thread_id, date_iso: m.date_iso, subject: m.subject ?? "", newest: latestText(String(m.body ?? "")).slice(0, 4000),
    full_body: String(m.body ?? "").slice(0, 6000), attachments: m.attachment_names ?? null, earlier_in_thread: earlier }; })
  .sort((a: any, b: any) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
const half = Math.ceil(out.length / 2);
fs.writeFileSync(".tmp-v2/reads/emails-3.json", JSON.stringify(out.slice(0, half), null, 1));
fs.writeFileSync(".tmp-v2/reads/emails-4.json", JSON.stringify(out.slice(half), null, 1));
fs.writeFileSync(".tmp-v2/reads/ids2.json", JSON.stringify(out.map((o: any) => o.message_id)));
console.log({ emails: out.length, half3: half, half4: out.length - half, first: out[0]?.date_iso.slice(0, 10), last: out[out.length - 1]?.date_iso.slice(0, 10) });
