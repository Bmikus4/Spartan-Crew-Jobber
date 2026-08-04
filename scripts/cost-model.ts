// ============================================================================
// What a year of this mailbox costs to read, under each candidate design.
// ----------------------------------------------------------------------------
// NO MODEL CALLS. Every figure here is character counts over the swept corpus,
// run through the engine's OWN normalize + prompt code, then priced at list rates.
// That is deliberate: the previous way of answering "what does this cost?" was to
// run the pipeline over the corpus, which is what spent $150.
//
// It simulates ARRIVAL EVENTS, not threads. The live sweep processes a thread again
// each time a new client message lands, so a 10-message thread is 10 events — and
// under today's design each event re-sends the whole thread. That quadratic re-read
// is the thing being measured; per-thread figures hide it.
//
// Variants:
//   V0  today          full history capped at 12k chars, every event
//   V1  + gate         skip events that deterministically cannot be a job
//   V2  + incremental  send prior facts (compact) + the new message only
//   V3  + cache        V2 with the system prompt served from prompt cache
//   V4  + cheap model  V3 priced on a small model, escalating a share to Opus
//
//   npx tsx scripts/cost-model.ts            # print the table
//   npx tsx scripts/cost-model.ts --json
//   npx tsx scripts/cost-model.ts --limit 500   # fewer threads, same arithmetic
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { normalizeThread } from "../app/lib/engine/normalize";
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM } from "../app/lib/engine/prompts";
import type { HydratedThread, ThreadMessage } from "../app/lib/engine/types";

const AS_JSON = process.argv.includes("--json");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0);
const say = (...a: unknown[]) => { if (!AS_JSON) console.log(...a); };

const env = readFileSync(process.cwd() + "/.env.local", "utf8");
const g = (k: string) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^"|"$/g, "");
const sql = neon(g("DATABASE_URL")!);

// ------------------------------------------------------------------ the levers
const HISTORY_CAP = 12_000;
const TOK = (chars: number) => chars / 4;          // ~4 chars/token for English mail
const SYSTEM_COMBINED = CLASSIFY_SYSTEM.length + EXTRACT_SYSTEM.length + 120;  // + glue

// What the combined call replies with. MEASURED, not assumed: the 532 rows in
// sweep_labels ARE model outputs, and their fields average 429 characters — a
// 136-char job_summary and 1.3 work blocks. +25% for the JSON tool-call wrapper.
// This matters more than any other constant here: assuming 800 tokens (the first
// guess) made output half the bill and ranked a cheap model first. It is ~134,
// so INPUT dominates and caching outranks switching model.
const OUT_TOKENS = Math.round((429 * 1.25) / 4);

// The compact state we would send INSTEAD of the thread: the facts already extracted,
// as JSON. Measured from the schema, not guessed: 6 scalar fields plus ~2 requests.
const PRIOR_STATE_CHARS = 520;

// A message cannot be a job if it names no date and no crew. Both patterns are
// deliberately loose — they only ever ADMIT a message to the model, so a false
// positive costs one call and a false negative costs a booking.
const DATEISH = /\b(\d{1,2}[/.\-]\d{1,2}|\d{1,2}(st|nd|rd|th)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\btomorrow\b|\bnext (week|month)\b|\d{4}-\d{2}-\d{2})/i;
const CREWISH = /\b(\d+\s*x?\s*(crew|staff|guys|men|technicians?|carpenters?|drivers?|locals?|riggers?|hands|labourers?)|crew of \d+|x\s*\d+\b|\bcrew\b|\bstaff\b|\bshift\b|\bquote\b|\bavailability\b)/i;
const gateAdmits = (m: ThreadMessage) => DATEISH.test(m.body) || CREWISH.test(m.body) || DATEISH.test(m.subject) || CREWISH.test(m.subject);

// Today's threadText: latest in full, history newest-first up to the cap.
function historyChars(history: ThreadMessage[]): number {
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const line = `[${history[i].date_iso}] ${history[i].from}: ${history[i].body}`;
    if (used + line.length > HISTORY_CAP) break;
    used += line.length;
  }
  return used;
}

