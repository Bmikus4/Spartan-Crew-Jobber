// Both reading batches (live week + the rest of the snapshot, 10-01..10-22) against what the system did.
// Rules: an inquiry is booking work for both readers (new_booking/change/cancel), or a quote both read as a
// quote that lists shifts (owner's B42: a day and a crew count from either reader). OnSinch portal notices
// (none_not_client from sinch.cz) and requests the system found already done are not outstanding.
// Silent = `none` or needs-reply. Counts and ids only.
import fs from "node:fs";
import { coded } from "../../../app/lib/v2/reasons.ts";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const REPLY = /asked for a quote|the request is unclear|: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;
const csv = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c] as [string, string[]]; }) : []);
const A = new Map([1, 2, 3, 4].flatMap((n) => csv(`eval/reads/A-${n}.csv`))), B = new Map([1, 2, 3, 4].flatMap((n) => csv(`eval/reads/B-${n}.csv`)));
const ids: string[] = [...J(".tmp-v2/reads/ids.json"), ...J(".tmp-v2/reads/ids2.json")];
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));
const msgs = new Map(J(".tmp-data/gold/messages.json").map((m: any) => [m.message_id, m]));
const has = (a: string | undefined, k: string) => (a ?? "").split("+").includes(k);
const strict = (a?: string) => /new_booking|change|cancel/.test(a ?? "");
function outcome(r: any): string {
  const d = r.decision;
  if (r.kind === "none") return "none";
  if (r.kind === "write") { const ex = r.executed ?? []; return ex.length && ex.length === (d.ops ?? []).length && ex.every((e: any) => e.status === "verified") ? "check" : "listed"; }
  return (d.reply ?? (d.reasons ?? []).every((x: string) => REPLY.test(x))) ? "needs-reply" : "listed";
}
const tally = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
const res: any = { emails: 0, labelled: 0, agree_strict: 0, outcomes: {}, inquiries: 0, portal: 0, already_done: 0, outstanding: 0, items: 0, silent: { none_nothing_to_do: 0, none_other: 0, needs_reply: 0 }, silent_ids: [] as string[], shown: 0, shown_request: 0, shown_nothing: 0, batch: {} };
for (const id of ids) {
  res.emails++;
  const a = A.get(id), b = B.get(id), r: any = dec.get(id); if (!a || !b || !r) continue;
  res.labelled++;
  if (strict(a[1]) === strict(b[1])) res.agree_strict++;
  const out = outcome(r); tally(res.outcomes, out);
  const code = (coded(r.decision) as any).code;
  const quoteShifts = has(a[1], "quote_or_availability") && has(b[1], "quote_or_availability") && !strict(a[1]) && !strict(b[1]) && !!((a[3] && a[4]) || (b[3] && b[4]));
  const inquiry = (strict(a[1]) && strict(b[1])) || quoteShifts;
  const wide = (x: string) => /new_booking|quote_or_availability|change|cancel|po_only|question/.test(x);
  if (out === "listed" || out === "check") { res.shown++; if (wide(a[1]) && wide(b[1])) res.shown_request++; if (!wide(a[1]) && !wide(b[1])) res.shown_nothing++; }
  if (!inquiry) continue;
  res.inquiries++;
  const from = String((msgs.get(id) as any)?.from_address ?? "");
  if (code === "none_not_client" && /sinch\.cz/i.test(from)) { res.portal++; continue; }
  if (out === "none" && /none_already_booked|none_already_as_asked/.test(code)) { res.already_done++; continue; }
  if (out === "none" && code === "other" && /already as asked/.test(String(r.decision.reason ?? ""))) { res.already_done++; continue; }
  res.outstanding++;
  // Read together with a later email of the same delivery: that email's outcome is this request's.
  const later = code === "none_read_together" ? dec.get(/later email (\w+)/.exec(String(r.decision.reason))?.[1] ?? "") : null;
  if (later && ["listed", "check"].includes(outcome(later))) { res.items++; continue; }
  if (out === "listed" || out === "check") res.items++;
  else { res.silent_ids.push(id); if (out === "needs-reply") res.silent.needs_reply++; else if (code === "none_nothing_to_do") res.silent.none_nothing_to_do++; else res.silent.none_other++; }
}
res.batch = { live_week: J(".tmp-v2/reads/ids.json").length, rest: J(".tmp-v2/reads/ids2.json").length };
console.log(JSON.stringify({ ...res, silent_ids: res.silent_ids.length }, null, 1));
fs.writeFileSync(".tmp-v2/reads/silent-all.json", JSON.stringify(res.silent_ids));
