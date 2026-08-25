// ============================================================================
// Scoring the model-in-the-loop study.
// ----------------------------------------------------------------------------
//   npx tsx sim/corpus-real-report.ts [--json]
//
// Two columns, always: what the MODEL got wrong (it misread the email) and what the
// ENGINE got wrong (it mis-composed or mis-wrote what it was given). One blended
// "accuracy" number is unactionable — you cannot fix a number that could mean either.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRandomCases } from "./randomCases";

const OUT = join(import.meta.dirname, "..", ".tmp-data", "corpus-real");
const rows = readFileSync(join(OUT, "results.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const AS_JSON = process.argv.includes("--json");

/**
 * The cases, regenerated. The generator is SEEDED, so this is the same hundred emails the
 * run used — which is how the amended truth is recovered without having stored it: the
 * results file kept the original booking and the amendment's SHAPE, and a grow of "+3"
 * needs the case to say what the 3 was added to.
 */
const cases = new Map(buildRandomCases(100).map((c) => [c.id, c]));

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}% (${a}/${b})` : "n/a");
const say = (...a: unknown[]) => { if (!AS_JSON) console.log(...a); };

const truthCrew = (t: { blocks: { size: number }[] }) => t.blocks.reduce((n, b) => n + b.size, 0);
const dated = (r: { truth: { blocks: { date: string | null }[] } }) => r.truth.blocks.every((b) => b.date);

const scored = rows.filter((r) => r.new_?.score);
const withOrder = rows.filter((r) => r.new_?.order_id);
const amended = rows.filter((r) => r.amend_);
const undatedCases = rows.filter((r) => !dated(r));

// ------------------------------------------------------------------ extraction
const field = (name: keyof typeof scored[0]["new_"]["score"]) => scored.filter((r) => r.new_.score[name]).length;

say(`\n=== MODEL IN THE LOOP — ${rows.length} enquiries, ${amended.length} amended ===\n`);
say(`spend ....................... $${rows.reduce((n, r) => n + (r.spend?.usd ?? 0), 0).toFixed(2)}`);
say(`model calls ................. ${rows.reduce((n, r) => n + (r.spend?.calls ?? 0), 0)}`);
say(`median case time ............ ${Math.round([...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] / 1000)}s`);

say(`\n--- WHAT THE MODEL READ (extraction, first email)\n`);
say(`crew total correct .......... ${pct(field("crew_total"), scored.length)}`);
say(`date correct ................ ${pct(field("date"), scored.length)}`);
say(`times correct ............... ${pct(field("times"), scored.length)}`);
say(`roles in the right family ... ${pct(field("roles"), scored.length)}`);
// Reported beside the role figure and never folded into it. Booking general Crew for
// a rigger IS the right answer — the tenant has no such row — so the property worth
// measuring is whether it did so with somebody called.
say(`unknown trades called a human ${pct(field("role_abstained"), scored.length)}`);
say(`block count correct ......... ${pct(field("block_count"), scored.length)}`);
say(`venue matched an EXISTING row ${pct(field("venue"), scored.length)}`);

say(`\n--- WHAT THE ENGINE DID\n`);
say(`reached OnSinch as an order . ${pct(withOrder.length, rows.length)}`);
say(`held for a human ............ ${rows.filter((r) => r.new_?.status === "needs-info").length}`);
say(`staged for a click .......... ${rows.filter((r) => r.new_?.status === "proposed").length}`);
say(`errored ..................... ${rows.filter((r) => r.new_?.status === "error").length}`);
say(`classified new-job .......... ${pct(rows.filter((r) => r.new_?.classification === "new-job").length, rows.length)}`);
say(`undated cases held .......... ${pct(undatedCases.filter((r) => !r.new_?.order_id).length, undatedCases.length)}`);

// The headcount test is the one that costs money when it is wrong: it is checked against
// the composed order, so a right answer means the client's number survived extraction,
// the chief carve-out and the write.
const conserved = withOrder.filter((r) => r.new_.crew === truthCrew(r.truth)).length;
say(`headcount = client's number . ${pct(conserved, withOrder.length)}`);

say(`\n--- AMENDMENTS\n`);
const paths = new Map<string, number>();
for (const r of amended) {
  const p = r.amend_.path || "(nothing)";
  paths.set(p, (paths.get(p) ?? 0) + 1);
}
for (const [p, n] of [...paths.entries()].sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(3)}  ${p}`);
const inPlace = amended.filter((r) => /(^|,)amend(,|$)/.test(r.amend_.path || "")).length;
const rKept = amended.filter((r) => r.amend_.r_survived).length;
say(`\n  applied in place .......... ${pct(inPlace, amended.length)}`);
say(`  R number survived ......... ${pct(rKept, amended.length)}`);
{
  const want = (r: { id: string }) => {
    const t = cases.get(r.id)?.amend?.truth;
    return t ? t.blocks.reduce((n: number, b: { size: number }) => n + b.size, 0) : null;
  };
  const scoreable = amended.filter((r) => want(r) !== null && r.amend_.order_id);
  const right = scoreable.filter((r) => r.amend_.crew === want(r)).length;
  say(`  crew after amendment right  ${pct(right, scoreable.length)}`);
}

const byShape = new Map<string, { n: number; amend: number; replace: number; rKept: number }>();
for (const r of amended) {
  const k = String(r.amendShape);
  const e = byShape.get(k) ?? { n: 0, amend: 0, replace: 0, rKept: 0 };
  e.n++;
  if (/(^|,)amend(,|$)/.test(r.amend_.path || "")) e.amend++;
  if (/replace/.test(r.amend_.path || "")) e.replace++;
  if (r.amend_.r_survived) e.rKept++;
  byShape.set(k, e);
}
say(`\n  shape          n   in place  replaced  R kept`);
for (const [k, v] of [...byShape.entries()].sort()) {
  say(`  ${k.padEnd(13)} ${String(v.n).padStart(2)}   ${String(v.amend).padStart(8)}  ${String(v.replace).padStart(8)}  ${String(v.rKept).padStart(6)}`);
}

// ------------------------------------------------------------------ venues, in detail
say(`\n--- VENUES: what the client called it, and what the engine did with it\n`);
const venueRows = new Map<string, { n: number; matched: number; created: number }>();
for (const r of rows) {
  const k = String(r.truth.blocks[0].venue);
  const e = venueRows.get(k) ?? { n: 0, matched: 0, created: 0 };
  e.n++;
  if (r.new_?.score?.venue) e.matched++;
  if ((r.new_?.notes ?? []).some((n: string) => /new venue/.test(n))) e.created++;
  venueRows.set(k, e);
}
for (const [k, v] of [...venueRows.entries()].sort()) {
  say(`  ${k.padEnd(10)} n=${String(v.n).padStart(3)}  matched an existing row: ${String(v.matched).padStart(3)}  created a NEW place: ${String(v.created).padStart(3)}`);
}

// ------------------------------------------------------------------ dates
say(`\n--- DATES: a miss here is a booking on the wrong day, so which forms fail?\n`);
{
  const miss = rows.filter((r) => r.new_?.score && !r.new_.score.date);
  const forms = new Map<string, { n: number; example: string }>();
  for (const r of miss) {
    const line = String(r.body).split("\n").find((l: string) => /^-/.test(l)) || r.body.slice(0, 80);
    // The date as the client wrote it, classified by SHAPE rather than by content.
    const m = line.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}(st|nd|rd|th)\s+\w+|\w+\s+\d{1,2}(st|nd|rd|th)|\d{1,2}\s+\w{3}/i);
    const raw = m ? m[0] : "(none found on the line)";
    const shape = /\d{1,2}[./]\d{1,2}[./]\d{4}/.test(raw) ? "dd/mm/yyyy"
      : /\d{1,2}[./]\d{1,2}[./]\d{2}$/.test(raw) ? "d.m.yy"
      : /(st|nd|rd|th)\s+\w+/.test(raw) ? "1st March"
      : /\w+\s+\d{1,2}(st|nd|rd|th)/.test(raw) ? "March 1st"
      : /\d{1,2}\s+\w{3}/.test(raw) ? "1 Mar"
      : "other";
    const e = forms.get(shape) ?? { n: 0, example: raw };
    e.n++;
    forms.set(shape, e);
  }
  for (const [k, v] of [...forms.entries()].sort((a, b) => b[1].n - a[1].n)) {
    say(`  ${String(v.n).padStart(3)}  ${k.padEnd(12)} e.g. "${v.example}"`);
  }
  // And what it booked instead, which says whether the year or the day moved.
  for (const r of miss.slice(0, 6)) {
    const wanted = r.truth.blocks.find((b: { date: string | null }) => b.date)?.date;
    const got = (r.new_.facts?.requests ?? [])[0]?.date;
    say(`       ${r.id}: client said ${wanted}, engine read ${got ?? "nothing"}`);
  }
}

// ------------------------------------------------------------------ errors
say(`\n--- ERRORS AND HOLDS, by cause\n`);
const causes = new Map<string, { n: number; example: string }>();
const causeOf = (note: string) => {
  if (/no company name extracted/.test(note)) return "held: no company name in the email";
  if (/Name is too long/.test(note)) return "refused by OnSinch: job name over 80 chars";
  if (/Wrong end time/.test(note)) return "refused by OnSinch: shift crosses midnight";
  if (/Fill in correct location/.test(note)) return "refused by OnSinch: a block had no venue";
  if (/wagelist/.test(note)) return "refused by OnSinch: no wagelist for the rate card";
  if (/rate card/.test(note) && /CHECK IT/.test(note)) return "staged: rate card assumed";
  if (/new venue/.test(note)) return "created a new venue rather than matching one";
  if (/not recognised/.test(note)) return "role not recognised, booked as general crew";
  if (/by hand/.test(note)) return "amendment fell back to a human";
  return null;
};
for (const r of rows) {
  for (const n of [...(r.new_?.notes ?? []), ...(r.amend_?.notes ?? [])]) {
    const k = causeOf(n);
    if (!k) continue;
    const e = causes.get(k) ?? { n: 0, example: n };
    e.n++;
    causes.set(k, e);
  }
}
for (const [k, v] of [...causes.entries()].sort((a, b) => b[1].n - a[1].n)) {
  say(`${String(v.n).padStart(4)}  ${k}`);
  say(`      ${v.example.slice(0, 140)}`);
}

if (AS_JSON) {
  const out = {
    n: rows.length, amended: amended.length,
    spendUsd: Number(rows.reduce((n, r) => n + (r.spend?.usd ?? 0), 0).toFixed(2)),
    calls: rows.reduce((n, r) => n + (r.spend?.calls ?? 0), 0),
    extraction: {
      crew_total: field("crew_total"), date: field("date"), times: field("times"),
      roles: field("roles"), role_abstained: field("role_abstained"),
      block_count: field("block_count"), venue: field("venue"),
      of: scored.length,
    },
    engine: {
      ordered: withOrder.length,
      needsInfo: rows.filter((r) => r.new_?.status === "needs-info").length,
      proposed: rows.filter((r) => r.new_?.status === "proposed").length,
      errored: rows.filter((r) => r.new_?.status === "error").length,
      headcountConserved: conserved,
      undatedHeld: undatedCases.filter((r) => !r.new_?.order_id).length,
      undatedTotal: undatedCases.length,
    },
    amendments: { total: amended.length, inPlace, rKept, byShape: Object.fromEntries(byShape) },
    venues: Object.fromEntries(venueRows),
    causes: Object.fromEntries([...causes.entries()].map(([k, v]) => [k, v.n])),
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
say("");
