// ============================================================================
// A dead key must stop the run, not fill the corpus with error rows.
// ----------------------------------------------------------------------------
// The OpenRouter key was revoked mid-batch. Every remaining call returned 401, the
// labeller caught each one, wrote an error row and carried on — 179 threads in three
// minutes. The run then "completed", and because an error row is still a row, the
// retry treated those threads as already labelled and skipped them. A failure that
// looks like data is worse than a crash.
//
// So an auth/credit/limit failure is now its own error type, and it is fatal for the
// whole run rather than for one thread.
//
// Offline. No model, no network — fetch is stubbed.  npx tsx test/authFailsLoudly.ts
// ============================================================================
import { createOpenRouterReasoner, ReasonerAuthError } from "../app/lib/engine/reason";
import { msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const latest = msg({ from: "pier@redbeast.co.uk", body: "4 crew on 9 March", subject: "Crew" });

/** Drive the reasoner against a stubbed OpenRouter that returns `status`. */
async function callWith(status: number, body: string): Promise<Error> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status,
    async text() { return body; },
    async json() { return JSON.parse(body); },
  })) as unknown as typeof fetch;
  const reasoner = createOpenRouterReasoner({ apiKey: "test" });
  try {
    await reasoner.classify(latest, [], false);
    return new Error("no error thrown");
  } catch (e) {
    return e as Error;
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function main() {
  console.log("\n[1] a revoked key is an auth error, and says so");
  {
    const e = await callWith(401, '{"error":{"message":"User not found."}}');
    ok(e instanceof ReasonerAuthError, "typed as ReasonerAuthError", e.name);
    ok(/revoked or wrong/i.test(e.message), "the message names the cause", e.message.slice(0, 60));
    ok((e as ReasonerAuthError).status === 401, "carries the status");
  }

  console.log("\n[2] no credit is an auth error, and says what to do");
  {
    const e = await callWith(402, '{"error":{"message":"This request requires more credits"}}');
    ok(e instanceof ReasonerAuthError, "typed as ReasonerAuthError", e.name);
    ok(/out of credit/i.test(e.message) && /topped up/i.test(e.message), "says the account is out of credit");
  }

  console.log("\n[3] a key over its own limit is an auth error");
  {
    const e = await callWith(403, '{"error":{"message":"Key limit exceeded (total limit)"}}');
    ok(e instanceof ReasonerAuthError, "typed as ReasonerAuthError", e.name);
    ok(/spend limit/i.test(e.message), "names the key's own limit");
  }

  console.log("\n[4] an ordinary failure stays ordinary — one thread, not the run");
  {
    const e = await callWith(500, "upstream exploded");
    ok(!(e instanceof ReasonerAuthError), "not an auth error", e.name);
    ok(/OpenRouter 500/.test(e.message), "still reports the status", e.message.slice(0, 40));
  }

  console.log("\n[5] a rate limit is retryable, not fatal");
  {
    const e = await callWith(429, "slow down");
    ok(!(e instanceof ReasonerAuthError), "429 is not treated as a dead key", e.name);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
