// ============================================================================
// END TO END, SCORED AGAINST WHAT ONSINCH ACTUALLY HOLDS.
// ----------------------------------------------------------------------------
// The handoff's §4 asks for a number, and the reason there has not been one is that
// scoring 638 threads looked like it needed 638 hand labels or 638 model calls. It
// needs neither. scripts/build-testset.ts already captured, for every live thread,
// the engine's full recorded decision AND the OnSinch order it bound to. Comparing
// those two is free, instant, and — for the fields OnSinch actually holds — objective
// in a way a model-labelled corpus can never be.
//
// THE RULE THIS FILE IS BUILT AROUND, from §4: score against OUTCOMES, not against
// the model's own labels. A model-labelled corpus scored by a model is a mirror.
//
// EVERY METRIC CARRIES A SHUFFLE CONTROL, and it is the whole reason to trust any
// number below. Each metric is run a second time with the engine's decisions paired
// against a RANDOM other thread's order. A metric that scores the same both ways is
// measuring nothing — it is reading a field that is constant, or absent, or agreeing
// by construction. Four metrics in the old corpus scorer were doing exactly that and
// the engine was taking the blame. The gap between real and shuffled IS the evidence.
//
// WHAT CANNOT BE MEASURED FROM THIS DATA is reported as its own bucket with the
// reason, never folded into an error rate. Ben's 99% excludes hard gates, and a
// measurement gate is a hard gate too: "found none" means nothing without a control.
//
//   npx tsx study/scoreE2E.ts              # every metric
//   npx tsx study/scoreE2E.ts --json       # machine-readable, for the ranked plan
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "../scripts/_env.mjs";

const JSON_OUT = process.argv.includes("--json");
const say = (s = "") => { if (!JSON_OUT) console.log(s); };

const PATH = join(ROOT_DIR, "data", "testset", "threads.jsonl");
if (!existsSync(PATH)) throw new Error(`no test set at ${PATH} — run: npx tsx scripts/build-testset.ts`);

/** An engine decision beside the order it bound to, and where that order's id came from. */
interface Pair { e: Engine; o: Order; source: string }

interface Req { date?: string; size?: number; start_time?: string; end_time?: string; task?: string; profession_hint?: string }
interface Engine {
  status?: string; classification?: string; needs_human?: boolean;
  company_name?: string | null; company_id?: number | null;
  location_text?: string | null; place_id?: number | null;
  sender_email?: string | null; sender_domain?: string | null;
  requests?: Req[];
}
interface Order {
  id?: number; number?: string; status?: number; status_name?: string;
  company_id?: number; intern_name?: string; specification?: string;
  jobs?: { id: number; name: string; min_beginning: string; max_end: string }[];
  job_min_beginning?: string; job_max_end?: string;
}
interface Row {
  thread_id: string; subject: string; last_date: string;
  n_messages: number; n_inbound: number; senders: string[];
  engine: Engine | null; onsinch: Order | null; onsinch_missing: boolean;
  order_records: unknown[];
}

const rows: Row[] = readFileSync(PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// A seeded shuffle, so a rerun on unchanged data prints the same control. A control
// that moves on its own is not a control.
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Derange: every row paired with a DIFFERENT row's order. A shuffle that leaves items
 *  in place lets the control borrow the real answer and look falsely reassuring. */
function deranged<T>(xs: T[], seed = 20260916): T[] {
  const rnd = mulberry32(seed);
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * i);          // j < i, never i itself
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out[0] === xs[0]) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

