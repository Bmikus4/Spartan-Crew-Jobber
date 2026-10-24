// What the LIVE system decided in a week against what staff did after it, judged by value. No
// model call; the database is read inside READ ONLY transactions (_readonly.mts) and OnSinch only
// read. score-vs-ops re-plans the week with the code on disk (a replay); this grades the decisions
// that were actually made and the writes that actually went out, so it needs no tuning to be
// honest: the decisions were taken before anyone looked at this week's mail.
//   npx tsx --env-file=.env.local scripts/week-review.mts [--from ISO] [--to ISO] [--json out] [--all] [--measure]
//
// THE FOUR NUMBERS, never averaged into one (addendum 5.1, 10-24):
//   wrong writes   the bot wrote, every step verified, and staff then changed or undid that order
//   coverage       emails whose booking work the bot completed / emails with booking work
//   missed changes the system said there was nothing to do, and staff then booked something
//   lost emails    client emails in the window with no decision at all (F1)
// Beside them, counted apart: handoffs a rule requires (policy_*), questions for the client
// (reply_*), writes that used a default (an assumed time, a trade booked as crew, a chosen venue),
// and plans cut short (fewer verified runs than operations, never "done": metrics.ts).
// A planned write that was not sent (writes off) is judged by value against what staff did.
// Staff actions come from OnSinch's timeline (ops-truth.mts). The bot writes as user 2257, which is
// also Ben's own login, so an edit Ben makes by hand counts as the bot's.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readOnlySql, proveReadOnly } from "./_readonly.mts";
import { fullyWritten, judge, truthKeys, type Act } from "../app/lib/v2/score";
import { coded } from "../app/lib/v2/reasons";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = new Date(arg("--from", new Date(Date.now() - 7 * 864e5).toISOString())).toISOString();
const TO = new Date(arg("--to", new Date().toISOString())).toISOString();
const OUT = ".tmp-data/week-truth.json";
const sql = readOnlySql();
console.log(`database read-only: ${(await proveReadOnly(sql)).slice(0, 80)}`);
execSync(`npx tsx --env-file=.env.local scripts/ops-truth.mts --from ${FROM} --out ${OUT}`, { stdio: "inherit" });
const truth = new Map((JSON.parse(readFileSync(OUT, "utf8")) as any[]).map((t) => [t.id, t]));
const acts = JSON.parse(readFileSync(OUT.replace(/\.json$/, "-acts.json"), "utf8")) as Act[];
const orders = new Map((JSON.parse(readFileSync(OUT.replace(/\.json$/, "-orders.json"), "utf8")) as any[]).map((o) => [Number(o.id), o]));

const rows = (await sql`SELECT d.message_id, d.created_at, d.kind, d.company, d.code_version, d.decision, d.executed, m.subject, m.date_iso
  FROM v2_decisions d JOIN thread_messages m USING (message_id)
  WHERE coalesce(d.code_version,'') <> 'local' AND m.date_iso >= ${FROM} AND m.date_iso < ${TO} AND NOT m.is_from_spartan ORDER BY m.date_iso`) as any[];
// Lost: a client email stored in the window with no decision row (the sweep makes one since S-0214).
const [lost] = (await sql`SELECT count(*)::int AS n FROM thread_messages m WHERE NOT m.is_from_spartan AND m.date_iso >= ${FROM} AND m.date_iso < ${TO}
  AND m.from_address !~* '(spartancrew[.]co[.]uk|no-?reply|mailer-daemon|postmaster|onsinch|sinch[.]cz)'
  AND NOT EXISTS (SELECT 1 FROM v2_decisions d WHERE d.message_id = m.message_id)`) as any[];