async function main() {
// ------------------------------------------------------------------ accumulate
const acc = {
  threads: 0, events: 0, gatedOut: 0,
  // Split apart deliberately. A thread with no client message at all was never going
  // to reach the model under any design; a thread whose every client message the gate
  // refused is the gate's own risk, and the only one worth alarming about.
  threadsNoClientEvent: 0, threadsAllGated: 0,
  v0In: 0, v1In: 0, v2In: 0,
  v0Out: 0, v1Out: 0, v2Out: 0,
  uncappedIn: 0,            // what it would be with no cap at all, for scale
  msgsRead_v0: 0, msgsRead_v2: 0,
};

const PAGE = 250;
for (let offset = 0; ; offset += PAGE) {
  if (LIMIT && offset >= LIMIT) break;
  const take = LIMIT ? Math.min(PAGE, LIMIT - offset) : PAGE;
  const rows = (await sql`
    SELECT thread_id, payload FROM sweep_threads
    ORDER BY thread_id LIMIT ${take} OFFSET ${offset}`) as { thread_id: string; payload: { messages?: unknown[] } }[];
  if (!rows.length) break;

  for (const row of rows) {
    const msgs = (row.payload?.messages ?? []) as ThreadMessage[];
    if (!msgs.length) continue;
    acc.threads++;
    let readAtLeastOnce = false;
    let hadClientEvent = false;

    // Each client message is one arrival event.
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i]?.is_from_spartan) continue;
      const slice: HydratedThread = { thread_id: row.thread_id, messages: msgs.slice(0, i + 1) };
      let latest: ThreadMessage, history: ThreadMessage[], machine: boolean;
      try { ({ latest, history, machine } = normalizeThread(slice)); } catch { continue; }
      if (machine) continue;                      // already free today: no model call
      acc.events++;
      hadClientEvent = true;

      const latestChars = latest.body.length + latest.subject.length + 120;
      const histChars = historyChars(history);

      // V0 — today
      acc.v0In += SYSTEM_COMBINED + latestChars + histChars;
      acc.v0Out += OUT_TOKENS * 4;
      acc.msgsRead_v0 += 1 + history.length;
      acc.uncappedIn += SYSTEM_COMBINED + latestChars + history.reduce((n, m) => n + m.body.length + 60, 0);

      // V1 — deterministic gate. Only for a thread with nothing established yet;
      // once a thread has facts, every later message must be read (it may change them).
      const established = readAtLeastOnce;
      const admit = established || gateAdmits(latest);
      if (!admit) { acc.gatedOut++; continue; }
      readAtLeastOnce = true;

      acc.v1In += SYSTEM_COMBINED + latestChars + histChars;
      acc.v1Out += OUT_TOKENS * 4;

      // V2 — incremental: prior state instead of prior messages. The first event on a
      // thread has no prior state, so it pays for its own message only either way.
      acc.v2In += SYSTEM_COMBINED + latestChars + (history.length ? PRIOR_STATE_CHARS : 0);
      acc.v2Out += OUT_TOKENS * 4;
      acc.msgsRead_v2 += 1;
    }
    if (!hadClientEvent) acc.threadsNoClientEvent++;
    else if (!readAtLeastOnce) acc.threadsAllGated++;
  }
  if (!LIMIT && rows.length < PAGE) break;
  say(`  … ${acc.threads} threads, ${acc.events} events`);
}

