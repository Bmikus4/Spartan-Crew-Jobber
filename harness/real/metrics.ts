// ============================================================================
// Every OPERATING §13.2 metric that these labels can carry, per bucket, with exact intervals.
// ----------------------------------------------------------------------------
// Definitions (OPERATING A.3, applied to what the TV shows; system.ts says what an item is):
//   real inquiry      both readers: booking work, and not excluded (a portal notice, or work
//                     already done when decided). Labels file, `consensus.strict` + `excluded`.
//   B42 inquiry       a real inquiry, or a quote both readers read that names a day and a crew
//                     count (owner's B42, 10-15). This is the working headline.
//   item              listed card or verified write. A needs-reply card is NOT an item: the TV
//                     never lists it (failure-taxonomy §1.1), so it is silent.
//   silent miss       a real inquiry whose outcome is none or needs-reply. An email intake read
//                     with a later one is reached when the later email's card is an item: its
//                     words are in that email's reading (process.ts:204-224).
// The metrics that need the opportunity an email is about (item_correctness, recall@5,
// selection_given_correct_candidate, action_accuracy) or the client it is from
// (client_resolution_accuracy) are reported as not measurable: no reader recorded either.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Label } from "./labels";
import { SHOWN, type Outcome, type SystemRow } from "./system";
import { percentile, rate } from "./stats";
import { ROOT } from "./data";

export type View = { name: string; inquiries: number; items: number; silent: number; recall: string; silent_ids: string[] };
type Count = Record<string, number>;
const OUTCOMES: Outcome[] = ["none", "needs-reply", "listed", "check"];

export const outstanding = (l: Label) => l.consensus.strict === "inquiry" && !l.excluded;
export const b42 = (l: Label) => outstanding(l) || l.consensus.b42_shifts;
/** The new-order (NONE) label: an outstanding new booking, or a B42 quote, which becomes an order. */
export const noneLabel = (l: Label) => (outstanding(l) && l.consensus.new_booking) || l.consensus.b42_shifts;

export const VIEWS: { name: string; is: (l: Label) => boolean; note: string }[] = [
  { name: "B42 (working headline)", is: b42, note: "booking work, plus quotes that name a day and a crew count" },
  { name: "booking work only", is: outstanding, note: "eval/live-week-reads.md:31, the figure before B42" },
  { name: "every quote counted", is: (l) => outstanding(l) || l.consensus.quote_only, note: "live-week-reads.md:37" },
  { name: "splits resolved by reader-V", is: (l) => l.resolved?.strict === "inquiry" && !l.excluded, note: "booking work with the 6 A/B splits settled by majority" },
];

/** The taxonomy bucket of the live week's 117 bucketed rows (failure-taxonomy.md Appendix A), as score.mts read it. */
export function taxonomy(): Map<string, { tv: string; bucket: string }> {
  const tax = new Map<string, { tv: string; bucket: string }>();
  for (const line of readFileSync(join(ROOT, "eval/failure-taxonomy.md"), "utf8").split("\n")) {
    const c = line.split("|").map((s) => s.trim());
    if (/^1a[0-9a-f]{14}$/.test(c[1] ?? "") && c.length >= 10) tax.set(c[1], { tv: c[6], bucket: c[8] });
  }
  return tax;
}

function bucketOf(l: Label): string {
  if (l.excluded === "portal_notice") return "booking work: OnSinch portal notice (excluded)";
  if (l.excluded === "already_done") return "booking work: already done when decided (excluded)";
  if (outstanding(l)) return l.consensus.new_booking ? "booking work: new booking" : "booking work: change or cancel";
  if (l.consensus.strict === "disputed") return "readers split on booking work";
  if (l.consensus.b42_shifts) return "quote with day and crew (B42 inquiry)";
  if (l.consensus.quote_only) return "quote without shifts";
  if (l.consensus.nothing) return "nothing asked (both readers)";
  return "other request (PO, question) or readers split on it";
}

export type Scored = ReturnType<typeof score>;

