// W3 scorer: two blind readers' labels against what the live system did, live week 10-14..10-21.
import fs from "node:fs";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const REPLY_REASON = /asked for a quote|the request is unclear|: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;
function csv(p: string) {
  const [h, ...rows] = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  const cols = h.split(",");
  return rows.map((line) => {
    const cells: string[] = []; let cur = "", q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { cells.push(cur); cur = ""; } else cur += ch; }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c.trim(), (cells[i] ?? "").trim()]));
  });
}
const ids: string[] = J(".tmp-v2/reads/ids.json");
const tryCsv = (p: string) => (fs.existsSync(p) ? csv(p) : []);
const read = (x: string) => new Map([...tryCsv(`eval/reads/${x}-1.csv`), ...tryCsv(`eval/reads/${x}-2.csv`)].map((r) => [r.message_id, r]));
const A = read("A"), B = read("B");
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));

// The TV outcome of the decision as made (v2.ts classify): none, needs-reply (never listed),
// listed (needs-created / needs-updated), or check (a verified write, never listed).
function outcome(id: string): string {
  const r: any = dec.get(id); if (!r) return "undecided";
  const d = r.decision;
  if (r.kind === "none") return "none";
  if (r.kind === "write") {
    const ex = r.executed, ops = d.ops ?? [];
    return ex?.length && ex.length === ops.length && ex.every((e: any) => e.status === "verified") ? "check" : "listed";
  }
  return (d.reply ?? (d.reasons ?? []).every((x: string) => REPLY_REASON.test(x))) ? "needs-reply" : "listed";
}
const STRICT = /new_booking|change|cancel/, WIDE = /new_booking|quote_or_availability|change|cancel|po_only|question/;
const inq = (r: any, re: RegExp) => !!r && re.test(r.asks) && !/^nothing$/.test(r.asks);

const missing = ids.filter((i) => !A.has(i) || !B.has(i));
const rows = ids.map((id) => ({ id, a: A.get(id), b: B.get(id), out: outcome(id) }));
function agree(re: RegExp) {
  let both = 0, neither = 0, aOnly = 0, bOnly = 0;
  for (const r of rows) { const x = inq(r.a, re), y = inq(r.b, re); if (x && y) both++; else if (!x && !y) neither++; else if (x) aOnly++; else bOnly++; }
  const n = both + neither + aOnly + bOnly, po = (both + neither) / n;
  const pa = (both + aOnly) / n, pb = (both + bOnly) / n, pe = pa * pb + (1 - pa) * (1 - pb);
  return { both, neither, aOnly, bOnly, agreement: +(po * 100).toFixed(1), kappa: +((po - pe) / (1 - pe)).toFixed(3) };
}
const byOut = (pred: (r: any) => boolean) => { const n: Record<string, number> = {}; for (const r of rows.filter(pred)) n[r.out] = (n[r.out] ?? 0) + 1; return n; };
const consensus = (r: any, re: RegExp) => inq(r.a, re) && inq(r.b, re);
const disputed = (r: any, re: RegExp) => inq(r.a, re) !== inq(r.b, re);
const listed = rows.filter((r) => r.out === "listed");
const tax = new Map<string, { tv: string; bucket: string }>();
for (const line of fs.readFileSync("eval/failure-taxonomy.md", "utf8").split("\n")) {
  const c = line.split("|").map((s) => s.trim());
  if (/^1a[0-9a-f]{14}$/.test(c[1] ?? "") && c.length >= 10) tax.set(c[1], { tv: c[6], bucket: c[8] });
}
const taxRows = rows.filter((r) => tax.has(r.id));
const res = {
  rows: rows.length, missing_labels: missing.length,
  system_outcomes: byOut(() => true),
  agreement_strict: agree(STRICT), agreement_wide: agree(WIDE),
  strict_consensus_inquiries: rows.filter((r) => consensus(r, STRICT)).length,
  strict_consensus_by_outcome: byOut((r) => consensus(r, STRICT)),
  strict_disputed_by_outcome: byOut((r) => disputed(r, STRICT)),
  wide_consensus_by_outcome: byOut((r) => consensus(r, WIDE)),
  listed_items: listed.length,
  listed_strict_consensus: listed.filter((r) => consensus(r, STRICT)).length,
  listed_wide_consensus: listed.filter((r) => consensus(r, WIDE)).length,
  listed_both_nothing: listed.filter((r) => !inq(r.a, WIDE) && !inq(r.b, WIDE)).length,
  none_both_nothing: rows.filter((r) => r.out === "none" && !inq(r.a, WIDE) && !inq(r.b, WIDE)).length,
  taxonomy_rows: taxRows.length,
  taxonomy_tv_check: taxRows.filter((r) => ({ "no card": "none", "needs-reply": "needs-reply", "check card": "check", listed: "listed" } as any)[tax.get(r.id)!.tv.replace(" (not listed)", "")] !== r.out).map((r) => `${r.id}:${tax.get(r.id)!.tv}/${r.out}`),
  taxonomy_label_wrong_vs_readers: (() => { const lw = taxRows.filter((r) => tax.get(r.id)!.bucket === "label_wrong"); return { label_wrong: lw.length, both_readers_not_strict: lw.filter((r) => !inq(r.a, STRICT) && !inq(r.b, STRICT)).length }; })(),
  taxonomy_misses_vs_readers: (() => { const m = taxRows.filter((r) => !/label_wrong|genuinely_ambiguous|not a miss/.test(tax.get(r.id)!.bucket)); return { system_misses: m.length, both_readers_strict: m.filter((r) => consensus(r, STRICT)).length }; })(),
};
console.log(JSON.stringify(res, null, 1));
const out = rows.map((r) => [r.id, r.out, r.a?.asks ?? "", r.b?.asks ?? "", r.a?.sure ?? "", r.b?.sure ?? "", consensus(r, STRICT) ? "inquiry" : disputed(r, STRICT) ? "disputed" : "not", tax.get(r.id)?.bucket ?? ""].join(","));
if (!missing.length) fs.writeFileSync(".tmp-v2/reads/joined.csv", "message_id,system,asks_A,asks_B,sure_A,sure_B,strict,taxonomy_bucket\n" + out.join("\n") + "\n");
