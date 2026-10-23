// ============================================================================
// Which evidence, when present, is never wrong? The search behind the matcher's deterministic
// rules (plan: "Deterministic rules and the confirmation step"). A rule names the order it points
// at, and Astra confirms it; it is promoted only with 300 or more gold cases and none wrong
// (about 99% at 95% confidence), and Ben approves the list.
// ----------------------------------------------------------------------------
// Reads .tmp-data/gold/features.jsonl. A candidate is right when it is one of the email's gold
// orders. Every level of every family is a condition, and so is "[only one]": the only candidate
// of the email showing that level. Rules are single conditions and pairs.
// Two denominators, because a rule must not be graded by the signal that made its label: ALL firm
// labels (strong, medium, adjudicated), and INDEPENDENT ones (adjudicated by hand, or resting on a
// staff action on a day the email names, which no reference or person signal produced).
//
//   npx tsx scripts/gold/rules.mts [--dir .tmp-data/gold] [--min 25] [--measure]
// ============================================================================
import { readFileSync } from "node:fs";
import { FAMILIES } from "../../app/lib/match/match";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir", ".tmp-data/gold");
const MIN = Number(arg("--min", "25"));
const PROMOTE = 300;
const STAFF = /^staff (created|acted on|last changed) it \(day match\)$/;

type Cand = { y: 0 | 1; keys: string[]; independent: boolean };
const cands: Cand[] = [];
let emails = 0, independentEmails = 0;
for (const line of readFileSync(`${DIR}/features.jsonl`, "utf8").trim().split("\n")) {
  const r = JSON.parse(line);
  const L = r.label;
  if (!["strong", "medium", "adjudicated"].includes(L.confidence) || L.kind === "unsure") continue;
  const truth = new Set<number>(L.kind === "not-a-job" || (L.confidence === "adjudicated" && L.kind === "new-job") ? [] : L.candidates.filter((c: any) => L.orders.includes(c.id) && !c.new).map((c: any) => c.id));
  const independent = L.confidence === "adjudicated" || L.candidates.some((c: any) => L.orders.includes(c.id) && c.sig.some((s: string) => STAFF.test(s)));
  emails++; if (independent) independentEmails++;
  const count = new Map<string, number>();
  for (const c of r.candidates) for (const f of FAMILIES) if (c.cmp[f]) count.set(`${f}=${c.cmp[f]}`, (count.get(`${f}=${c.cmp[f]}`) ?? 0) + 1);
  for (const c of r.candidates) {
    const keys: string[] = [];
    for (const f of FAMILIES) if (c.cmp[f]) { const k = `${f}=${c.cmp[f]}`; keys.push(k); if (count.get(k) === 1) keys.push(`${k} [only one]`); }
    if (r.candidates.length === 1) keys.push("the only candidate");
    cands.push({ y: truth.has(c.order_id) ? 1 : 0, keys: [...new Set(keys)], independent });
  }
}

const wilsonLo = (k: number, n: number, z = 1.96) => { if (!n) return 0; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return (c - s) / d; };
type Stat = { all: [number, number]; ind: [number, number] };
const stats = new Map<string, Stat>();
const bump = (k: string, c: Cand) => { const s = stats.get(k) ?? { all: [0, 0], ind: [0, 0] }; s.all[c.y]++; if (c.independent) s.ind[c.y]++; stats.set(k, s); };
for (const c of cands) for (let i = 0; i < c.keys.length; i++) { bump(c.keys[i], c); for (let j = i + 1; j < c.keys.length; j++) bump([c.keys[i], c.keys[j]].sort().join("  AND  "), c); }

type Rule = { rule: string; right: number; wrong: number; lower: number; indRight: number; indWrong: number };
const rules: Rule[] = [...stats].map(([rule, s]) => ({ rule, right: s.all[1], wrong: s.all[0], lower: wilsonLo(s.all[1], s.all[0] + s.all[1]), indRight: s.ind[1], indWrong: s.ind[0] }));
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log(`firm-labelled emails ${emails} (independent ${independentEmails}); candidate rows ${cands.length}`);

const promotable = rules.filter((r) => r.wrong === 0 && r.right >= PROMOTE).sort((a, b) => b.right - a.right);
console.log(`\nPROMOTABLE (0 wrong, ${PROMOTE}+ cases): ${promotable.length}`);
for (const r of promotable.slice(0, 20)) console.log(`  ${r.right} right, 0 wrong (lower ${pct(r.lower)}; independent ${r.indRight}/${r.indRight + r.indWrong})  ${r.rule}`);

console.log(`\nZERO-ERROR, ${MIN}+ cases, not yet ${PROMOTE} (candidates to watch):`);
for (const r of rules.filter((x) => x.wrong === 0 && x.right >= MIN && x.right < PROMOTE).sort((a, b) => b.right - a.right).slice(0, 15)) console.log(`  ${r.right} right (lower ${pct(r.lower)}; independent ${r.indRight}/${r.indRight + r.indWrong})  ${r.rule}`);

console.log(`\nNEAR (1 to 3 wrong, ${PROMOTE}+ cases), by lower bound: what stops each from being absolute`);
for (const r of rules.filter((x) => x.wrong >= 1 && x.wrong <= 3 && x.right + x.wrong >= PROMOTE).sort((a, b) => b.lower - a.lower).slice(0, 15)) console.log(`  ${r.right} right, ${r.wrong} wrong (lower ${pct(r.lower)})  ${r.rule}`);

const named = ["reference=R or J in the newest words", "reference=R or J in the newest words [only one]", "reference=PO in the newest words [only one]", "reference=R or J in the subject [only one]", "person=sender is the contact [only one]", "thread=linked", "thread=an earlier email here was about it [only one]", "the only candidate"];
console.log("\nTHE OBVIOUS ONES:");
for (const k of named) { const r = rules.find((x) => x.rule === k); if (r) console.log(`  ${r.right} right, ${r.wrong} wrong (${pct(r.right / (r.right + r.wrong))})  ${k}`); }

if (process.argv.includes("--measure")) {
  const { recordMeasurement } = await import("../_gateMeasure.mjs");
  recordMeasurement("matcher_rule_search", {
    dataset: `gold set v1 firm labels incl. 147 adjudicated: ${emails} emails, ${cands.length} candidate rows`,
    instrument: "scripts/gold/rules.mts",
    denominator: "candidate rows showing the rule's conditions; right = a gold order of the email",
    promote_bar: `${PROMOTE} cases, 0 wrong`, promotable: promotable.length,
    best: promotable.slice(0, 5).map((r) => ({ rule: r.rule, right: r.right })),
    obvious: Object.fromEntries(named.map((k) => { const r = rules.find((x) => x.rule === k); return [k, r ? `${r.right} right, ${r.wrong} wrong` : "absent"]; })),
  });
}
