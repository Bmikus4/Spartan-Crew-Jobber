// ============================================================================
// How much of a job the deterministic parser can read, over the whole corpus.
// ----------------------------------------------------------------------------
// NO MODEL CALLS. It reads the swept mail and runs parseWork over it, so the answer to
// "is a rules-first parser worth having?" costs nothing to obtain.
//
// Two questions:
//   1. On its own, how often does the text state a crew size, a date, and a shift?
//      That bounds what the parser can ever contribute.
//   2. Against the threads the model has already labelled, does the parser AGREE with
//      it, FILL a gap it left, or CONTRADICT it? Contradictions are the interesting
//      column — each one is a booking where one of the two readings is wrong.
//
//   npx tsx scripts/parser-coverage.ts
//   npx tsx scripts/parser-coverage.ts --json
//   npx tsx scripts/parser-coverage.ts --show 15    # print contradictions to read by hand
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { normalizeThread } from "../app/lib/engine/normalize";
import { parseTimes, parseCrew, parseDates, reconcileRequests } from "../app/lib/engine/parseWork";
import type { HydratedThread, ThreadMessage } from "../app/lib/engine/types";

const AS_JSON = process.argv.includes("--json");
const SHOW = Number((process.argv.find((a) => a.startsWith("--show=")) || "").split("=")[1] || 0);
const say = (...a: unknown[]) => { if (!AS_JSON) console.log(...a); };

const env = readFileSync(process.cwd() + "/.env.local", "utf8");
const g = (k: string) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^"|"$/g, "");
const sql = neon(g("DATABASE_URL")!);