export function score(labels: Label[], rows: Map<string, SystemRow>, opts: { latencyUnit: "min" | "ms"; cost: string }) {
  const R = (l: Label) => rows.get(l.message_id)!;
  /** The row whose card carries this email's request: its own, or the later email's it was read with. */
  const card = (l: Label) => { const r = R(l); return r.carried_by && rows.has(r.carried_by) ? rows.get(r.carried_by)! : r; };
  const missing = labels.filter((l) => !rows.has(l.message_id)).map((l) => l.message_id);
  if (missing.length) throw new Error(`score: ${missing.length} labelled emails have no system row (${missing.slice(0, 5).join(", ")})`);
  const outcomes: Count = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (const l of labels) outcomes[R(l).outcome]++;
  const items = labels.filter((l) => SHOWN(R(l).outcome));

  const views: View[] = VIEWS.map((v) => {
    const inq = labels.filter(v.is);
    const silent = inq.filter((l) => !SHOWN(card(l).outcome));
    return { name: v.name, inquiries: inq.length, items: inq.length - silent.length, silent: silent.length, recall: rate(inq.length - silent.length, inq.length), silent_ids: silent.map((l) => l.message_id) };
  });

  const proposingNew = items.filter((l) => R(l).proposes_new);
  const noneLabelled = labels.filter(noneLabel);

  // Suppression = a `none` by a deterministic rule (§4). A none by the reading or the planner is not one.
  const RULES: Record<string, string> = { none_not_client: "sender rule (process.ts:161)", none_read_together: "read with a later email (process.ts:216)" };
  const suppression: Count = {}, noneByJudgment: Count = {};
  for (const l of labels) {
    const r = R(l);
    if (r.outcome !== "none") continue;
    if (RULES[r.code]) suppression[RULES[r.code]] = (suppression[RULES[r.code]] ?? 0) + 1;
    else noneByJudgment[r.code] = (noneByJudgment[r.code] ?? 0) + 1;
  }
  const codes: Record<string, Count> = {};
  for (const l of labels) { const r = R(l); (codes[r.outcome] ??= {})[r.code] = (codes[r.outcome][r.code] ?? 0) + 1; }

  const byBucket = (key: (l: Label) => string | null) => {
    const t: Record<string, Count> = {};
    for (const l of labels) {
      const k = key(l);
      if (!k) continue;
      const row = (t[k] ??= { n: 0, none: 0, "needs-reply": 0, listed: 0, check: 0 });
      row.n++; row[R(l).outcome]++;
    }
    return Object.entries(t).sort((a, b) => b[1].n - a[1].n);
  };
  const tax = taxonomy();
  const lat = labels.map((l) => R(l).latency_ms).filter((x): x is number => x != null);
  const div = opts.latencyUnit === "min" ? 60_000 : 1;
  const nm = "not measurable from these labels";

  return {
    n: labels.length,
    provisional: labels.filter((l) => l.provisional).length,
    outcomes,
    items: items.length,
    views,
    headline: views[0],
    silent_miss_count: views[0].silent,
    inquiry_recall: views[0].recall,
    display_precision_any_request: rate(items.filter((l) => l.consensus.wide === "inquiry").length, items.length),
    display_precision_b42: rate(items.filter(b42).length, items.length),
    review_rate: rate(items.filter((l) => R(l).outcome === "listed").length, items.length),
    none_precision: rate(proposingNew.filter(noneLabel).length, proposingNew.length),
    none_recall: rate(noneLabelled.filter((l) => SHOWN(card(l).outcome) && card(l).proposes_new).length, noneLabelled.length),
    read_together_reached: labels.filter((l) => R(l).carried_by && SHOWN(card(l).outcome)).length,
    item_correctness: `${nm}: no reader recorded which order an email is about`,
    action_accuracy: `${nm}: needs the correct order first`,
    client_resolution_accuracy: `${nm}: no reader recorded the client`,
    recall_at_5: `${nm}: the system stores no candidate list (plan.ts:41-50), and no label names the true order`,
    selection_given_correct_candidate: `${nm}: as recall@5`,
    suppression,
    none_by_judgment: noneByJudgment,
    reason_codes: codes,
    latency: { unit: opts.latencyUnit, n: lat.length, p50: percentile(lat.map((x) => x / div), 50), p95: percentile(lat.map((x) => x / div), 95) },
    cost: opts.cost,
    buckets_by_ask: byBucket(bucketOf),
    buckets_by_taxonomy: byBucket((l) => tax.get(l.message_id)?.bucket ?? null),
  };
}

