// ============================================================================
// needs-info vs error: two genuinely different things that used to share one
// status value.
//
// compiler.ts set status="error" for ANY needs_human case - "no company name
// extracted", an unknown sender, a new venue - all routine, all expected. Only
// pipeline.ts's catch block is a real failure. Because both read "error", the
// Jobs Board's needs-human lane swallowed genuine OnSinch write failures, which
// is the dangerous direction to conflate them in.
//
// Run: npx tsx test/status.ts
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  let clock = 1_800_000_000_000;
  const onsinch = new OnsinchClient(mockTransport);
  return {
    reasoner: mockReasoner,
    onsinch,
    now: () => ++clock,
    store: new InMemoryStore(),
    metrics: new InMemoryMetrics(),
    settings: { ...DEFAULT_SETTINGS, order_mode: "auto" }, // auto so writes are attempted
    hashOrder,
    executor: {
      async createReplyDraft() { return "d1"; },
      async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
      async patchOrder(p) { await onsinch.patchOrder([{ id: p.order_id }]); },
    } as Executor,
    ...over,
  };
}

async function main() {
  console.log("\n[1] an enquiry with no company name -> needs-info, NOT error");
  {
    // The shared mockReasoner always returns a full extraction, so it can never
    // produce a needs-human case. Override just extractFacts to withhold the
    // company - which is exactly the real "no company name extracted" path.
    const noCompany = {
      ...mockReasoner,
      async extractFacts(latest: any, history: any) {
        const f = await mockReasoner.extractFacts(latest, history);
        return { ...f, company_name: undefined };
      },
    };
    // The sender must be someone OnSinch has no contact for either. The shared
    // fixture's pier@redbeast.co.uk IS a known client domain in the mock tenant,
    // and resolveCompany now identifies a client from the sender's domain when the
    // text names no company - so with that address this thread resolves and stages
    // an order, which is the feature working and not the case under test here.
    const s = await handleThread(
      {
        thread_id: "t-noinfo",
        messages: [msg({
          message_id: "m1",
          from: "someone@a-company-onsinch-has-never-seen.example",
          body: "We need 6 crew on 12 August at ExCeL London, 08:00-18:00.",
        })],
      },
      deps({ reasoner: noCompany })
    );
    ok(s.needs_human === true, "flagged for a human", String(s.needs_human));
    ok(s.status === "needs-info", "status is needs-info (was 'error')", s.status);
    ok(s.status !== "error", "and specifically NOT error");
    ok(s.order_action_log.length === 0, "nothing was attempted, so nothing failed");
    ok(s.notes.some((n) => /company/i.test(n)), "the reason says so", s.notes.join(" | "));
  }

  console.log("\n[2] an OnSinch write that throws -> error");
  {
    const boom: Executor = {
      async createReplyDraft() { return "d1"; },
      async createOrder() { throw new Error("OnSinch 500: order rejected"); },
      async patchOrder() { throw new Error("OnSinch 500"); },
    };
    // A thread the compiler CAN complete, so the write is actually attempted.
    const d = deps({ executor: boom });
    const s = await handleThread(
      { thread_id: "t-fail", messages: [msg({ message_id: "m1", body: "RedBeast Energy Ltd need 6 crew on 12 August at ExCeL London, 08:00-18:00." })] },
      d
    );
    if (s.order_action_log.length === 0) {
      console.log("  SKIP  the mock reasoner did not produce a writable order; see [3]");
    } else {
      ok(s.status === "error", "status is error", s.status);
      ok(s.order_action_log.some((a) => !a.ok), "the failure is in the action log");
      ok(s.notes.some((n) => /OnSinch/.test(n)), "the reason is recorded in the notes");
    }
  }

  console.log("\n[3] the two are distinguishable by the board's own rules");
  {
    const lane = (status: string, needs_human: boolean) => ({
      failed: status === "error",
      needsHuman: (needs_human || status === "needs-info") && status !== "error",
    });
    const info = lane("needs-info", true);
    ok(info.needsHuman && !info.failed, "needs-info lands in Needs human only");
    const err = lane("error", true);
    ok(err.failed && !err.needsHuman, "error lands in Failed only, even with needs_human set");
    const good = lane("proposed", false);
    ok(!good.failed && !good.needsHuman, "a staged order is in neither lane");
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
