import fs from "node:fs";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const list = J(".tmp-v2/reads/none-inquiries.json");
const msgs = new Map(J(".tmp-data/gold/messages.json").map((m: any) => [m.message_id, m]));
const A = new Map(fs.readFileSync("eval/reads/A-1.csv", "utf8").split("\n").concat(fs.readFileSync("eval/reads/A-2.csv", "utf8").split("\n")).map((l) => [l.split(",")[0], l]));
const re = /spartancrew\.co\.uk|no-?reply|mailer-daemon|postmaster|onsinch|sinch\.cz/i;
const cls: Record<string, number> = {}; const asks: Record<string, number> = {};
for (const id of list.none_not_client ?? []) {
  const m: any = msgs.get(id); const f = String(m.from_address ?? "");
  const tok = (f.match(re)?.[0] ?? "?").toLowerCase().replace(/^no-reply$/, "noreply");
  const grp = /via /i.test(f) ? " (group 'via')" : "";
  cls[tok + grp] = (cls[tok + grp] ?? 0) + 1;
  const a = (A.get(id) ?? "").split(",")[1] ?? ""; asks[a] = (asks[a] ?? 0) + 1;
}
console.log({ sender_class: cls, reader_A_asks: asks });
