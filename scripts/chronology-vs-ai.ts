// ============================================================================
// Q5: does the AI step replace the chronology rule, or sit on top of it?
// ----------------------------------------------------------------------------
// Ben asked for a test rather than a ruling. This is it, and it costs nothing —
// it reads .tmp-data/labelled-corpus.json (npx tsx scripts/pull-labelled-corpus.ts)
// and calls no model.
//
// THE CHRONOLOGY RULE, as the original hand-written spec stated it: "the oldest message in
// the thread is the creation event; every later message, the current one included,
// is a modification." As a classifier that is one line — a thread of one message is
// a new job, a thread of more is an update — so it can be scored directly against
// the engine's own labels over the same threads.
//
// WHAT THE LABELS ARE. They are the engine's brain over the swept corpus, not a
// human's verdict. So this measures AGREEMENT, not accuracy, and every disagreement
// is written out for a human to adjudicate rather than being scored as an AI win.
// The one thing it does establish outright is coverage: whether the chronology rule
// can express the answer at all.
//
// Run: npx tsx scripts/chronology-vs-ai.ts
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";

interface Row {
  thread_id: string;
  subject: string | null;
  message_count: number;
  model: string;
  classification: string | null;
  is_cancellation: boolean;
}

const rows = JSON.parse(readFileSync(".tmp-data/labelled-corpus.json", "utf8")) as Row[];

// One row per thread. Where several models labelled the same thread, their agreement
// is worth knowing on its own — a rule cannot be held to a standard the labels
// themselves do not meet.
const byThread = new Map<string, Row[]>();
for (const r of rows) byThread.set(r.thread_id, [...(byThread.get(r.thread_id) ?? []), r]);
const contested = [...byThread.values()].filter((v) => v.length > 1);
const modelsDisagree = contested.filter((v) => new Set(v.map((r) => r.classification)).size > 1);
/**
 * A thread's label is the MAJORITY of the models that read it, not whichever row
 * the query returned first: with a fifth of the contested threads split, picking
 * arbitrarily would put that disagreement straight into the score being reported.
 * A genuine tie is dropped rather than broken — an undecidable thread cannot be
 * evidence about a rule.
 */
const threads = [...byThread.values()].map((v) => {
  const votes = new Map<string, number>();
  for (const r of v) votes.set(r.classification ?? "(none)", (votes.get(r.classification ?? "(none)") ?? 0) + 1);
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const tied = ranked.length > 1 && ranked[0][1] === ranked[1][1];
  return { ...v[0], classification: tied ? null : ranked[0][0], tied };
}).filter((t) => !t.tied);
const dropped = byThread.size - threads.length;
if (dropped) console.log(`${dropped} threads dropped: the models split evenly and there is no majority label`);

/** The chronology rule as a classifier. It has exactly two answers. */
const chronology = (t: Row) => (t.message_count > 1 ? "update" : "new-job");

console.log(`\n${rows.length} labels over ${byThread.size} threads`);
if (contested.length) {
  console.log(`${contested.length} threads carry more than one model's label; ${modelsDisagree.length} of those disagree ` +
    `(${((modelsDisagree.length / contested.length) * 100).toFixed(0)}%) — the ceiling any rule can be held to here`);
}

// ---------------------------------------------------------------- coverage
// The question is not only who is right. It is whether the chronology rule can say
// the thing at all.
const JOB_CLASSES = new Set(["new-job", "update"]);
const jobs = threads.filter((t) => JOB_CLASSES.has(t.classification ?? ""));
const outOfReach = threads.filter((t) => t.classification && !JOB_CLASSES.has(t.classification));

console.log(`\n[coverage] the chronology rule answers new-job vs update and nothing else`);
const byClass = new Map<string, number>();
for (const t of threads) byClass.set(t.classification ?? "(none)", (byClass.get(t.classification ?? "(none)") ?? 0) + 1);
for (const [k, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
  const reach = JOB_CLASSES.has(k) ? "in reach" : "OUT OF REACH — chronology has no answer";
  console.log(`  ${k.padEnd(20)} ${String(n).padStart(4)}   ${reach}`);
}
console.log(`  ${outOfReach.length} of ${threads.length} threads (${((outOfReach.length / threads.length) * 100).toFixed(0)}%) ` +
  `are neither a new job nor an update, so no chronology rule can classify them.`);

// ---------------------------------------------------------------- agreement
console.log(`\n[agreement] over the ${jobs.length} threads that ARE a job`);
const cell = (ai: string, chrono: string) => jobs.filter((t) => t.classification === ai && chronology(t) === chrono).length;
console.log(`                      chronology says`);
console.log(`                      new-job   update`);
for (const ai of ["new-job", "update"]) {
  console.log(`  AI says ${ai.padEnd(10)} ${String(cell(ai, "new-job")).padStart(7)} ${String(cell(ai, "update")).padStart(8)}`);
}
const agree = jobs.filter((t) => t.classification === chronology(t)).length;
console.log(`  agree on ${agree} of ${jobs.length} (${((agree / jobs.length) * 100).toFixed(1)}%)`);

// ---------------------------------------------------------------- what it costs
// The two disagreements are not the same mistake and must not be averaged.
const missedUpdate = jobs.filter((t) => t.classification === "update" && chronology(t) === "new-job");
const falseUpdate = jobs.filter((t) => t.classification === "new-job" && chronology(t) === "update");
console.log(`\n[the two disagreements are not the same mistake]`);
console.log(`  ${missedUpdate.length} threads: AI update, chronology new-job — a single-message thread that changes a booked job.`);
console.log(`     Following chronology here DOUBLE-BOOKS: a second order for a job that already exists.`);
console.log(`  ${falseUpdate.length} threads: AI new-job, chronology update — a conversation that ends in a NEW booking.`);
console.log(`     Following chronology here attaches a new job to an old one, or finds nothing to attach to.`);

const OUT = ".tmp-data/chronology-disagreements.json";
writeFileSync(OUT, JSON.stringify(
  [...missedUpdate.map((t) => ({ ...t, ai: t.classification, chronology: "new-job" })),
   ...falseUpdate.map((t) => ({ ...t, ai: t.classification, chronology: "update" }))], null, 1));
console.log(`\n  ${missedUpdate.length + falseUpdate.length} disagreements -> ${OUT} (subjects below, for adjudication)`);
for (const t of [...missedUpdate, ...falseUpdate].slice(0, 12)) {
  console.log(`    [${t.message_count} msg] AI:${t.classification} chrono:${chronology(t)}  ${(t.subject || "(no subject)").slice(0, 62)}`);
}
