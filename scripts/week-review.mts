// What the LIVE bot did this week against what staff did after it. No model call, read-only.
// score-vs-ops re-reads emails with the code on disk (a replay); this grades the decisions that
// were actually made and the writes that actually went out, so the two can disagree: a replay
// cannot see a write that blocked, or a bot order staff then fixed by hand.
//   npx tsx --env-file=.env.local scripts/week-review.mts [--from 2026-10-13T16:00:00Z] [--json out] [--all]
// Verdicts per client email:
//   done          the bot wrote, every step verified, staff made no booking edit to those orders after
//   corrected     the bot wrote, then staff edited, added to or cancelled one of those orders
//   write failed  a write step did not verify (blocked / failed)
//   handed off    the bot sent it to the TV and staff then booked something
//   missed        the bot did nothing and staff then booked something
//   quiet         nothing asked, nothing done by anyone
// Staff actions come from OnSinch's timeline (scripts/ops-truth.mts). The bot writes as user
// 2257, which is also Ben's own login, so an edit Ben makes by hand counts as the bot's.
import { neon } from "@neondatabase/serverless";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg("--from", new Date(Date.now() - 7 * 864e5).toISOString());
const OUT = ".tmp-data/week-truth.json";
execSync(`npx tsx --env-file=.env.local scripts/ops-truth.mts --from ${new Date(FROM).toISOString()} --out ${OUT}`, { stdio: "inherit" });
const truth = new Map((JSON.parse(readFileSync(OUT, "utf8")) as any[]).map((t) => [t.id, t]));
const acts = JSON.parse(readFileSync(OUT.replace(/\.json$/, "-acts.json"), "utf8")) as any[];
const sql = neon((process.env.DATABASE_URL || "").trim());
const rows = (await sql`SELECT d.message_id, d.created_at, d.kind, d.company, d.code_version, d.decision, d.executed, m.subject, m.date_iso
  FROM v2_decisions d JOIN thread_messages m USING (message_id)
  WHERE coalesce(d.code_version,'') <> 'local' AND d.created_at > ${FROM} AND NOT m.is_from_spartan ORDER BY m.date_iso`) as any[];

const STAFF = (a: any) => a.by !== 2257;
const out = rows.map((r) => {
  const t: any = truth.get(r.message_id) ?? { staff: [] };
  const ops: any[] = r.decision?.ops ?? [];
  const ex: any[] = Array.isArray(r.executed) ? r.executed : [];
  const orders = new Set<number>([...ops.map((o) => Number(o.op?.order_id)), ...ex.map((e) => Number(e.detail?.order_id))].filter((n) => n > 0));
  // An order the bot created is known by its number until the ledger is read back.
  const numbers = new Set(ex.map((e) => String(e.detail?.number ?? "")).filter(Boolean));
  const after = acts.filter((a) => STAFF(a) && Date.parse(a.at) > Date.parse(r.created_at) && (orders.has(a.order_id) || numbers.has(a.number)));
  const wrote = r.kind === "write" && ex.length > 0;
  const verdict = wrote && ex.some((e) => e.status !== "verified") ? "write failed"
    : wrote && after.length ? "corrected"
    : wrote ? "done"
    : t.staff.length && r.kind === "handoff" ? "handed off"
    : t.staff.length ? "missed"
    : "quiet";
  return { at: r.date_iso, company: r.company, subject: r.subject, kind: r.kind, code: String(r.code_version ?? "").slice(0, 7), verdict,
    why: JSON.stringify(r.decision?.reason ?? r.decision?.reasons ?? "").slice(0, 140),
    bot: ex.map((e) => `${e.status}: ${(e.reasons ?? []).join("; ").slice(0, 80)}`),
    staff: [...t.staff, ...after].map((a: any) => `${a.what} R${a.number}`) };
});

const count = (v: string) => out.filter((o) => o.verdict === v).length;
const needed = out.filter((o) => o.verdict !== "quiet").length;
const failed = count("corrected") + count("write failed") + count("handed off") + count("missed");
console.log(`\nclient emails ${out.length} since ${FROM}; something to book after ${needed}`);
for (const v of ["done", "corrected", "write failed", "handed off", "missed", "quiet"]) console.log(`  ${v.padEnd(13)} ${count(v)}`);
console.log(`  not done by the system: ${failed} of ${needed}${needed ? ` (${Math.round((failed / needed) * 1000) / 10}%; bar 1%)` : ""}`);
const show = process.argv.includes("--all") ? out : out.filter((o) => o.verdict !== "quiet" && o.verdict !== "done");
for (const o of show) console.log(`\n${o.at.slice(5, 16)} ${o.verdict.toUpperCase()} ${o.company ?? "?"} | ${String(o.subject).slice(0, 60)} [${o.kind} ${o.code}]\n  why:   ${o.why}\n  bot:   ${o.bot.join(" | ") || "-"}\n  staff: ${o.staff.slice(0, 6).join(", ") || "-"}`);
const json = process.argv.indexOf("--json");
if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(out, null, 1));
