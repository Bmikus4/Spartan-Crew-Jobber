// ============================================================================
// A transient OpenRouter failure must not lose the thread — and must not quietly
// multiply the spend ceiling.
// ----------------------------------------------------------------------------
// MEASURED, NOT SUPPOSED. Two runs of the 100-thread study on one build (2026-09-16,
// data/study/after and data/study/noise) differed by three threads. One of those three
// was a single OpenRouter timeout: `19f2c70356ba547` "Hotel Cafe Royal - 21st October
// 2025" threw "timed out after 25000ms", dropped out of the denominator entirely, and
// the headline moved 79.0% -> 79.8% on nothing but the missing thread. There was no
// retry anywhere in this adapter, so one slow response lost the email.
//
// THE LINE THAT MATTERS is which failures may be repeated, and it is drawn differently
// here than in the OnSinch transport. There, no POST is retried, because a POST creates
// something and a 500 does not say whether it landed. Here every call is a READ of the
// model's opinion — repeating one cannot double-book anything — so the line is drawn at
// TRANSPORT versus ANSWER instead:
//
//   retried      timeout, network error, 5xx, 429 — the request did not get an answer
//   NOT retried  401/402/403 — fatal for the whole run by design, see authFailsLoudly
//   NOT retried  other 4xx   — a malformed request does not improve by being sent again
//   NOT retried  a reply with no tool_call — temperature is 0, so a repeat buys the same
//                answer, and retrying it would hide a schema bug behind a latency cost
//
// THE SECOND THING THIS FILE EXISTS FOR IS THE MONEY. guardReasoner counts LOGICAL
// calls and ceilings them at 25; it cannot see a retry inside the adapter, so an
// unbounded retry would silently make a ceiling of 25 a ceiling of 75. A corpus script
// spent $57 in one night in this account. So the retries share ONE budget across the
// life of the reasoner: a rare timeout is absorbed, and something systematically broken
// exhausts the budget almost immediately and then fails loudly, which is what should
// happen.
//
// Offline. No model, no network — fetch is stubbed.  npx tsx test/reasonerRetry.ts
// ============================================================================
import { createOpenRouterReasoner, ReasonerAuthError } from "../app/lib/engine/reason";
import { msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const latest = msg({ from: "pier@redbeast.co.uk", body: "4 crew on 9 March", subject: "Crew" });

/** A well-formed OpenRouter reply carrying a classify answer. */
const GOOD = {
  ok: true,
  status: 200,
  async text() { return ""; },
  async json() {
    return {
      choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({
        classification: "new-job", cancellation: false, confidence: 0.9, reason: "asks for crew",
      }) } }] } }],
    };
  },
};

const timeout = () => { const e = new Error("aborted"); e.name = "TimeoutError"; throw e; };
const network = () => { throw new TypeError("fetch failed"); };
const http = (status: number, body = "{}") => ({ ok: false, status, async text() { return body; }, async json() { return JSON.parse(body); } });
const noTool = { ok: true, status: 200, async text() { return ""; }, async json() { return { choices: [{ message: { content: "sorry" } }] }; } };

/**
 * Run one classify against a scripted sequence of responses. Each entry is either a
 * thunk that throws (transport failure) or a Response-shaped object. The last entry
 * repeats, so a script of one models a persistent failure.
 */
async function script(steps: Array<any>, opts: { attempts?: string; budget?: string } = {}) {
  const realFetch = globalThis.fetch;
  const realAttempts = process.env.REASONER_ATTEMPTS;
  const realBudget = process.env.REASONER_RETRY_BUDGET;
  const realBackoff = process.env.REASONER_BACKOFF_MS;
  // Keep the suite fast: the backoff is real time and this file drives it repeatedly.
  process.env.REASONER_BACKOFF_MS = "1,1";
  if (opts.attempts) process.env.REASONER_ATTEMPTS = opts.attempts;
  if (opts.budget) process.env.REASONER_RETRY_BUDGET = opts.budget;
  let n = 0;
  globalThis.fetch = (async () => {
    const step = steps[Math.min(n++, steps.length - 1)];
    return typeof step === "function" ? step() : step;
  }) as unknown as typeof fetch;
  const reasoner = createOpenRouterReasoner({ apiKey: "test" });
  try {
    const out = await reasoner.classify(latest, [], false);
    return { requests: n, out, error: null as Error | null, reasoner };
  } catch (e) {
    return { requests: n, out: null, error: e as Error, reasoner };
  } finally {
    globalThis.fetch = realFetch;
    // Assigning `undefined` to process.env stores the STRING "undefined", which made
    // Number() return NaN, ATTEMPTS NaN, and the retry loop skip every attempt -- the
    // reasoner stopped calling the model at all while looking configured.
    const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore("REASONER_ATTEMPTS", realAttempts);
    restore("REASONER_RETRY_BUDGET", realBudget);
    restore("REASONER_BACKOFF_MS", realBackoff);
  }
}

