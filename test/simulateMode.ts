// ============================================================================
// SPARTAN_SIMULATE=1: intake runs, the engine decides, and nothing leaves its database.
// ----------------------------------------------------------------------------
// Ben, 2026-10-05, on the week's pause: "keep it running but simulated". A pause loses
// the week, because n8n hands each message over once and nothing redelivers it; a
// simulation reads every email, records the order it would have written, and leaves
// the thread needing a person, so ops build it by hand and the TV still shows the need.
//
// Offline.  npx tsx test/simulateMode.ts
// ============================================================================
import { handleThread, cannotBeBooked, needsLabelFor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { simulatedDeps } from "../app/lib/deps";
import { automationPaused, simulating } from "../app/lib/paused";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const saved = process.env.SPARTAN_SIMULATE;
const restore = () => { if (saved === undefined) delete process.env.SPARTAN_SIMULATE; else process.env.SPARTAN_SIMULATE = saved; };

function depsFor(counts: { create: number; draft: number; label: number }): PipelineDeps {
  const onsinch = new OnsinchClient(mockTransport);
  let clock = 1;
  return {
    reasoner: mockReasoner, onsinch, now: () => ++clock, store: new InMemoryStore(),
    metrics: new InMemoryMetrics(), settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => JSON.stringify(o),
    async flagForManual() { counts.label++; },
    async flagOrderBuilt() { counts.label++; },
    executor: {
      async createReplyDraft() { counts.draft++; return "d"; },
      async createOrder(o) { counts.create++; return onsinch.createOrder(buildOrderBody(o)); },
      async patchOrder() {},
    },
  };
}

const enquiry = (id: string) => ({
  thread_id: id,
  messages: [msg({ message_id: `${id}-m1`, from: "piergiorgio@redbeast.co.uk", body: "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?" })],
});

(async () => {
  try {
    console.log("\n[1] simulation keeps intake open and stops the routes that change real orders or mail");
    for (const p of ["/api/n8n-inbound", "/api/dedupe"]) ok(!automationPaused(p, "", "1"), `${p} stays open, or nothing is read`);
    for (const p of ["/api/reconcile", "/api/sweep-ingest", "/api/mail-inbound", "/api/mail-poll"]) ok(automationPaused(p, "", "1"), `${p} stops`);
    ok(automationPaused("/api/n8n-inbound", "1", "1"), "the pause still outranks the simulation");
    ok(!automationPaused("/api/feed", "", "1"), "the TV feed is not an automation route");
    ok(simulating("1") && !simulating("") && !simulating("true"), "only 1 switches it on");

    console.log("\n[2] control: switched off, the same enquiry books");
    delete process.env.SPARTAN_SIMULATE;
    {
      const counts = { create: 0, draft: 0, label: 0 };
      const s = await handleThread(enquiry("T-live"), depsFor(counts));
      ok(counts.create === 1, "an order was written", `${counts.create} creates`);
      ok(s.simulated === undefined, "and nothing is marked simulated");
    }

    console.log("\n[3] simulated: the order is recorded, not written, and the thread needs a person");
    process.env.SPARTAN_SIMULATE = "1";
    {
      const counts = { create: 0, draft: 0, label: 0 };
      const s = await handleThread(enquiry("T-sim"), depsFor(counts));
      ok(counts.create === 0, "THE EXECUTOR IS NEVER CALLED", `${counts.create} creates`);
      ok(counts.label === 0, "no Gmail label is applied", `${counts.label} label calls`);
      ok(counts.draft === 0, "no reply is drafted", `${counts.draft} drafts`);
      ok(s.simulated?.kind === "create", "the would-be order is kept on the thread", JSON.stringify(s.simulated?.kind));
      ok((s.simulated?.desired.slot_teams ?? []).reduce((n, t) => n + t.size, 0) === 4, "with the crew it asked for");
      ok(s.pending_order === undefined, "and NOT in pending_order, so the confirm queue never offers it");
      ok(!(Number(s.onsinch_order_id) > 0), "no order id is recorded");
      ok(s.manual_flagged !== true, "no label is recorded as applied, so a restore labels it for real");
      ok(cannotBeBooked(s) && needsLabelFor(s) === "Order Needs Built", "the TV shows it as a job to build");
      ok(s.notes.some((n) => /^\[simulated\] would create an order: 4 crew/.test(n)), "the notes say what it would have done",
        s.notes.find((n) => n.startsWith("[simulated]")) ?? "");
    }

    console.log("\n[4] the dependencies every route builds cannot write, whatever calls them");
    {
      const seen: string[] = [];
      const t: Transport = async (method, path, body) => { seen.push(`${method} ${path}`); return mockTransport(method, path, body); };
      const live = depsFor({ create: 0, draft: 0, label: 0 });
      live.onsinch = new OnsinchClient(t);
      (live.executor as any).createInternalDraft = async () => "x";
      (live.executor as any).sendReplyDraft = async () => "x";
      const sim = simulatedDeps(live);
      let refused = "";
      try { await sim.onsinch.createOrder({} as never); } catch (e) { refused = String((e as Error).message); }
      ok(/read-only: refused POST/.test(refused), "a POST is refused at the transport", refused);
      try { await sim.executor.createOrder({ name: "x", slot_teams: [] } as never); } catch { /* refused */ }
      ok(!seen.some((s) => !s.startsWith("GET ")), "and nothing but GETs reached OnSinch", seen.join(", ") || "(no calls)");
      ok(sim.flagForManual === undefined && sim.flagOrderBuilt === undefined && sim.flagOrderUpdated === undefined && sim.flagSupervised === undefined, "every label hook is absent");
      ok(sim.repliesEnabled === false, "replies are off");
      ok(sim.executor.createInternalDraft === undefined && sim.executor.sendReplyDraft === undefined, "the internal draft and reply send are absent");
    }
  } finally {
    restore();
  }
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exitCode = fails ? 1 : 0;
})();
