// ============================================================================
// Pick what to adjudicate, and render it for reading.
// ----------------------------------------------------------------------------
// The test set (scripts/build-testset.ts) has 638 live threads and no truth column.
// OnSinch cannot supply one: 105 of the 133 orders the engine created are already
// DELETED from the tenant, and everything it created before 2026-09-14 is gone. So
// "is the order still there?" answers a question about staff housekeeping, not about
// whether the engine was right. Truth has to come from reading the mail.
//
// Reading all 638 is not the bottleneck worth paying — the interesting tail is. So
// this stratifies:
//
//   new-job          the case the engine exists to handle; every mechanism fires
//   update           where the 1% linking bar lives
//   confirmation-only  a missed amendment hides here, read as "nothing to do"
//   not-a-job        FALSE NEGATIVES. A job dropped here is a 100% end-to-end miss
//                    and appears in no other metric. Job-shaped ones are drawn first:
//                    a subject naming crew, a count, a venue or a date.
//
// Sampling is a SEEDED SHUFFLE, never a stride. An index-arithmetic corpus aliases
// under a stride and the sample stops being random in exactly the dimension being
// measured.
//
// Nothing here decides anything. It prints threads and the engine's claims side by
// side; the verdict is written by hand into data/testset/truth.jsonl, one JSON object
// per line:
//
//   {"thread_id":"...","verdict":"correct|wrong|hard-gate","mechanism":"venue",
//    "should_be":"...","note":"why"}
//
//   npx tsx scripts/sample-testset.ts                     # default spread, to sample.md
//   npx tsx scripts/sample-testset.ts --n 40 --stratum new-job
//   npx tsx scripts/sample-testset.ts --unjudged          # skip what truth.jsonl covers
// ============================================================================
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./_env.mjs";

const DIR = join(ROOT_DIR, "data", "testset");
const argv = process.argv.slice(2);
const num = (f: string, d: number) => { const i = argv.indexOf(f); return i < 0 ? d : Number(argv[i + 1]) || d; };
const str = (f: string) => { const i = argv.indexOf(f); return i < 0 ? null : argv[i + 1]; };
const UNJUDGED = argv.includes("--unjudged");

/** mulberry32 — a small deterministic PRNG, so the same seed picks the same threads. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: T[], seed: number): T[] {
  const r = rng(seed), a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Does this thread look like someone asking for crew? Used only to ORDER the
 *  not-a-job draw, never to decide anything. */
function jobShaped(t: any): boolean {
  const text = `${t.subject ?? ""} ${(t.messages || []).filter((m: any) => !m.is_from_spartan).map((m: any) => m.body).join(" ")}`.slice(0, 4000);
  const crew = /\b(\d+)\s*(x\s*)?(crew|men|guys|people|staff|techs?|hands|riggers?|loaders?)\b/i.test(text)
    || /\b(crew|staff|riggers?|labour)\s+(request|required|needed|for)\b/i.test(text);
  const when = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b\d{1,2}(st|nd|rd|th)\b|\b\d{1,2}[\/-]\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(text);
  const hours = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/i.test(text);
  return crew && (when || hours);
}