async function main() {
  // ---------------------------------------------------------------- 1. coverage
  const cov = {
    threads: 0, withCrew: 0, withDate: 0, withShift: 0, withEndTime: 0,
    withCrewAndDate: 0, complete: 0, multiCrew: 0,
  };

  const PAGE = 250;
  for (let offset = 0; ; offset += PAGE) {
    const rows = (await sql`
      SELECT thread_id, payload FROM sweep_threads
      ORDER BY thread_id LIMIT ${PAGE} OFFSET ${offset}`) as { thread_id: string; payload: { messages?: unknown[] } }[];
    if (!rows.length) break;

    for (const row of rows) {
      const msgs = (row.payload?.messages ?? []) as ThreadMessage[];
      if (!msgs.length) continue;
      let latest: ThreadMessage;
      try { ({ latest } = normalizeThread({ thread_id: row.thread_id, messages: msgs } as HydratedThread)); }
      catch { continue; }
      cov.threads++;

      const text = `${latest.subject}\n${latest.body}`;
      const ref = new Date(Date.parse(latest.date_iso) || Date.now());
      const crews = parseCrew(text);
      const dates = parseDates(text, ref);
      const times = parseTimes(text);

      if (crews.length) cov.withCrew++;
      if (crews.length > 1) cov.multiCrew++;
      if (dates.length) cov.withDate++;
      if (times?.start && times?.end) cov.withShift++;
      if (times?.end) cov.withEndTime++;
      if (crews.length && dates.length) cov.withCrewAndDate++;
      if (crews.length === 1 && dates.length === 1 && times?.start && times?.end) cov.complete++;
    }
    if (rows.length < PAGE) break;
    say(`  … ${cov.threads} threads read`);
  }

  // ------------------------------------------- 2. against the model's own labels
  // sweep_labels holds what the engine's brain made of these threads. Comparing the
  // parser to it is the only comparison available without paying for a fresh pass.
  const labelled = (await sql`
    SELECT l.thread_id, l.blocks, l.crew_peak, t.payload
    FROM sweep_labels l
    JOIN sweep_threads t ON t.thread_id = l.thread_id
    WHERE l.error IS NULL AND jsonb_array_length(l.blocks) > 0`) as Array<{
      thread_id: string; blocks: Array<{ beginning?: string; end?: string; size?: number }>;
      crew_peak: number | null; payload: { messages?: unknown[] };
    }>;

  // The clean signal, separated from the noise. A contradiction where the model said
  // exactly 18:00 and the text states a different finish is the DEFAULT overriding a
  // stated time — the parser is right by construction there, because the duration is
  // written in the message it read ("4 x crew for 09:00 for 6 hrs" -> 15:00, booked to
  // 18:00). Other contradictions are not automatically the parser's win: it sees only
  // the latest message while the model saw the whole thread, so a disagreement can be
  // an artefact of comparing two different bodies of evidence.
  const vs = {
    compared: 0, agreed: 0, filled: 0, contradicted: 0,
    sizeConflict: 0, timeConflict: 0, dateConflict: 0,
    defaultedFinishCaught: 0, defaultedStartCaught: 0,
  };
  const examples: string[] = [];

  for (const row of labelled) {
    const msgs = (row.payload?.messages ?? []) as ThreadMessage[];
    if (!msgs.length) continue;
    let latest: ThreadMessage;
    try { ({ latest } = normalizeThread({ thread_id: row.thread_id, messages: msgs } as HydratedThread)); }
    catch { continue; }

    // Rebuild the model's requests from the stored blocks, in the shape reconcile takes.
    const modelRequests = row.blocks.map((b) => ({
      date: b.beginning ? String(b.beginning).slice(0, 10) : undefined,
      start_time: b.beginning ? String(b.beginning).slice(11, 16) : undefined,
      end_time: b.end ? String(b.end).slice(11, 16) : undefined,
      size: b.size,
    }));

    const { report } = reconcileRequests(
      `${latest.subject}\n${latest.body}`,
      modelRequests,
      new Date(Date.parse(latest.date_iso) || Date.now())
    );
    vs.compared++;
    if (report.conflicts.length) {
      vs.contradicted++;
      for (const c of report.conflicts) {
        if (/\.size:/.test(c)) vs.sizeConflict++;
        else if (/_time:/.test(c)) vs.timeConflict++;
        else if (/\.date:/.test(c)) vs.dateConflict++;
        if (/end_time: model 18:00, text (?!18:00)/.test(c)) vs.defaultedFinishCaught++;
        if (/start_time: model 08:00, text (?!08:00)/.test(c)) vs.defaultedStartCaught++;
      }
      if (examples.length < SHOW) {
        examples.push(`${row.thread_id}\n    ${report.conflicts.join("\n    ")}\n    subject: ${String(latest.subject).slice(0, 70)}`);
      }
    } else if (report.filled.length) vs.filled++;
    else vs.agreed++;
  }

  const pct = (n: number, d: number) => (d ? (100 * n / d).toFixed(1) + "%" : "n/a");

  say(`\n=== WHAT THE TEXT STATES (deterministic, ${cov.threads} threads) ===`);
  say(`crew size named            ${cov.withCrew} = ${pct(cov.withCrew, cov.threads)}   (more than one figure: ${cov.multiCrew})`);
  say(`date named                 ${cov.withDate} = ${pct(cov.withDate, cov.threads)}`);
  say(`full shift (start AND end) ${cov.withShift} = ${pct(cov.withShift, cov.threads)}`);
  say(`a finish time at all       ${cov.withEndTime} = ${pct(cov.withEndTime, cov.threads)}   <- what the 18:00 default was replacing`);
  say(`crew AND date              ${cov.withCrewAndDate} = ${pct(cov.withCrewAndDate, cov.threads)}`);
  say(`unambiguous whole block    ${cov.complete} = ${pct(cov.complete, cov.threads)}`);

  say(`\n=== PARSER vs THE MODEL'S OWN LABELS (${vs.compared} labelled threads with blocks) ===`);
  say(`agreed, nothing to add     ${vs.agreed} = ${pct(vs.agreed, vs.compared)}`);
  say(`parser FILLED a gap        ${vs.filled} = ${pct(vs.filled, vs.compared)}`);
  say(`parser CONTRADICTED it     ${vs.contradicted} = ${pct(vs.contradicted, vs.compared)}`);
  say(`   of which size ${vs.sizeConflict}, time ${vs.timeConflict}, date ${vs.dateConflict}`);
  say(`\nDEFAULTS CAUGHT — the model's 18:00/08:00 against a finish or start the email states:`);
  say(`   defaulted FINISH beaten by the text  ${vs.defaultedFinishCaught}`);
  say(`   defaulted START beaten by the text   ${vs.defaultedStartCaught}`);
  say(`   (the parser is right by construction here: the duration is written in the message it read)`);
  if (examples.length) {
    say(`\n--- contradictions to read by hand ---`);
    for (const e of examples) say(`  ${e}`);
  }

  if (AS_JSON) console.log(JSON.stringify({ coverage: cov, versusModel: vs }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
