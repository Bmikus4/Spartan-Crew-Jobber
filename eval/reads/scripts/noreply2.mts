import fs from "node:fs";
import { rNumbersIn } from "../../../app/lib/onsinch/resolve.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const list: string[] = J(".tmp-v2/reads/none-inquiries.json").none_not_client;
const msgs: any[] = J(".tmp-data/gold/messages.json");
const byId = new Map(msgs.map((m) => [m.message_id, m]));
const byThread = new Map<string, any[]>(); for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
const addr = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();
const dom = addr(String((byId.get(list[0]) as any).from_address)).split("@")[1];
const all = msgs.filter((m) => addr(String(m.from_address)).endsWith("@" + dom));
let replied = 0, rInReply = 0, threads = new Set<string>(), sameThreadSiblings = 0;
for (const id of list) {
  const m: any = byId.get(id); threads.add(m.thread_id);
  const later = (byThread.get(m.thread_id) ?? []).filter((x) => x.is_from_spartan && Date.parse(x.date_iso) > Date.parse(m.date_iso));
  if (later.length) replied++;
  if (later.some((x) => rNumbersIn(String(x.subject ?? "") + "\n" + String(x.body ?? "").slice(0, 3000)).length)) rInReply++;
}
// What the platform's mail looks like structurally: the shape of subjects with every word reduced to a class.
const shape = (s: string) => String(s ?? "").replace(/\d+/g, "#").replace(/[A-Za-z]+/g, (w) => (w.length <= 3 ? w.toLowerCase() : "W")).slice(0, 60);
const shapes: Record<string, number> = {}; for (const m of all) shapes[shape(m.subject)] = (shapes[shape(m.subject)] ?? 0) + 1;
console.log({ domain_messages_total_in_archive: all.length, first: all.map((m) => m.date_iso).sort()[0]?.slice(0, 10), last: all.map((m) => m.date_iso).sort().slice(-1)[0]?.slice(0, 10),
  the26_threads: threads.size, the26_with_a_later_reply_from_us: replied, replies_naming_an_R: rInReply,
  tld: dom.split(".").slice(-2).join("."), subject_shapes: Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 6) });