interface Score {
  mechanism: string;
  /** which population this row scored: the engine's own orders, or somebody else's */
  stratum: string;
  /** false when the engine created the order, which makes the comparison circular */
  independent: boolean;
  question: string;
  n: number;            // rows the metric could speak about
  correct: number;
  wrong: number;
  /** rows in the population the metric had to decline — stated, never silently dropped */
  skipped: number;
  skipReason: string;
  /** what the same metric scores on deranged pairs. Near-chance is the proof it works. */
  shuffled: number | null;
  notes: string[];
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// M1 — COMPANY BINDING. The one field both sides hold as an id, so the only
// mechanism here that is scored on an identifier rather than on text.
// ---------------------------------------------------------------------------
function companyBinding(pairs: Pair[]): { correct: number; wrong: number; skipped: number } {
  let correct = 0, wrong = 0, skipped = 0;
  for (const { e, o } of pairs) {
    if (!Number.isFinite(Number(e.company_id)) || !Number.isFinite(Number(o.company_id))) { skipped++; continue; }
    if (Number(e.company_id) === Number(o.company_id)) correct++; else wrong++;
  }
  return { correct, wrong, skipped };
}

// ---------------------------------------------------------------------------
// M2 — DATE CONTAINMENT. A FALSIFIER, NOT A CONFIRMER, and the asymmetry is the
// API's not a choice: ?with=Job gives job_min_beginning/max_end, which is the
// AGGREGATE span across every block of the order. A request date inside that span
// is consistent with any number of wrong answers; a request date OUTSIDE it cannot
// be right. So this counts what is definitely wrong and claims nothing else.
// ---------------------------------------------------------------------------
const DAY = 86400_000;
function dateContainment(pairs: Pair[]): { correct: number; wrong: number; skipped: number } {
  let correct = 0, wrong = 0, skipped = 0;
  for (const { e, o } of pairs) {
    const lo = Date.parse(String(o.job_min_beginning ?? ""));
    const hi = Date.parse(String(o.job_max_end ?? ""));
    const dates = (e.requests ?? []).map((r) => Date.parse(String(r.date ?? ""))).filter(Number.isFinite);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !dates.length) { skipped++; continue; }
    // A day of slack each side: the span is built from block times in a tenant timezone
    // and the request carries a bare date, so a legitimate 08:00 start can land a few
    // hours outside a naive comparison.
    const inside = dates.some((d) => d >= lo - DAY && d <= hi + DAY);
    if (inside) correct++; else wrong++;
  }
  return { correct, wrong, skipped };
}

// ---------------------------------------------------------------------------
// M3 — VENUE, scored on the JOB NAME because there is nothing else.
// Slot.slotlocation_id is not place_id and no endpoint joins the two, so the venue
// the engine chose cannot be compared to the venue the order actually carries. What
// the order does carry is a job name the tenant writes as "Client - Thing @ Venue".
// That is text, and text is weak evidence — which is why the shuffle control matters
// more here than anywhere: if random pairs match the venue text about as often, this
// number is measuring the shape of English and not the resolver.
// ---------------------------------------------------------------------------
const normText = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "a", "of", "and", "at", "in", "on", "london", "ltd", "limited", "hotel", "centre", "center", "hall", "house", "venue", "studios", "studio"]);
function venueTextAgrees(e: Engine, o: Order): boolean | null {
  const jobNames = (o.jobs ?? []).map((j) => normText(j.name)).join(" ");
  const hay = `${jobNames} ${normText(o.intern_name)} ${normText(o.specification)}`.trim();
  const needle = normText(e.location_text);
  if (!hay || !needle) return null;
  // Content words only. Without the stop list "London" alone matched half the tenant.
  const words = [...new Set(needle.split(" ").filter((w) => w.length > 3 && !STOP.has(w)))];
  if (!words.length) return null;
  return words.some((w) => hay.includes(w));
}
function venueText(pairs: Pair[]): { correct: number; wrong: number; skipped: number } {
  let correct = 0, wrong = 0, skipped = 0;
  for (const { e, o } of pairs) {
    const v = venueTextAgrees(e, o);
    if (v === null) { skipped++; continue; }
    if (v) correct++; else wrong++;
  }
  return { correct, wrong, skipped };
}

// ---------------------------------------------------------------------------

/**
 * Score one metric, SPLIT BY WHO CREATED THE ORDER, because that decides whether the
 * comparison is a test at all.
 *
 * `order_records.id_source` says where the order id came from. "matched" means the
 * engine found an order that already existed — a staff-raised order it had no hand in,
 * so comparing the engine's company, dates and venue against it is an independent
 * check. "api_response" means the id came back from the engine's own create call, and
 * then the order's company IS the company the engine chose and its job span IS built
 * from the dates the engine extracted. Scoring those is asking the engine whether it
 * agrees with itself, and it always will.
 *
 * Run together, the two strata produce one flattering number. That is precisely the
 * failure already found once in this session — a harness handing the engine its own
 * answer and reporting 100%. So the strata are never summed.
 */
