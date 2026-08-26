// ============================================================================
// Confirming an UPDATE must not report success it did not achieve.
// ----------------------------------------------------------------------------
// deps.ts sends a patch as:
//     client.patchOrder([{ id: p.order_id }])
// which is PATCH /orders [{id: 13632}] - an id and no fields. OnSinch changes
// nothing. The pipeline then sets status "ordered" and logs { ok: true }, so the
// Jobs Board shows the order as done while the real order is untouched.
//
// A silent no-op reported as success is worse than a visible failure: the crew
// change the client asked for never reaches OnSinch, and the board says it did.
// Three of the live staged items are kind=patch against real orders 13632, 13639
// and 13625, so this is the live path.
//
// What a patch may legitimately carry is a separate question with a real
// constraint behind it - OnSinch's PATCH /orders is top-level only, nested slot
// teams cannot be edited in place, and overwriting an existing order's NAME with
// an email subject line would destroy Spartan's "<Company> @ <Venue>" convention.
// So this test does not demand that a patch apply everything. It demands that the
// engine not CLAIM to have applied what it did not.
//
// Run: npx tsx test/patchApply.ts
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { confirmOrder, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS, type ConversationState, type DesiredOrder } from "../app/lib/engine/types";
import { mockReasoner, mockTransport } from "./mocks";
import { executor as realExecutor } from "../app/lib/deps";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const desired: DesiredOrder = {
  name: "Mini Title Limited @ The Factory Project",
  company_id: 813, user_id: 9001,
  request_approval: true, 
  pricelist_category_id: 342,
  job_name: "2 at Unit A, The Factory Project on 2026-08-04",
  slot_teams: [
    { name: "Crew", profession_id: 1, beginning: "2026-08-04T08:00:00+01:00", end: "2026-08-04T11:00:00+01:00", size: 2, place_id: 304 },
  ],
  specification: "Photoshoot support, 2 crew",
};

/** A thread already staged as a PATCH of a real order, as the live board has. */
function stagedPatch(): ConversationState {
  return {
    thread_id: "t-patch", subject: "Re: Quote enquiry", participants: ["marta@minititle.com"],
    last_message_id: "m2", last_processed_epoch: 1,
    classification: "update", facts: { requests: [{ date: "2026-08-04", size: 2 }] },
    company_id: 813, user_id: 9001, place_id: 304,
    onsinch_order_id: 13632,
    desired_order: desired,
    priority: "medium", needs_human: false,
    pending_order: { kind: "patch", desired, order_id: 13632 },
    status: "proposed", notes: [], order_action_log: [],
  };
}

async function main() {
  // Record exactly what the executor was asked to send.
  const sent: Array<{ order_id: number; fields: string[] }> = [];
  const onsinch = new OnsinchClient(mockTransport);
  const store = new InMemoryStore();
  await store.put(stagedPatch());

  const noopExecutor: Executor = {
    async createReplyDraft() { return "d1"; },
    async createOrder(o) { return onsinch.createOrder(buildOrderBody(o)); },
    async patchOrder(p) {
      // Mirror deps.ts: it sends only the id today. Capture whatever it intends.
      const body: Record<string, unknown> = { id: p.order_id };
      sent.push({ order_id: p.order_id, fields: Object.keys(body).filter((k) => k !== "id") });
      await onsinch.patchOrder([body as { id: number }]);
    },
  };

  const deps: PipelineDeps = {
    reasoner: mockReasoner, onsinch, store, metrics: new InMemoryMetrics(),
    settings: { ...DEFAULT_SETTINGS }, executor: noopExecutor,
    now: () => 2, hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  };

  console.log("\n[1] a patch that carried no fields must not be reported as done");
  const s = await confirmOrder("t-patch", deps);
  ok(!!s, "confirm ran");
  console.log(`      sent: ${JSON.stringify(sent)}`);
  console.log(`      status=${s?.status}  notes=${JSON.stringify(s?.notes)}`);

  const carriedNothing = sent.length === 1 && sent[0].fields.length === 0;
  ok(carriedNothing, "reproduced: the patch carried id only, zero fields");

  // THE ASSERTION. Either the patch applies something, or the engine must not
  // claim success. Reporting "ordered" for a no-op is the defect.
  ok(s?.status !== "ordered",
    "status is NOT 'ordered' when nothing was actually applied", String(s?.status));
  ok(!!s?.needs_human,
    "flagged for a human, because the change did not reach OnSinch", String(s?.needs_human));
  ok((s?.notes ?? []).some((n) => /not applied|no fields|manually|needs/i.test(n)),
    "a note says the update was not applied", JSON.stringify(s?.notes));

  console.log("\n[2] the audit log must not claim ok on a no-op");
  const last = (s?.order_action_log ?? []).at(-1);
  console.log(`      last action: ${JSON.stringify(last)}`);
  ok(last?.ok !== true, "action log does not record ok:true for a no-op patch", String(last?.ok));

  console.log("\n[3] a patch that DOES apply fields is still not silently 'done'");
  {
    const store2 = new InMemoryStore();
    await store2.put(stagedPatch());
    const exec2: Executor = {
      async createReplyDraft() { return "d1"; },
      async createOrder(o) { return onsinch.createOrder(buildOrderBody(o)); },
      async patchOrder() { return ["specification"]; }, // as the real executor now does
    };
    const s3 = await confirmOrder("t-patch", { ...deps, store: store2, executor: exec2 });
    ok(s3?.status === "ordered", "status ordered — something really did land", String(s3?.status));
    ok(!!s3?.needs_human, "STILL flagged for a human: the crew change cannot be verified");
    ok((s3?.notes ?? []).some((n) => /specification/.test(n) && /by hand/.test(n)),
      "note says what was applied AND what is left by hand", JSON.stringify(s3?.notes));
    ok((s3?.order_action_log ?? []).at(-1)?.ok === true, "log records ok for a real partial apply");
  }

  console.log("\n[4] the REAL executor never sends the fields that would corrupt the order");
  {
    // Capture what actually goes over the wire.
    const calls: any[] = [];
    const recording = new OnsinchClient(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { status: 204, data: null };
    });
    const real = realExecutor(recording);
    const applied = await real.patchOrder({ order_id: 13632, desired });
    const sentBody = (calls[0]?.body as any[])?.[0] ?? {};
    console.log(`      PATCH ${calls[0]?.path} ${JSON.stringify(sentBody)}`);
    ok(Array.isArray(applied) && applied.includes("specification"), "specification applied", JSON.stringify(applied));
    ok(!("name" in sentBody), "does NOT overwrite the order name with the email subject");
    ok(!("pricelist_category_id" in sentBody), "does NOT overwrite the real, invoiced rate card");
    ok(!("slot_teams" in sentBody), "does NOT pretend to set slot teams");
    ok(sentBody.id === 13632, "targets the right order", String(sentBody.id));
  }

  console.log("\n[5] nothing safe to send => no HTTP call at all");
  {
    const calls: any[] = [];
    const recording = new OnsinchClient(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { status: 204, data: null };
    });
    const bare = { ...desired, specification: undefined, intern_name: undefined };
    const applied = await realExecutor(recording).patchOrder({ order_id: 13632, desired: bare });
    ok(Array.isArray(applied) && applied.length === 0, "reports nothing applied", JSON.stringify(applied));
    ok(calls.length === 0, "made no pointless PATCH", String(calls.length));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
