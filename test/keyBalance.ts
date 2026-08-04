// ============================================================================
// The key-balance check, against the shape OpenRouter actually returned.
// ----------------------------------------------------------------------------
// The payload here is the real one read off the live key on 2026-08-04, the day it
// stopped classifying: limit 150, usage 150.310602, limit_remaining 0 and — the part
// that matters — limit_reset null, meaning the cap never rolls over.
//
// Two things are worth testing and neither is the happy path: that an exhausted key
// produces an unmissable message saying no email will be classified, and that every
// failure mode is swallowed, because a diagnostics lookup must never be able to fail
// an enquiry. No network: fetch is injected.
// ============================================================================
import { interpret, describe as describeBalance, getKeyBalance, resetKeyBalanceCache } from "../app/lib/engine/keyBalance";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

/** Verbatim from the live key on the day it ran out. */
const EXHAUSTED = {
  label: "sk-or-v1-21a...3c0",
  limit: 150,
  limit_reset: null,
  limit_remaining: 0,
  usage: 150.310602,
};

const fakeFetch = (body: unknown, status = 200) =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

console.log("key balance");

async function main() {

// ------------------------------------------------------------------- interpret
{
  const b = interpret(EXHAUSTED);
  ok(b.exhausted === true, "the real exhausted payload reads as exhausted");
  ok(b.remaining === 0, "remaining is 0", String(b.remaining));
  ok(b.resetsAt === null, "and resetsAt is null — it does not roll over");
  ok(b.low === false, "'low' is false when it is already empty — exhausted is its own state");
  const msg = describeBalance(b);
  ok(/EXHAUSTED/.test(msg), "the message shouts EXHAUSTED", msg);
  ok(/NO email will be classified/.test(msg), "and states the actual consequence");
  ok(/does NOT recover on its own/.test(msg), "and that a null reset means a human must act");
  ok(/\$150\.31 of \$150\.00/.test(msg), "with the real figures in it", msg);
}
{
  // A cap that DOES reset should say when, rather than telling someone to go fix it.
  const b = interpret({ ...EXHAUSTED, limit_reset: "2026-08-05T00:00:00Z" });
  const msg = describeBalance(b);
  ok(/resets at 2026-08-05/.test(msg), "a resetting cap names the reset time", msg);
  ok(!/does NOT recover/.test(msg), "and does not tell anyone to intervene");
}
{
  const b = interpret({ label: "k", limit: 150, limit_remaining: 4.5, usage: 145.5 });
  ok(b.low === true && b.exhausted === false, "under $5 is low but not exhausted");
  ok(/RUNNING LOW/.test(describeBalance(b)), "and says so");
}
{
  const b = interpret({ label: "k", limit: 1000, limit_remaining: 60, usage: 940 });
  ok(b.low === true, "under 10% of a big cap is low even though $60 sounds fine");
}
{
  const b = interpret({ label: "k", limit: 150, limit_remaining: 120, usage: 30 });
  ok(b.low === false && b.exhausted === false, "a healthy key is neither");
  ok(!/EXHAUSTED|LOW/.test(describeBalance(b)), "and its line is quiet", describeBalance(b));
}
{
  // No cap set at all: there is no remaining to compute, and that must not read as empty.
  const b = interpret({ label: "k", limit: null, usage: 113.05 });
  ok(b.limit === null && b.remaining === null, "an unlimited key has no remaining figure");
  ok(b.exhausted === false, "and is NOT reported as exhausted", JSON.stringify(b));
  ok(/no limit/.test(describeBalance(b)), "the line says 'no limit'", describeBalance(b));
}
{
  // OpenRouter's own figure wins over our subtraction — it knows about BYOK exclusions.
  const b = interpret({ label: "k", limit: 150, usage: 100, limit_remaining: 12 });
  ok(b.remaining === 12, "limit_remaining is preferred over limit - usage", String(b.remaining));
}

// ------------------------------------------------------- never breaks the caller
{
  resetKeyBalanceCache();
  const b = await getKeyBalance("k", { fetchImpl: fakeFetch({ data: EXHAUSTED }) });
  ok(b?.exhausted === true, "a live-shaped response is parsed");
}
{
  resetKeyBalanceCache();
  const b = await getKeyBalance("k", { fetchImpl: fakeFetch({ error: "nope" }, 401) });
  ok(b === null, "a 401 returns null rather than throwing — a revoked key must not crash intake");
}
{
  resetKeyBalanceCache();
  const thrower = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  let threw = false;
  let b: unknown = "unset";
  try { b = await getKeyBalance("k", { fetchImpl: thrower }); } catch { threw = true; }
  ok(!threw, "a network failure does not throw");
  ok(b === null, "it returns null", String(b));
}
{
  // Cached per process: two cold-start requests must not both go and ask.
  resetKeyBalanceCache();
  let calls = 0;
  const counting = (async () => { calls++; return { ok: true, status: 200, json: async () => ({ data: EXHAUSTED }) }; }) as unknown as typeof fetch;
  await Promise.all([
    getKeyBalance("k", { fetchImpl: counting }),
    getKeyBalance("k", { fetchImpl: counting }),
    getKeyBalance("k", { fetchImpl: counting }),
  ]);
  await getKeyBalance("k", { fetchImpl: counting });
  ok(calls === 1, "four callers, one lookup", `calls=${calls}`);
}

resetKeyBalanceCache();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
