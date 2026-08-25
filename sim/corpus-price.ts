// ============================================================================
// What the 500-case corpus costs with the REAL model in the loop.
// ----------------------------------------------------------------------------
//   npx tsx sim/corpus-price.ts
//
// NO MODEL CALLS. Every figure is a character count over the engine's OWN prompt
// constants and the study's own generated emails, priced at list rates. That is the
// same discipline scripts/cost-model.ts uses, and for the same reason: the previous way
// of answering "what would this cost?" in this account was to run it, which spent $150.
//
// WHAT THE ENGINE ACTUALLY CALLS, per client email that reaches the model:
//   1. classifyAndExtract — ONE combined call (classification + facts in one response)
//   2. composeReply       — a second call, only when a reply is drafted
// A machine-filtered message costs nothing: triage kills it before the model.
// ============================================================================
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, REPLY_SYSTEM } from "../app/lib/engine/prompts";
import { buildCases, bodyFor, factsFor } from "./corpusCases";

const N = Number((process.argv.find((a) => a.startsWith("--n=")) || "--n=500").split("=")[1]);

/** ~4 characters per token for English mail — the same constant cost-model.ts uses. */
const TOK = (chars: number) => Math.round(chars / 4);

// List prices per Mtok, as recorded in scripts/cost-model.ts. ASSUMED to still hold —
// if OpenRouter has moved, so has this table.
const PRICES: Record<string, { in: number; out: number }> = {
  "anthropic/claude-opus-4.6 (the engine's default)": { in: 5.0, out: 25.0 },
  "google/gemini-2.5-flash (SPARTAN_MODEL_CHEAP)": { in: 0.3, out: 2.5 },
};

// MEASURED, not assumed: the 532 real model outputs in sweep_labels average 429
// characters of fields, +25% for the JSON tool-call wrapper. This constant is the one
// that most changes the answer — the first guess at 800 tokens made output half the bill.
const OUT_EXTRACT = Math.round((429 * 1.25) / 4);
// A drafted reply is prose, not fields. Measured off the reply drafts in the corpus at
// roughly 1,400 characters.
const OUT_REPLY = Math.round(1400 / 4);

const SYS_COMBINED = CLASSIFY_SYSTEM.length + EXTRACT_SYSTEM.length + 120; // + the glue
const SYS_REPLY = REPLY_SYSTEM.length;

const cases = buildCases(N);

let inCombined = 0, inReply = 0, calls = 0, replyCalls = 0;
for (const c of cases) {
  // Email 1 — the whole thread is one message.
  const b1 = bodyFor(c, c.blocks, "new");
  const subject = `CORPUS ${c.id}`;
  inCombined += SYS_COMBINED + `priorOrderExists=false\n\nSubject: ${subject}\n\n`.length + b1.length;
  calls++;
  // Every case that is not machine mail drafts a reply.
  inReply += SYS_REPLY + subject.length + b1.length;
  replyCalls++;

  if (c.amend) {
    // Email 2 goes through the INCREMENTAL path: prior facts as JSON plus the new
    // message, rather than the whole thread again. That is the design the engine
    // already ships, and it is why a long thread does not cost quadratically.
    const b2 = bodyFor(c, c.amended!, "amend");
    const priorFacts = JSON.stringify(factsFor(c, c.blocks));
    inCombined += SYS_COMBINED + 260 + priorFacts.length + subject.length + b2.length;
    calls++;
    inReply += SYS_REPLY + subject.length + b2.length;
    replyCalls++;
  }
}

const inTok = TOK(inCombined) + TOK(inReply);
const outTok = calls * OUT_EXTRACT + replyCalls * OUT_REPLY;

console.log(`\n=== WHAT 500 CASES COST WITH THE MODEL IN THE LOOP ===\n`);
console.log(`cases ....................... ${cases.length} (${cases.filter((c) => c.amend).length} amended)`);
console.log(`combined classify+extract ... ${calls} calls`);
console.log(`composeReply ................ ${replyCalls} calls`);
console.log(`total model calls ........... ${calls + replyCalls}`);
console.log(`input ....................... ${(inTok / 1000).toFixed(0)}k tokens`);
console.log(`output ...................... ${(outTok / 1000).toFixed(0)}k tokens`);
console.log(`  (system prompt is ${TOK(SYS_COMBINED)} tokens of every combined call — ${((TOK(SYS_COMBINED) * calls) / inTok * 100).toFixed(0)}% of all input)`);

console.log(`\nprice, per model:\n`);
for (const [name, p] of Object.entries(PRICES)) {
  const cost = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
  console.log(`  ${name.padEnd(48)} $${cost.toFixed(2)}`);
}

// The system prompt is byte-identical on every call, so it can be served from cache at
// 0.1x read after a 1.25x write. It is 2,730 tokens, comfortably over Anthropic's 1,024
// minimum. THIS IS NOT ON TODAY — it is what the bill would be if it were.
{
  const p = PRICES["anthropic/claude-opus-4.6 (the engine's default)"];
  const sysTok = TOK(SYS_COMBINED);
  const varIn = inTok - sysTok * calls;
  const cached = (sysTok * 1.25 / 1e6) * p.in + (sysTok * 0.1 / 1e6) * p.in * (calls - 1);
  const cost = (varIn / 1e6) * p.in + cached + (outTok / 1e6) * p.out;
  console.log(`  ${"opus, IF the system prompt were cached".padEnd(48)} $${cost.toFixed(2)}`);
}

console.log(`\nsubsets, on the engine's default model:\n`);
for (const n of [10, 25, 50, 100]) {
  const share = n / cases.length;
  const p = PRICES["anthropic/claude-opus-4.6 (the engine's default)"];
  const cost = ((inTok * share) / 1e6) * p.in + ((outTok * share) / 1e6) * p.out;
  console.log(`  ${String(n).padStart(3)} cases  $${cost.toFixed(2)}`);
}
console.log("");
