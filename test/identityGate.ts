// ============================================================================
// The identity gate: the first thing that happens to every message.
// ----------------------------------------------------------------------------
// Two questions, both answered by keys rather than by judgement:
//   the MESSAGE id  - have we processed this exact email before?
//   the THREAD id   - have we seen this conversation before?
//
// claimMessage has answered both since it was written, and was wired only to
// /api/dedupe - an endpoint the n8n workflow may or may not call. The engine's
// own guarantee cannot depend on an external caller choosing to ask.
//
// It fails OPEN. A database that is down must never drop an enquiry, so a
// degraded claim processes the thread normally. Losing a booking is worse than
// processing one twice, and handleThread is idempotent anyway.
//
// Run: npx tsx test/identityGate.ts
// ============================================================================
import { handleThread, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import type { HydratedThread } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const thread = (message_id: string): HydratedThread => ({
  thread_id: "T1",
  messages: [{
    message_id, from: "client@eventful.co.uk", to: ["bookings@spartancrew.co.uk"],
    date_iso: "2026-08-28T10:00:00Z", subject: "4 crew Tuesday",
    body: "Please send 4 crew on Tuesday 8 September 2026, 08:00 to 18:00, at ExCeL.",
    is_from_spartan: false,
  }],
});

/** Records whether compile was reached, without running the real one. */
function rig(claim: Partial<{ ok: boolean; first_seen: boolean; degraded: string }>) {
  let compiled = 0;
  const deps = {
    store: new InMemoryStore(),
    metrics: { emit: async () => {} },
    settings: { order_mode: "draft-only", replies_enabled: false } as never,
    hashOrder: (o: unknown) => JSON.stringify(o),
    // Not in the brief's rig verbatim — handleThread's own emit() calls now() before
    // any triage/compile logic runs, so without this every case throws TypeError
    // "now is not a function" at the "email_received" emit, regardless of the gate.
    now: () => Date.now(),
    executor: {
      createReplyDraft: async () => "draft",
      createOrder: async () => { compiled++; return { id: 1 }; },
      patchOrder: async () => [],
    },
    reasoner: {
      classifyAndExtract: async () => { compiled++; throw new Error("compile reached"); },
    },
    claimMessage: async () => ({
      ok: claim.ok ?? true, found: true,
      first_seen: claim.first_seen ?? true, seen_count: 1,
      thread_first_seen: true, thread_message_count: 1,
      message_id: "m1", thread_id: "T1",
      ...(claim.degraded ? { degraded: claim.degraded } : {}),
    }),
  } as unknown as PipelineDeps;
  return { deps, reached: () => compiled };
}

(async () => {
  console.log("\n[1] a message already claimed is a no-op");
  {
    const { deps, reached } = rig({ first_seen: false });
    await handleThread(thread("m1"), deps).catch(() => {});
    ok(reached() === 0, "the engine never reached compile", String(reached()));
  }

  console.log("\n[2] a first-seen message is processed");
  {
    const { deps, reached } = rig({ first_seen: true });
    await handleThread(thread("m2"), deps).catch(() => {});
    ok(reached() > 0, "the engine went on to compile", String(reached()));
  }

  console.log("\n[3] a degraded claim FAILS OPEN - a database outage drops nothing");
  {
    const { deps, reached } = rig({ ok: false, first_seen: false, degraded: "no DATABASE_URL" });
    await handleThread(thread("m3"), deps).catch(() => {});
    ok(reached() > 0, "processed anyway rather than dropped", String(reached()));
  }

  console.log("\n[4] no claim injected at all still works");
  {
    const { deps, reached } = rig({});
    delete (deps as { claimMessage?: unknown }).claimMessage;
    await handleThread(thread("m4"), deps).catch(() => {});
    ok(reached() > 0, "an executor without a claim is not blocked", String(reached()));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