const rows = readFileSync(join(DIR, "threads.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const judged = new Set<string>();
const truthPath = join(DIR, "truth.jsonl");
if (existsSync(truthPath)) {
  for (const l of readFileSync(truthPath, "utf8").split("\n")) {
    if (l.trim()) { try { judged.add(JSON.parse(l).thread_id); } catch { /* a half-written line is not fatal */ } }
  }
}

const pool = UNJUDGED ? rows.filter((r) => !judged.has(r.thread_id)) : rows;
const SEED = num("--seed", 20260915);

// Default spread. new-job and update are drawn hardest because that is where every
// mechanism downstream of classification actually runs.
const WANT: Record<string, number> = { "new-job": num("--n", 30), "update": num("--n", 30), "confirmation-only": Math.round(num("--n", 30) / 2), "not-a-job": num("--n", 30) };
const only = str("--stratum");

const picked: any[] = [];
for (const [stratum, n] of Object.entries(WANT)) {
  if (only && stratum !== only) continue;
  let inStratum = pool.filter((r) => (r.engine.classification ?? "(null)") === stratum);
  if (stratum === "not-a-job") {
    // Job-shaped first, then the rest — a false negative is worth more reader time
    // than the ninetieth payment notification.
    const shaped = shuffled(inStratum.filter(jobShaped), SEED);
    const rest = shuffled(inStratum.filter((r) => !jobShaped(r)), SEED + 1);
    inStratum = [...shaped, ...rest];
  } else {
    inStratum = shuffled(inStratum, SEED);
  }
  picked.push(...inStratum.slice(0, n).map((r) => ({ ...r, _stratum: stratum })));
}

const lines: string[] = [];
lines.push(`# Adjudication sample — ${picked.length} thread(s), seed ${SEED}${UNJUDGED ? ", unjudged only" : ""}`);
lines.push("");
lines.push("Write one line per thread into `data/testset/truth.jsonl`:");
lines.push('`{"thread_id":"…","verdict":"correct|wrong|hard-gate","mechanism":"classification|dates|venue|company|identity|shape|amendability|labels|intake","should_be":"…","note":"…"}`');
lines.push("");
for (const t of picked) {
  const e = t.engine;
  lines.push(`\n---\n## ${t.thread_id}  [${t._stratum}]`);
  lines.push(`**${t.subject ?? "(no subject)"}**  — ${t.n_messages} msg (${t.n_inbound} inbound), ${String(t.first_date).slice(0, 10)} → ${String(t.last_date).slice(0, 10)}`);
  lines.push("");
  lines.push("### the mail");
  for (const m of t.messages) {
    const who = m.is_from_spartan ? "SPARTAN" : (m.from || "?");
    const body = String(m.body || "").replace(/\s+/g, " ").trim().slice(0, 1200);
    lines.push(`- \`${String(m.date_iso).slice(0, 16)}\` **${who}** — ${String(m.subject || "").slice(0, 80)}`);
    lines.push(`  > ${body}${String(m.body || "").length > 1200 ? " …" : ""}`);
  }
  lines.push("");
  lines.push("### what the engine decided");
  lines.push(`- classification **${e.classification}**, status **${e.status}**, cancellation=${e.cancellation}, needs_human=${e.needs_human}, built_flagged=${e.built_flagged}`);
  lines.push(`- company: \`${e.company_name ?? "—"}\` → id ${e.company_id ?? "—"}`);
  lines.push(`- venue:   \`${e.location_text ?? "—"}\` → place ${e.place_id ?? "—"}`);
  lines.push(`- requests: ${JSON.stringify(e.requests)}`);
  if (e.slot_teams?.length) lines.push(`- blocks sent: ${e.slot_teams.map((s: any) => `${s.size}x ${s.name} ${String(s.beginning).slice(0, 16)}→${String(s.end).slice(11, 16)} @place ${s.place_id}`).join(" | ")}`);
  if (e.gate_reason) lines.push(`- gate: ${e.gate_reason}`);
  if (e.notes?.length) for (const n of e.notes) lines.push(`- note: ${String(n).slice(0, 400)}`);
  lines.push(`- actions: ${(e.order_action_log || []).map((a: any) => `${a.kind}${a.ok === false ? "!" : ""}`).join(" > ") || "(none)"}  order ${e.onsinch_order_id ?? "—"}${t.onsinch_missing ? " **DELETED FROM ONSINCH**" : ""}`);
  if (t.onsinch) lines.push(`- OnSinch now: #${t.onsinch.number} ${t.onsinch.status_name}, job span ${t.onsinch.job_min_beginning ?? "—"} → ${t.onsinch.job_max_end ?? "—"}, spec: ${String(t.onsinch.specification ?? "").slice(0, 160)}`);
}

const out = join(DIR, "sample.md");
writeFileSync(out, lines.join("\n"), "utf8");
const byStratum: Record<string, number> = {};
for (const t of picked) byStratum[t._stratum] = (byStratum[t._stratum] || 0) + 1;
console.log(`data/testset/sample.md — ${picked.length} thread(s)`);
for (const [k, v] of Object.entries(byStratum)) console.log(`   ${k.padEnd(20)} ${v}`);
console.log(`already judged: ${judged.size}`);
