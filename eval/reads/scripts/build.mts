// Builds the blind reader inputs for W3: the live week's 400 client emails, no system output.
import fs from "node:fs";
import { latestText } from "../../../app/lib/v2/interpret/ground.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const wr: any[] = J(".tmp-data/week-review-1014.json"), msgs: any[] = J(".tmp-data/gold/messages.json");
const key = (d: string, s: string) => `${new Date(d).toISOString()}|${s ?? ""}`;
const byKey = new Map<string, any[]>();
for (const m of msgs) if (!m.is_from_spartan) byKey.set(key(m.date_iso, m.subject), [...(byKey.get(key(m.date_iso, m.subject)) ?? []), m]);
const byThread = new Map<string, any[]>();
for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
for (const l of byThread.values()) l.sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
const out: any[] = []; let unjoined = 0;
for (const r of wr) {
  const hit = byKey.get(key(r.at, r.subject));
  if (!hit || hit.length !== 1) { unjoined++; continue; }
  const m = hit[0];
  const earlier = (byThread.get(m.thread_id) ?? []).filter((x) => Date.parse(x.date_iso) < Date.parse(m.date_iso)).slice(-3)
    .map((x) => ({ from: x.is_from_spartan ? "SPARTAN" : "CLIENT", date_iso: x.date_iso, text: latestText(String(x.body ?? "")).slice(0, 1200) }));
  out.push({ message_id: m.message_id, thread_id: m.thread_id, date_iso: m.date_iso, subject: m.subject ?? "",
    newest: latestText(String(m.body ?? "")).slice(0, 4000), full_body: String(m.body ?? "").slice(0, 6000),
    attachments: m.attachment_names ?? null, earlier_in_thread: earlier });
}
out.sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
fs.writeFileSync(".tmp-v2/reads/emails-1.json", JSON.stringify(out.slice(0, 200), null, 1));
fs.writeFileSync(".tmp-v2/reads/emails-2.json", JSON.stringify(out.slice(200), null, 1));
fs.writeFileSync(".tmp-v2/reads/ids.json", JSON.stringify(out.map((o) => o.message_id)));
console.log({ rows: wr.length, joined: out.length, unjoined, half1: Math.min(200, out.length), half2: Math.max(0, out.length - 200),
  newest_chars_median: out.map((o) => o.newest.length).sort((a, b) => a - b)[out.length >> 1] });