const STAFF = (a: Act) => a.by !== 2257;
const out = rows.map((r) => {
  const t: any = truth.get(r.message_id) ?? { staff: [] };
  // A row decided before codes existed (S-0216) is coded now, from the same table.
  const d = coded(r.decision);
  const ops: any[] = d.kind === "write" ? d.ops : [];
  const ex: any[] = Array.isArray(r.executed) ? r.executed : [];
  const wroteOrders = new Set<number>([...ops.map((o) => Number(o.op?.order_id)), ...ex.map((e) => Number(e.detail?.order_id))].filter((n) => n > 0));
  const after = acts.filter((a) => STAFF(a) && Date.parse(a.at) > Date.parse(r.created_at) && wroteOrders.has(a.order_id));
  const staff: Act[] = [...t.staff, ...after.filter((a) => !t.staff.some((s: Act) => s.at === a.at && s.order_id === a.order_id && s.what === a.what))];
  const want = truthKeys(staff, (id) => orders.get(id));
  const bookable = want.keys.length + want.other.length > 0;
  const ran = ex.filter((e) => e.status === "verified").length;
  let verdict: string;
  if (d.kind === "write" && ex.length) {
    // Staff booking more for this email on other orders: the bot's part may be right, the email's work was not all done.
    verdict = !fullyWritten(ops, ex) ? (ran ? "cut short" : "write failed") : after.length ? "wrong write" : t.staff.some((a: Act) => !wroteOrders.has(a.order_id)) ? "partial: staff did more" : "completed";
  } else if (d.kind === "write") {
    verdict = `planned, not sent: ${judge(ops.map((o) => o.op), want).verdict}`;
  } else if (d.kind === "handoff") verdict = bookable ? "handed off, staff booked" : "handed off";
  else verdict = bookable ? "missed change" : "nothing to do";
  return { at: r.date_iso, company: r.company, subject: r.subject, kind: d.kind, code: d.code, defaults: d.kind === "write" ? d.defaults ?? [] : [], verdict, bookable: bookable || verdict === "completed" || verdict === "wrong write",
    why: JSON.stringify((d as any).reason ?? (d as any).reasons ?? (d as any).why ?? "").slice(0, 140),
    bot: ex.map((e) => `${e.status}: ${(e.reasons ?? []).join("; ").slice(0, 80)}`), staff: staff.map((a) => `${a.what} R${a.number}`), lacking: want.other };
});

const n = (f: (o: (typeof out)[number]) => boolean) => out.filter(f).length;
const bookable = n((o) => o.bookable);
const four = {
  wrong_writes: n((o) => o.verdict === "wrong write"),
  completed: n((o) => o.verdict === "completed"),
  bookable_work: bookable,
  missed_changes: n((o) => o.verdict === "missed change"),
  lost_emails: Number(lost?.n ?? 0),
};
const apart = {
  policy_handoffs: n((o) => o.kind === "handoff" && /^policy_/.test(o.code ?? "")),
  replies: n((o) => o.kind === "handoff" && /^reply_/.test(o.code ?? "")),
  writes_with_defaults: n((o) => o.kind === "write" && o.defaults.length > 0),
  cut_short: n((o) => o.verdict === "cut short"),
  write_failed: n((o) => o.verdict === "write failed"),
};
const codes: Record<string, number> = {};
for (const o of out) if (o.kind !== "write") codes[o.code ?? "?"] = (codes[o.code ?? "?"] ?? 0) + 1;
const verdicts: Record<string, number> = {};
for (const o of out) verdicts[o.verdict] = (verdicts[o.verdict] ?? 0) + 1;

console.log(`\nclient emails ${out.length}, ${FROM.slice(0, 16)} to ${TO.slice(0, 16)}; decisions read live, none re-planned`);
console.log(`  wrong writes    ${four.wrong_writes}   (target 0)`);
console.log(`  coverage        ${four.completed} of ${four.bookable_work} emails with booking work completed by the system${bookable ? ` (${Math.round((four.completed / bookable) * 1000) / 10}%)` : ""}`);
console.log(`  missed changes  ${four.missed_changes}`);
console.log(`  lost emails     ${four.lost_emails}`);
console.log(`  apart: policy handoffs ${apart.policy_handoffs}, replies ${apart.replies}, writes using a default ${apart.writes_with_defaults}, plans cut short ${apart.cut_short}, writes failed ${apart.write_failed}`);
console.log(`  verdicts: ${Object.entries(verdicts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  codes (not writes): ${Object.entries(codes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
const show = process.argv.includes("--all") ? out : out.filter((o) => !["nothing to do", "completed", "handed off"].includes(o.verdict));
for (const o of show) console.log(`\n${o.at.slice(5, 16)} ${o.verdict.toUpperCase()} [${o.code}] ${o.company ?? "?"} | ${String(o.subject).slice(0, 60)}\n  why:   ${o.why}\n  bot:   ${o.bot.join(" | ") || "-"}\n  staff: ${o.staff.slice(0, 6).join(", ") || "-"}`);
const json = process.argv.indexOf("--json");
if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(out, null, 1));
if (process.argv.includes("--measure")) {
  mkdirSync(".tmp-data", { recursive: true });
  const f = ".tmp-data/gate-measurements.json";
  const prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  const measured = { ...(prev.measured ?? {}), week_review: { dataset: `live v2_decisions, client emails ${FROM} to ${TO}`, emails: out.length, ...four, ...apart, verdicts, codes } };
  writeFileSync(f, JSON.stringify({ ...prev, measured }, null, 2));
}