async function main() {
  console.log("\n[1] the failure that actually happened: one timeout, then an answer");
  {
    const r = await script([timeout, GOOD]);
    ok(r.error === null, "the thread survives the timeout", r.error?.message ?? "");
    ok(r.requests === 2, "and it took exactly two requests", `${r.requests}`);
    ok((r.out as any)?.classification === "new-job", "the answer is the one the model gave");
  }

  console.log("\n[2] the other transport failures are retried too");
  {
    for (const [label, step] of [["a network error", network], ["a 500", http(500)], ["a 429", http(429)]] as const) {
      const r = await script([step, GOOD]);
      ok(r.error === null && r.requests === 2, `${label} is retried once and then succeeds`, `${r.requests} request(s)`);
    }
  }

  console.log("\n[3] a dead key is NOT retried — it is fatal for the whole run");
  {
    // Retrying it would turn one fatal stop into three, and the point of
    // ReasonerAuthError is that every subsequent call fails identically.
    const r = await script([http(401, '{"error":{"message":"User not found."}}')]);
    ok(r.error instanceof ReasonerAuthError, "still a ReasonerAuthError", r.error?.name);
    ok(r.requests === 1, "and it was asked exactly once", `${r.requests}`);
  }

  console.log("\n[4] an ordinary 4xx is NOT retried — it will not improve");
  {
    const r = await script([http(400, '{"error":{"message":"bad request"}}')]);
    ok(r.error !== null && r.requests === 1, "one request, then the error", `${r.requests}`);
  }

  console.log("\n[5] a reply with no tool_call is NOT retried");
  {
    // temperature is 0, so the repeat buys the same reply. Retrying here would spend
    // three requests to reproduce a schema bug and report it as a latency problem.
    const r = await script([noTool]);
    ok(r.error !== null && /no tool_call/i.test(r.error.message), "the content error is reported", r.error?.message.slice(0, 40));
    ok(r.requests === 1, "and it was asked exactly once", `${r.requests}`);
  }

  console.log("\n[6] a persistent failure stops, and says how hard it tried");
  {
    const r = await script([timeout], { attempts: "3" });
    ok(r.requests === 3, "three attempts, not more", `${r.requests}`);
    ok(!!r.error && /3 attempts/i.test(r.error.message), "the message names the attempt count", r.error?.message.slice(0, 80));
    ok(!!r.error && /timed out/i.test(r.error.message), "and still names the underlying cause");
  }

  console.log("\n[7] THE MONEY GUARD — retries share one budget across the reasoner's life");
  {
    // guardReasoner ceilings LOGICAL calls and cannot see a retry, so without this a
    // ceiling of 25 would be a ceiling of 75. With it the worst case is 25 + budget.
    const realFetch = globalThis.fetch;
    const realBudget = process.env.REASONER_RETRY_BUDGET;
    const realBackoff = process.env.REASONER_BACKOFF_MS;
    process.env.REASONER_RETRY_BUDGET = "2";
    process.env.REASONER_BACKOFF_MS = "1,1";
    let n = 0;
    globalThis.fetch = (async () => { n++; return timeout(); }) as unknown as typeof fetch;
    const reasoner = createOpenRouterReasoner({ apiKey: "test" });
    const tries: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = n;
      try { await reasoner.classify(latest, [], false); } catch { /* expected */ }
      tries.push(n - before);
    }
    globalThis.fetch = realFetch;
    if (realBudget === undefined) delete process.env.REASONER_RETRY_BUDGET; else process.env.REASONER_RETRY_BUDGET = realBudget;
    if (realBackoff === undefined) delete process.env.REASONER_BACKOFF_MS; else process.env.REASONER_BACKOFF_MS = realBackoff;
    ok(tries[0] === 3, "the first call spends both retries", `${tries[0]} request(s)`);
    ok(tries[1] === 1 && tries[2] === 1, "every later call is asked ONCE — the budget is gone",
       `${tries[1]}, ${tries[2]} request(s)`);
    ok(n === 5, "five requests in total, not nine", `${n}`);
  }

  console.log("\n[8] the budget is per reasoner, so a fresh one starts whole again");
  {
    // Otherwise one bad afternoon would leave every later run with no retries at all.
    const r = await script([timeout, GOOD], { budget: "2" });
    ok(r.error === null && r.requests === 2, "a new reasoner retries normally", `${r.requests}`);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}

main();
