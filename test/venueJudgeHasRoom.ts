// ============================================================================
// The venue judge has room to think before it answers.
// ----------------------------------------------------------------------------
// The judge is gemini-3.1-pro-preview, a reasoning model, capped at 512 output tokens.
// On the first live morning (2026-09-30) 4 of 14 venue decisions came back
// `finish_reason: "length"` — the budget spent thinking, no tool call — and fell back to
// the search ranking, which put order 16330 (Frameless, 55 Bryanston Street) at The
// Marble Arch Hotel on the same street. The 15s timeout, not the token cap, bounds the
// call: a judge still thinking at 15s falls back exactly as before.
//
// Offline.  npx tsx test/venueJudgeHasRoom.ts
// ============================================================================
import { createVenueJudge } from "../app/lib/engine/reason";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

async function main() {
  const sent: any[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: "{\"place_id\":65}" } }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    console.log("\n[1] the default ceiling leaves a reasoning model room to answer");
    delete process.env.VENUE_MAX_TOKENS;
    await createVenueJudge({ apiKey: "k" }).adjudicate("s", "u");
    ok(sent[0].max_tokens >= 2048, "at least 2048 output tokens", String(sent[0].max_tokens));
    ok(sent[0].tool_choice?.function?.name === "emit", "and the answer is still forced to the tool");

    console.log("\n[2] the env override still wins");
    process.env.VENUE_MAX_TOKENS = "777";
    await createVenueJudge({ apiKey: "k" }).adjudicate("s", "u");
    ok(sent[1].max_tokens === 777, "VENUE_MAX_TOKENS is honoured", String(sent[1].max_tokens));
    delete process.env.VENUE_MAX_TOKENS;
  } finally {
    globalThis.fetch = real;
  }
  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