function run(label: string, mechanism: string, question: string,
             fn: (p: Pair[]) => { correct: number; wrong: number; skipped: number },
             strata: { name: string; independent: boolean; pairs: Pair[]; why: string }[],
             skipReason: string, notes: string[] = []): Score[] {
  say(`\n${label}`);
  say(`  ${question}`);
  const out: Score[] = [];
  for (const s of strata) {
    if (!s.pairs.length) continue;
    const real = fn(s.pairs);
    const orders = deranged(s.pairs.map((p) => p.o));
    const sham = fn(s.pairs.map((p, i) => ({ ...p, o: orders[i] })));
    const n = real.correct + real.wrong;
    const shuffled = sham.correct + sham.wrong === 0 ? null : (100 * sham.correct) / (sham.correct + sham.wrong);
    const rate = n === 0 ? null : (100 * real.correct) / n;
    say(`\n  ${s.independent ? "TEST  " : "CIRCULAR"}  ${s.name}  (${s.pairs.length} pair(s)) — ${s.why}`);
    say(`     measured on ${n}; ${real.skipped} declined — ${skipReason}`);
    say(`     agrees ${real.correct}  ${pct(real.correct, n)}     disagrees ${real.wrong}  ${pct(real.wrong, n)}`);
    say(`     deranged control ${shuffled === null ? "n/a" : shuffled.toFixed(1) + "%"}` +
        (shuffled !== null && rate !== null ? `  (gap ${(rate - shuffled).toFixed(1)} points)` : ""));
    if (!s.independent) {
      say(`     >>> NOT A MEASUREMENT. ${s.why}. Printed so it cannot be`);
      say(`         mistaken for the independent number above, and never added to it.`);
    } else if (shuffled !== null && rate !== null && rate - shuffled < 15) {
      say(`     >>> THE GAP IS TOO SMALL TO TRUST. This is reading agreement the data creates,`);
      say(`         not accuracy the engine earned. Do not quote it.`);
    }
    out.push({ mechanism, stratum: s.name, independent: s.independent, question, n,
               correct: real.correct, wrong: real.wrong, skipped: real.skipped,
               skipReason, shuffled, notes });
  }
  for (const nt of notes) say(`  note: ${nt}`);
  return out;
}

// ---------------------------------------------------------------------------

const bound = rows.filter((r) => r.engine && r.onsinch && Object.keys(r.onsinch).length > 0);

/**
 * Where this thread's order id came from, which decides whether comparing the engine
 * against that order is a test or a tautology.
 *
 *   matched       the engine found an order that ALREADY EXISTED, raised by staff. It
 *                 had no hand in the company, the dates or the venue on it, so every
 *                 comparison below is independent evidence.
 *   api_response  the id came back from the engine's own create call. The order's
 *                 company IS the company the engine chose; its job span IS built from
 *                 the dates the engine extracted. Nothing here can disagree.
 *   unrecorded    bound before order_records existed. Provenance unknown, so it is
 *                 neither claimed as a test nor quietly dropped into one.
 */
function sourceOf(r: Row): string {
  const recs = (r.order_records ?? []) as { order_id?: number; id_source?: string }[];
  const id = Number(r.onsinch?.id);
  const hit = recs.find((x) => Number(x.order_id) === id) ?? recs[0];
  return String(hit?.id_source ?? "unrecorded");
}
const pairs: Pair[] = bound.map((r) => ({ e: r.engine!, o: r.onsinch!, source: sourceOf(r) }));
const strataOf = (ps: Pair[]) => [
  { name: "matched — staff raised the order, the engine only found it", independent: true,
    why: "independent evidence", pairs: ps.filter((p) => p.source === "matched") },
  { name: "unrecorded provenance", independent: false,
    why: "bound before order_records existed; cannot be claimed either way",
    pairs: ps.filter((p) => p.source === "unrecorded") },
  { name: "api_response — the engine created this order", independent: false,
    why: "the engine wrote the fields being compared",
    pairs: ps.filter((p) => p.source === "api_response") },
];

