// ============================================================================
// The classifier gate, on the real cases that were getting dropped.
// ----------------------------------------------------------------------------
// Ben's requirement is explicit: "it MUST pick up ALL client inquiries." The
// prompt contradicted that in one line - not-a-job listed "a quote request" as an
// example, and the edge cases said '"Can you send me a quote?" -> not-a-job'.
// Spartan's clients open almost every real booking with a quote request that
// names the crew, dates and venue, so the gate was throwing away genuine work.
// Measured, not guessed: on live threads 19fae485684d21f8 (CT Group, 10 crew at
// Black Island Studios) and 19fae4d0dffce9e8 (4 crew at Olympia), the engine
// returned not-a-job while n8n's own classifier said is_job=true for both.
//
// Bodies below are abridged from those real threads. This calls the real model,
// so it costs tokens and is not run in a tight loop.
//
//   npx tsx test/classify.ts
// ============================================================================
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { normalizeThread } from "../app/lib/engine/normalize";
import type { HydratedThread } from "../app/lib/engine/types";

loadEnv();
const reasoner = createOpenRouterReasoner({
  apiKey: requireEnv("OPENROUTER_API_KEY"),
  model: process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.8",
});

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const msg = (o: Partial<HydratedThread["messages"][number]>) => ({
  message_id: "m",
  from: "client@example.com",
  to: ["bookings@spartancrew.co.uk"],
  date_iso: "2026-07-29T14:00:00.000Z",
  subject: "Crew",
  body: "",
  is_from_spartan: false,
  ...o,
});

const CASES: { name: string; thread: HydratedThread; expect: string[]; why: string }[] = [
  {
    name: "REAL: quote request naming crew, dates and venue (CT Group)",
    why: "the case the old prompt dropped - this is the shape of most real bookings",
    expect: ["new-job", "update"],
    thread: {
      thread_id: "t1",
      messages: [
        msg({
          message_id: "m1",
          from: "jboynak@ct-group.com",
          subject: "UKLE26-2622.04// LOCAL CREW // Spartan Crew // August",
          body: `Hey guys

Hope you are well.

Please could I request a quote for the following local crew?

Event Name: Pop house
Date: 3rd August
Call time: 0900
No of Crew: 10 total (2 carpenters, 4 locals, 6 locals with 1 forklift licence)
Venue: Black Island Studios W3 0RA`,
        }),
      ],
    },
  },
  {
    name: "REAL: client clarifies the crew breakdown mid-thread",
    why: "in isolation it reads like chit-chat; the history makes it an update",
    expect: ["update", "new-job"],
    thread: {
      thread_id: "t2",
      messages: [
        msg({ message_id: "m1", from: "jboynak@ct-group.com", body: "Please could I request a quote for the following local crew? Pop house, 3rd August 0900, 10 total crew, Black Island Studios W3 0RA." }),
        msg({ message_id: "m2", from: "bookings@spartancrew.co.uk", is_from_spartan: true, date_iso: "2026-07-29T14:30:00.000Z", body: "Please could you review the quote and let me know if this needs to be increased to 12 crew, as you mentioned 10 in total?" }),
        msg({ message_id: "m3", from: "jboynak@ct-group.com", date_iso: "2026-07-29T14:48:00.000Z", body: "Yes I think you're correct. Yeah 2 x carpenters and 2 x local crew to make the 4. Then just 6 x locals." }),
      ],
    },
  },
  {
    name: "a bare pricing question with no job attached",
    why: "the one thing that SHOULD still be not-a-job",
    expect: ["not-a-job"],
    thread: {
      thread_id: "t3",
      messages: [msg({ message_id: "m1", subject: "Rates", body: "Hi, could you send over your standard day rates for local crew please? Nothing specific yet, just building a budget for next year." })],
    },
  },
  {
    name: "an invoice query",
    why: "genuinely not a booking",
    expect: ["not-a-job"],
    thread: {
      thread_id: "t4",
      messages: [msg({ message_id: "m1", subject: "Invoice 4471", body: "Morning, our accounts team can't find invoice 4471 - could you resend it with the PO on it? Thanks." })],
    },
  },
];

async function main() {
  for (const c of CASES) {
    const { latest, history } = normalizeThread(c.thread);
    const r = await reasoner.classify(latest, history, false);
    console.log(`\n${c.name}`);
    console.log(`  (${c.why})`);
    ok(c.expect.includes(r.classification), `classified ${r.classification}, expected one of ${c.expect.join("/")}`, r.job_summary ? `— ${String(r.job_summary).slice(0, 100)}` : "");
  }
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