// ------------------------------------------------------------------ pricing
// List prices per Mtok, read off OpenRouter in the cost report. ASSUMED to still hold.
const PRICES = {
  "anthropic/claude-opus-4.6": { in: 5.0, out: 25.0 },
  "google/gemini-2.5-flash": { in: 0.30, out: 2.50 },
};
const price = (inTok: number, outTok: number, p: { in: number; out: number }) =>
  (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;

const opus = PRICES["anthropic/claude-opus-4.6"];
const flash = PRICES["google/gemini-2.5-flash"];

// Prompt cache: the system prompt is byte-identical on every call, so it is served
// from cache at 0.1x read after a 1.25x write. Anthropic needs >=1024 tokens to cache;
// the combined system prompt is ~2,730, so it qualifies. Everything after the cache
// breakpoint (the thread itself) is charged normally.
const sysTok = TOK(SYSTEM_COMBINED);
const v2Calls = acc.events - acc.gatedOut;
const v2VarIn = TOK(acc.v2In) - sysTok * v2Calls;          // input minus the cached part
const cachedSysCost = (sysTok * 1.25 / 1e6) * opus.in + (sysTok * 0.1 / 1e6) * opus.in * (v2Calls - 1);

// V4: the small model answers, and a share of events escalate to Opus for a second,
// authoritative pass.
//
// 32.5% is MEASURED, not chosen: scripts/parser-coverage.ts runs the escalation triggers
// against the labels the EXPENSIVE model itself produced, and 114 of 351 fail them (86
// jobs with no usable work block, 26 contradicted by the text, 2 with no company and no
// venue). It is a FLOOR — a weaker reader fails these checks more often, not less — so
// the true tiered cost sits above this row, not below it. The first version of this
// model used 0.2 as a guess and understated the tiered option by a third.
const ESCALATE = 0.325;

const rows = [
  // What production was ACTUALLY paying. deps.ts built the reasoner wrapper by hand and
  // omitted classifyAndExtract, so compiler.ts fell back to classify + extractFacts:
  // two full-thread calls per event, not the one the combined call was written to make.
  // The merge shipped, was tested, and never ran on Vercel. This row is the real before.
  ["V-1 production as it really ran (2 full-thread calls)", price(TOK(acc.v0In) * 2, TOK(acc.v0Out) * 2, opus), acc.events * 2],
  ["V0  one combined call (12k cap, full history)", price(TOK(acc.v0In), TOK(acc.v0Out), opus), acc.events],
  ["V1  + deterministic gate", price(TOK(acc.v1In), TOK(acc.v1Out), opus), v2Calls],
  ["V2  + incremental (prior facts, not prior mail)", price(TOK(acc.v2In), TOK(acc.v2Out), opus), v2Calls],
  ["V3  + system prompt cached", cachedSysCost + price(v2VarIn, TOK(acc.v2Out), opus), v2Calls],
  ["V4  + Flash first, 32.5% escalated (measured floor)",
    price(TOK(acc.v2In), TOK(acc.v2Out), flash) +
    ESCALATE * (cachedSysCost + price(v2VarIn, TOK(acc.v2Out), opus)), v2Calls],
] as [string, number, number][];

const out = {
  corpus: { threads: acc.threads, events: acc.events },
  gate: { skipped: acc.gatedOut, share: acc.events ? acc.gatedOut / acc.events : 0,
          threadsAllGated: acc.threadsAllGated, threadsNoClientEvent: acc.threadsNoClientEvent },
  messageReads: { today: acc.msgsRead_v0, incremental: acc.msgsRead_v2,
                  ratio: acc.msgsRead_v2 ? acc.msgsRead_v0 / acc.msgsRead_v2 : 0 },
  systemPromptTokens: Math.round(sysTok),
  uncappedInputTokens: Math.round(TOK(acc.uncappedIn)),
  variants: rows.map(([label, cost, calls]) => ({ label, cost, calls, perEvent: acc.events ? cost / acc.events : 0 })),
};

say(`\n=== CORPUS ===`);
say(`threads ${acc.threads}   arrival events ${acc.events}   (a thread is re-read on every new client message)`);
say(`message-reads today ${acc.msgsRead_v0} vs ${acc.msgsRead_v2} if each message is read once = ${out.messageReads.ratio.toFixed(2)}x re-reading`);
say(`system prompt ${Math.round(sysTok)} tokens, charged on EVERY call`);
say(`\n=== DETERMINISTIC GATE ===`);
say(`events skipped ${acc.gatedOut} = ${(100 * out.gate.share).toFixed(1)}%`);
say(`threads the gate silenced ENTIRELY: ${acc.threadsAllGated} (the gate's own risk — each is an enquiry no model ever sees)`);
say(`threads with no client message at all: ${acc.threadsNoClientEvent} (never reached the model under any design)`);
say(`\n=== COST OVER THE CORPUS (one full pass) ===`);
for (const [label, cost, calls] of rows) {
  say(`  ${label.padEnd(48)} $${cost.toFixed(2).padStart(9)}   ${String(calls).padStart(6)} calls   $${(cost / acc.events).toFixed(4)}/event`);
}
say(`\nfor scale, V0 with NO cap at all: ${out.uncappedInputTokens.toLocaleString()} input tokens = $${((out.uncappedInputTokens / 1e6) * opus.in).toFixed(0)}`);

if (AS_JSON) console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