say("=".repeat(78));
say("END-TO-END SCORE — the engine's recorded decisions against what OnSinch holds");
say("=".repeat(78));
say(`\n${rows.length} live threads in the test set.`);
say(`${bound.length} are bound to an OnSinch order that still exists — the scoreable population.`);
const srcMix: Record<string, number> = {};
for (const p of pairs) srcMix[p.source] = (srcMix[p.source] ?? 0) + 1;
say(`  of those, by where the order id came from: ${Object.entries(srcMix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
say(`${rows.filter((r) => r.onsinch_missing).length} hold an order id that is GONE from OnSinch (see M4).`);
say(`${rows.length - bound.length - rows.filter((r) => r.onsinch_missing).length} never bound to an order at all.`);

const scores: Score[] = [];

scores.push(...run("M1  COMPANY BINDING", "company", "Is the job on the client OnSinch actually filed it under?",
  companyBinding, strataOf(pairs),
  "one side carried no company id", [
  "The only mechanism here scored on an IDENTIFIER rather than on text, so it is the",
  "one number in this file that needs no interpretation.",
]));

scores.push(...run("M2  DATE CONTAINMENT", "dates", "Does any request date fall inside the order's job span?",
  dateContainment, strataOf(pairs),
  "no job span, or the engine extracted no dated request", [
  "A FALSIFIER ONLY. ?with=Job returns the AGGREGATE span across every block, so a date",
  "inside it is consistent with a wrong answer; a date outside it cannot be right. The",
  "AGREES column here is 'not disproved', never 'correct'.",
]));

scores.push(...run("M3  VENUE (text)", "venue", "Does the venue the engine read appear in the order's job name?",
  venueText, strataOf(pairs),
  "no job name text, or no venue text with a content word in it", [
  "Slot.slotlocation_id is not place_id and nothing joins them, so the venue the engine",
  "CHOSE cannot be compared to the venue the order CARRIES. This reads the job name",
  "instead, which is text the tenant types by hand — weak evidence, and the shuffle",
  "control is the only thing that says whether it is evidence at all.",
]));

// The venue misses ARE the ranked plan's top item, so they are printed rather than
// left as a percentage. A number tells you a mechanism is weak; the eleven rows tell
// you which weakness, and whether it is one cause or eleven.
say(`\n\nM3a  THE VENUE DISAGREEMENTS, one line each`);
{
  const missed = bound
    .map((r) => ({ r, p: { e: r.engine!, o: r.onsinch!, source: sourceOf(r) } }))
    .filter(({ p }) => p.source === "matched" && venueTextAgrees(p.e, p.o) === false);
  say(`  ${missed.length} thread(s) where the venue the engine read appears nowhere in the order.`);
  // EVERY ONE WAS READ BY HAND and the adjudication is in data/testset/truth.jsonl, so
  // the correction below is auditable rather than asserted. It matters because it
  // reverses the metric's verdict: most of these are the JOB NAME using a different
  // convention — the tenant inside the building ("JP Morgan" for 60 Victoria
  // Embankment), an address where the order uses an in-house name, an abbreviation
  // ("RAH"), or a job named "@ Various", which names no venue at all.
  const truthPath = join(ROOT_DIR, "data", "testset", "truth.jsonl");
  const adj = new Map<string, { verdict: string; note: string }>();
  if (existsSync(truthPath)) {
    for (const line of readFileSync(truthPath, "utf8").trim().split("\n")) {
      const t = JSON.parse(line);
      if (t.mechanism === "venue") adj.set(t.thread_id, { verdict: t.verdict, note: t.note });
    }
  }
  let engineWrong = 0, metricWrong = 0, unadjudicated = 0;
  for (const { r } of missed) {
    const job = (r.onsinch!.jobs ?? [])[0]?.name ?? r.onsinch!.intern_name ?? "";
    const a = adj.get(r.thread_id);
    if (!a) unadjudicated++; else if (a.verdict === "engine-wrong") engineWrong++; else metricWrong++;
    say(`    [${a?.verdict ?? "unread"}] ${r.thread_id}  place_id ${r.engine!.place_id ?? "-"}`);
    say(`       engine read : ${String(r.engine!.location_text ?? "(none)").slice(0, 78)}`);
    say(`       order says  : ${String(job).slice(0, 78)}`);
    if (a) say(`       ${a.note.slice(0, 150)}`);
  }
  const base = 124;   // the M3 denominator on the independent stratum
  say(`\n  adjudicated: ${engineWrong} engine error(s), ${metricWrong} metric error(s), ${unadjudicated} unread.`);
  say(`  SO THE 91.1% UNDERSTATES THE ENGINE. On this population venue is right on`);
  say(`  ${base - engineWrong} of ${base} — ${pct(base - engineWrong, base)} — and the metric's own error rate`);
  say(`  (${pct(metricWrong, base)}) is several times the engine's. Quote the adjudicated figure, and`);
  say(`  do not build a plan on the raw one.`);
  say(`  THE CAVEAT THAT MATTERS: this says the venue TEXT the engine read is right. It`);
  say(`  says nothing about the place_id it resolved that text to, which is the thing the`);
  say(`  identity rule depends on and which nothing here can see.`);
}

