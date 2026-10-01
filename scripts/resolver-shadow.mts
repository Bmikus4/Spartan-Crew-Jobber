// ============================================================================
// Shadow replay of the resolver over history, scored on the auto-labelled gold v0.
// READS ONLY. Design §30 step 5; Ben 2026-09-29 (Q13): the gold is auto-labelled from
// the order links and he reviews only the disagreements this prints.
// ----------------------------------------------------------------------------
// Gold v0: jobs are the migration plan's (threads joined through a shared order). Each
// thread's OPENING client message is replayed against the jobs that existed before it,
// with no thread continuity (it is the thread's first word):
//   - a later thread of a multi-thread job must CONTINUE that job, or abstain;
//   - a thread that started its job must not CONTINUE anything.
// The metric that gates is false merges: 0. Missed continues are the next worst, since
// each is a job booked twice.
//
// v0 approximations, stated: a job's days and venue are its threads' END-STATE facts,
// not their state at the opener's instant; the gold inherits whatever the historical
// order matcher decided on "matched" links, so agreement there is partly circular.
//
// Run: npx tsx scripts/resolver-shadow.mts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "node:fs";
import { planJobMigration, type OrderRecordRow, type StateRow } from "../app/lib/engine/jobMigration";
import { resolveMessage, type JobView, type MessageView } from "../app/lib/engine/resolver";
import { cleanEmailBody } from "../app/lib/engine/normalize";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const records = (await sql`SELECT order_id, thread_id, job_id, company_id, id_source, order_number FROM order_records`) as Array<OrderRecordRow & { order_number?: string }>;
const rows = (await sql`SELECT thread_id, state FROM conversation_state`) as Array<{ thread_id: string; state: any }>;
const msgs = (await sql`SELECT thread_id, from_address, date_iso, body, is_from_spartan FROM thread_messages`) as Array<{ thread_id: string; from_address: string; date_iso: string; body: string | null; is_from_spartan: boolean }>;

const state = new Map(rows.map((r) => [r.thread_id, r.state ?? {}]));
const states: StateRow[] = rows.map((r) => ({
  thread_id: r.thread_id, classification: r.state?.classification, company_id: r.state?.company_id ?? null,
  onsinch_order_id: r.state?.onsinch_order_id ?? null, order_action_log: r.state?.order_action_log ?? [],
}));
const { jobs: plan } = planJobMigration(records, states);

const opener = new Map<string, { at: string; body: string }>();
for (const m of msgs) {
  if (m.is_from_spartan || !m.date_iso) continue;
  const cur = opener.get(m.thread_id);
  if (!cur || Date.parse(m.date_iso) < Date.parse(cur.at)) opener.set(m.thread_id, { at: m.date_iso, body: m.body ?? "" });
}
const slotsOf = (t: string) => ((state.get(t)?.facts?.requests ?? []) as any[])
  .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date ?? "")))
  .map((r) => ({ day: String(r.date).slice(0, 10), start: r.start_time, end: r.end_time }));
const daysOf = (t: string) => ((state.get(t)?.facts?.requests ?? []) as any[]).map((r) => String(r?.date ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
const numbersByOrder = new Map<number, string>();
for (const r of records) if (r.order_number) numbersByOrder.set(Number(r.order_id), String(r.order_number));
for (const r of rows) if (r.state?.onsinch_order_id && r.state?.onsinch_order_number) numbersByOrder.set(Number(r.state.onsinch_order_id), String(r.state.onsinch_order_number));

const views: Array<JobView & { start: number; threads: string[] }> = plan.map((j) => ({
  job_key: j.job_key,
  company_id: j.company_ids[0],
  days: [...new Set(j.threads.flatMap(daysOf))].sort(),
  place_ids: [...new Set(j.threads.map((t) => Number(state.get(t)?.place_id)).filter((p) => p > 0))],
  order_numbers: [...new Set(j.links.map((l) => numbersByOrder.get(l.onsinch_order_id)).filter((x): x is string => !!x))],
  slots: j.threads.flatMap(slotsOf),
  threads: j.threads,
  start: Math.min(...j.threads.map((t) => Date.parse(opener.get(t)?.at ?? "")).filter(Number.isFinite)),
}));

/**
 * Ben's rulings on the v0 disagreements (2026-10-01) override the auto label for those
 * threads: "same" — the thread continues the other thread's job; "separate" — it starts
 * its own; "unsure" — left out of the score until he looks.
 */
const gold = new Map<string, { verdict: string; other_thread: string }>(
  (JSON.parse(readFileSync("scripts/resolver-gold-ben.json", "utf8")).pairs as Array<{ thread: string; other_thread: string; verdict: string }>)
    .map((p) => [p.thread, p]),
);
const jobOf = (t: string) => views.find((v) => v.threads.includes(t))?.job_key;

const score = { cases: 0, expect_continue: 0, expect_new: 0, false_merge: 0, correct_continue: 0, abstain_on_continue: 0, missed_continue: 0, correct_new: 0, abstain_on_new: 0, other: 0, excluded_unsure: 0 };
const review: Array<Record<string, unknown>> = [];
for (const j of views) {
  const order = [...j.threads].filter((t) => opener.has(t)).sort((a, b) => Date.parse(opener.get(a)!.at) - Date.parse(opener.get(b)!.at));
  order.forEach((t, i) => {
    const ruled = gold.get(t);
    if (ruled?.verdict === "unsure") { score.excluded_unsure++; return; }
    const op = opener.get(t)!;
    const s = state.get(t) ?? {};
    const view: MessageView = {
      thread_id: t, company_id: Number(s.company_id) > 0 ? Number(s.company_id) : undefined, own_text: cleanEmailBody(op.body),
      days: daysOf(t), place_id: Number(s.place_id) > 0 ? Number(s.place_id) : undefined,
      asks_for_crew: ((s.facts?.requests ?? []) as any[]).some((r) => Number(r?.size) > 0), at: op.at,
      slots: slotsOf(t),
    };
    const before = views.filter((v) => v.start < Date.parse(op.at));
    const o = resolveMessage(view, before);
    score.cases++;
    const want = ruled?.verdict === "same" ? jobOf(ruled.other_thread) ?? null
      : ruled?.verdict === "separate" ? null
      : i > 0 ? j.job_key : null;
    if (want) {
      score.expect_continue++;
      if (o.kind === "CONTINUE" && o.job === want) score.correct_continue++;
      else if (o.kind === "CONTINUE") { score.false_merge++; review.push({ thread: t, expected: want, got: o.job, why: o.evidence }); }
      else if (o.kind === "UNCERTAIN") { score.abstain_on_continue++; review.push({ thread: t, expected: want, got: "UNCERTAIN", reason: o.reason, right_candidate: o.candidates.includes(want) }); }
      else if (o.kind === "NEW") { score.missed_continue++; review.push({ thread: t, expected: want, got: "NEW", why: o.evidence }); }
      else score.other++;
    } else {
      score.expect_new++;
      if (o.kind === "CONTINUE") { score.false_merge++; review.push({ thread: t, expected: "NEW", got: o.job, why: o.evidence }); }
      else if (o.kind === "NEW") score.correct_new++;
      else if (o.kind === "UNCERTAIN") score.abstain_on_new++;
      else score.other++;
    }
  });
}
console.log("SCORE", JSON.stringify(score, null, 1));
writeFileSync(".tmp-data/resolver-shadow-review.json", JSON.stringify(review, null, 1));
console.log(`review list: ${review.length} rows -> .tmp-data/resolver-shadow-review.json`);
process.exitCode = score.false_merge === 0 ? 0 : 1;
