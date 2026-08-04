// How long each reasoner stage actually takes, per model. The deployed
// /api/n8n-inbound returned 504 FUNCTION_INVOCATION_TIMEOUT on a one-message
// thread, so the question is not "does the engine work" - it does - but whether
// it can finish inside a serverless invocation.
//
// Read-only: three model calls, no writes anywhere.
//
//   npx tsx scripts/time-stages.ts [model ...]
import { loadEnv, requireEnv } from "./_env.mjs";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { normalizeThread } from "../app/lib/engine/normalize";
import type { HydratedThread } from "../app/lib/engine/types";

loadEnv();
const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6", "anthropic/claude-sonnet-5", "anthropic/claude-haiku-4.5"];

// A real client enquiry, the shape most bookings arrive in.
const thread: HydratedThread = {
  thread_id: "timing",
  messages: [
    {
      message_id: "m1",
      from: "jboynak@ct-group.com",
      to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-07-29T14:29:47.000Z",
      subject: "UKLE26-2622.04// LOCAL CREW // Spartan Crew // August",
      body: `Hey guys

Hope you are well.

Please could I request a quote for the following local crew?

Event Name: Pop house
Date: 3rd August
Call time: 0900
No of Crew: 10 total (2 carpenters, 4 locals, 6 locals with 1 forklift licence)
No of hours: 10
Venue: Black Island Studios W3 0RA`,
      is_from_spartan: false,
    },
  ],
};

const { latest, history } = normalizeThread(thread);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<[number, T | null]> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return [Date.now() - t0, r];
  } catch (err) {
    console.log(`      ${label} THREW after ${Date.now() - t0}ms: ${(err as Error).message.slice(0, 120)}`);
    return [Date.now() - t0, null];
  }
}

async function main() {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  for (const model of MODELS) {
    console.log(`\n${model}`);
    const r = createOpenRouterReasoner({ apiKey, model });
    const [tc, cls] = await timed("classify", () => r.classify(latest, history, false));
    console.log(`  classify      ${String(tc).padStart(6)} ms   -> ${cls ? cls.classification : "FAILED"}`);
    const [te, facts] = await timed("extractFacts", () => r.extractFacts(latest, history));
    console.log(`  extractFacts  ${String(te).padStart(6)} ms   -> ${facts ? `${facts.requests?.length ?? 0} request(s), company=${facts.company_name ?? "-"}` : "FAILED"}`);
    const [tr] = await timed("composeReply", () => r.composeReply(latest, history, "new-job"));
    console.log(`  composeReply  ${String(tr).padStart(6)} ms`);
    console.log(`  ---`);
    console.log(`  classify+extract (the always-on path)   ${tc + te} ms`);
    console.log(`  all three (replies enabled)             ${tc + te + tr} ms`);
  }
  console.log(`\nVercel's ceiling is the function maxDuration (60s on Hobby). OnSinch`);
  console.log(`lookups and the database writes come on top of the figures above.\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
