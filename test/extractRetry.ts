// ============================================================================
// A failed read is asked again inside the call, and only when asking again can help.
// ----------------------------------------------------------------------------
// Addendum F29 (26 Oct): extractWithMeta made one attempt. A 429 on 23 Oct became a red booking
// card that nothing read again, and it sat on the TV for 3 days. A 429, a 5xx other than 501 and a
// dropped connection are retried, 3 attempts in all; 400, 401 and 402 are not, because the same
// request gets the same refusal and each attempt costs money.
// npx tsx test/extractRetry.ts
// ============================================================================
import { extractWithMeta } from "../app/lib/v2/interpret/extract";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

process.env.OPENROUTER_API_KEY = "test-key";
const answer = () => new Response(JSON.stringify({ model: "m", choices: [{ message: { content: '{"requests":[]}' } }], usage: {} }), { status: 200 });
const status = (s: number) => () => new Response("{}", { status: s });
const dropped = () => { throw new TypeError("fetch failed"); };

/** Serves each scripted reply in turn and counts the calls. */
async function run(script: Array<() => Response>) {
  let calls = 0;
  globalThis.fetch = (async () => script[Math.min(calls++, script.length - 1)]()) as typeof fetch;
  try {
    const r = await extractWithMeta("2026-10-23T09:00:00Z", "a@b.c", "s", "n");
    return { calls, result: r.x, error: null as string | null };
  } catch (e) {
    return { calls, result: null, error: (e as Error).message };
  }
}

(async () => {
console.log("\n[retried] asking again can help");
let r =await run([status(429), answer]);
ok(r.calls === 2 && r.result !== null, "429 then 200: 2 calls and a reading", r);
r = await run([status(503), status(502), status(500)]);
ok(r.calls === 3 && r.error === "extract: OpenRouter 500", "three 5xx: thrown after 3 calls, the last status kept", r);
r = await run([dropped, answer]);
ok(r.calls === 2 && r.result !== null, "a dropped connection then 200: 2 calls", r);

console.log("\n[not retried] the same request gets the same refusal");
for (const s of [400, 401, 402, 501]) {
  r = await run([status(s), answer]);
  ok(r.calls === 1 && r.error === `extract: OpenRouter ${s}`, `${s}: 1 call, thrown`, r);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
})();