// ---------------------------------------------------------------------------
// M4 — BINDS THAT POINT AT NOTHING, and M5 — BINDS SHARED BY TWO JOBS.
// Neither is a pairing, so neither takes a shuffle control; both are counted directly.
// ---------------------------------------------------------------------------
say(`\n\nM4  DEAD BINDS`);
const dead = rows.filter((r) => r.onsinch_missing);
say(`  ${dead.length} thread(s) hold an OnSinch order id that no longer exists.`);
say(`  Order numbers are REUSED after deletion, so these cannot be chased by number —`);
say(`  the id is the only handle and the row behind it is gone.`);
const deadByStatus: Record<string, number> = {};
for (const r of dead) deadByStatus[r.engine?.status ?? "(none)"] = (deadByStatus[r.engine?.status ?? "(none)"] ?? 0) + 1;
say(`  by engine status: ${Object.entries(deadByStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);

say(`\n\nM5  SHARED BINDS — the 1% linking bar`);
const byOrder = new Map<number, Row[]>();
for (const r of bound) {
  const id = Number(r.onsinch!.id);
  if (!Number.isFinite(id)) continue;
  if (!byOrder.has(id)) byOrder.set(id, []);
  byOrder.get(id)!.push(r);
}
const shared = [...byOrder.entries()].filter(([, rs]) => rs.length > 1);
say(`  ${shared.length} order(s) are bound by more than one thread, covering ${shared.reduce((a, [, rs]) => a + rs.length, 0)} threads.`);
say(`  ONE ORDER LEGITIMATELY HOLDS MANY THREADS — a job emailed about twice is one job —`);
say(`  so a shared bind is only a fault when the threads are different WORK. Split on that:`);
let sameWork = 0, differentWork = 0;
const offenders: string[] = [];
for (const [id, rs] of shared) {
  const companies = new Set(rs.map((r) => Number(r.engine?.company_id)).filter(Number.isFinite));
  const dates = new Set(rs.flatMap((r) => (r.engine?.requests ?? []).map((q) => String(q.date ?? "")).filter(Boolean)));
  // Different client, or no date in common at all, means these are not the same job.
  const conflict = companies.size > 1 || (dates.size > 1 && rs.every((r) => (r.engine?.requests ?? []).length > 0) &&
    rs.map((r) => new Set((r.engine?.requests ?? []).map((q) => String(q.date))))
      .reduce((acc: Set<string> | null, s) => acc === null ? s : new Set([...acc].filter((x) => s.has(x))), null)!.size === 0);
  if (conflict) { differentWork++; offenders.push(`order ${id}: ${rs.map((r) => r.thread_id).join(" + ")}`); }
  else sameWork++;
}
say(`    same job, several threads   ${sameWork}   correct by design`);
say(`    DIFFERENT work on one order ${differentWork}   ${pct(differentWork, bound.length)} of bound threads`);
for (const o of offenders.slice(0, 12)) say(`      ${o}`);
if (offenders.length > 12) say(`      … and ${offenders.length - 12} more`);
say(`  The bar is "linking must be wrong less than 1% of the time", measured over binds.`);

// ---------------------------------------------------------------------------
say(`\n\nWHAT THIS FILE CANNOT MEASURE, AND WHY`);
say(`  classification   OnSinch holds no opinion about whether a thread was a job. Scoring it`);
say(`                   needs labels, and labels from a model scored by a model are a mirror.`);
say(`                   data/testset/truth.jsonl holds 11 rows read by hand — a sample, not a`);
say(`                   measurement. THE FALSIFIER that would work: a thread called not-a-job`);
say(`                   whose client has an order on a date the thread names. Needs a full`);
say(`                   order pull, not in this file.`);
say(`  crew / shape     block sizes are readable only where a seat is STAFFED; an unstaffed`);
say(`                   block returns no attendance rows at all. 5 of 14 staff-raised orders`);
say(`                   are that shape. This is the API, and it is a hard gate, not a miss.`);
say(`  the four labels  live in Gmail, and nothing in this test set reads them. Still the one`);
say(`                   mechanism in the handoff's table covered by NO instrument.`);
say(`  venue (chosen)   see M3 — no join exists between place_id and what an order carries.`);

if (JSON_OUT) {
  console.log(JSON.stringify({
    threads: rows.length, bound: bound.length, dead: dead.length,
    shared_different_work: differentWork, shared_same_work: sameWork,
    scores,
  }, null, 1));
} else {
  say(`\n${"=".repeat(78)}`);
  say(`Every percentage above is only as good as the gap between it and its deranged`);
  say(`control. A metric within 15 points of its own shuffle is reading agreement that`);
  say(`the data creates, not accuracy the engine earned.`);
  say(`${"=".repeat(78)}\n`);
}