const fmt = (x: number | null, unit: string) => (x == null ? "n/a" : unit === "min" ? `${x.toFixed(1)} min` : `${Math.round(x)} ms`);
const table = (rows: [string, Count][]) =>
  ["| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |", "|---|---|---|---|---|---|---|",
    ...rows.map(([k, c]) => `| ${k} | ${c.n} | ${c.none} | ${c["needs-reply"]} | ${c.listed} | ${c.check} | ${c.none + c["needs-reply"]} |`)].join("\n");

export function markdown(s: Scored, head: { mode: string; set: string; git: string; dataset: string; labels: string; split: string; extra?: string[] }): string {
  const L: string[] = [];
  L.push(`### ${head.mode}, ${head.set} set`, "");
  L.push(`git ${head.git} · dataset ${head.dataset} · labels ${head.labels} · test-set hash ${head.split}`, ...(head.extra ?? []), "");
  L.push(`Emails ${s.n} (provisional ${s.provisional}). Outcomes: none ${s.outcomes.none}, needs-reply ${s.outcomes["needs-reply"]}, listed ${s.outcomes.listed}, check ${s.outcomes.check}. Items shown ${s.items}.`, "");
  L.push("| metric | value |", "|---|---|");
  L.push(`| **silent_miss_count** (B42) | **${s.silent_miss_count}** |`);
  L.push(`| inquiry_recall (B42) | ${s.inquiry_recall} |`);
  for (const v of s.views.slice(1)) L.push(`| inquiry_recall, ${v.name} | ${v.recall}; silent ${v.silent} |`);
  L.push(`| item_correctness | ${s.item_correctness} |`);
  L.push(`| review_rate (listed ÷ items) | ${s.review_rate} |`);
  L.push(`| display_precision (any request, both readers) | ${s.display_precision_any_request} |`);
  L.push(`| display_precision (B42 inquiry) | ${s.display_precision_b42} |`);
  L.push(`| client_resolution_accuracy | ${s.client_resolution_accuracy} |`);
  L.push(`| recall@5 | ${s.recall_at_5} |`);
  L.push(`| selection_given_correct_candidate | ${s.selection_given_correct_candidate} |`);
  L.push(`| none_precision (items proposing a new order, NONE label) | ${s.none_precision} |`);
  L.push(`| none_recall (NONE labels whose item proposes a new order) | ${s.none_recall} |`);
  L.push(`| action_accuracy | ${s.action_accuracy} |`);
  L.push(`| suppression_count by rule | ${Object.entries(s.suppression).map(([k, v]) => `${k} ${v}`).join("; ") || "0"} |`);
  L.push(`| read with a later email whose card is an item (reached, not silent) | ${s.read_together_reached} |`);
  L.push(`| none by reading or planner (not a rule) | ${Object.entries(s.none_by_judgment).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ")} |`);
  L.push(`| cost per email | ${s.cost} |`);
  L.push(`| latency p50 / p95 (n ${s.latency.n}) | ${fmt(s.latency.p50, s.latency.unit)} / ${fmt(s.latency.p95, s.latency.unit)} |`, "");
  L.push(`Silent misses (B42): ${s.headline.silent_ids.join(", ") || "none"}`, "");
  L.push("**reason_code by outcome**", "");
  for (const [o, c] of Object.entries(s.reason_codes)) L.push(`- ${o}: ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  L.push("", "**By what the readers say the email asks**", "", table(s.buckets_by_ask), "");
  L.push("**By failure-taxonomy bucket** (the live week's 117 bucketed rows; production's own misses)", "", table(s.buckets_by_taxonomy), "");
  return L.join("\n");
}
