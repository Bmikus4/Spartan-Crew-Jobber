// ============================================================================
// Offline end-to-end proof of the foundational design + metrics + draft-only.
// Proves: (1) draft-only new-job -> reply drafted + order PROPOSED (not written),
//         (1b) one-click confirm -> order created,
//         (2) re-handling the SAME thread is idempotent,
//         (3) a follow-up crew-count change -> proposed PATCH -> confirm,
//         (4) a bare "thanks" -> confirmation-only,
//         (5) dashboard aggregate reflects the funnel,
//         (6) flipping order_mode:"auto" writes the order hands-free.
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics, aggregate } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { handleThread, confirmOrder, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS, type HydratedThread, type Settings } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let clock = 1_700_000_000_000;
const onsinch = new OnsinchClient(mockTransport);
const store = new InMemoryStore();
const metrics = new InMemoryMetrics();
const settings: Settings = { ...DEFAULT_SETTINGS }; // draft-only by default
const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

const executor: Executor = {
  async createReplyDraft() { return "draft-" + clock; },
  async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
  async patchOrder(p) { await onsinch.patchOrder([{ id: p.order_id }]); },
};

const deps: PipelineDeps = {
  reasoner: mockReasoner, onsinch, now: () => ++clock, store, metrics, executor, settings, hashOrder,
};

let fails = 0;
const assert = (cond: boolean, label: string) => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}`);
  if (!cond) fails++;
};

const TID = "thread-A";
const thread = (msgs: Parameters<typeof msg>[0][]): HydratedThread => ({ thread_id: TID, messages: msgs.map(msg) });
const NEW = { message_id: "m1", body: "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?" };

(async () => {
  console.log("\n[1] Draft-only: new job -> reply drafted, order PROPOSED (not written)");
  let s = await handleThread(thread([NEW]), deps);
  assert(s.classification === "new-job", "classified new-job");
  assert(!!s.reply_draft_id, "reply draft created");
  assert(s.status === "proposed", "status = proposed");
  assert(!!s.pending_order && s.pending_order.kind === "create", "order staged for confirm");
  assert(s.onsinch_order_id === undefined, "NO order written to OnSinch yet");
  assert(s.pending_order?.desired.slot_teams[0].place_id === 88, "staged order has place_id 88");

  console.log("\n[1b] One-click confirm -> order created");
  s = (await confirmOrder(TID, deps))!;
  assert(s.onsinch_order_id === 9001, "order 9001 created on confirm");
  assert(s.status === "ordered" && !s.pending_order, "status ordered, pending cleared");

  console.log("\n[2] Re-handle SAME thread (idempotency)");
  const createsBefore = (await metrics.all()).filter((e) => e.type === "order_created").length;
  s = await handleThread(thread([NEW]), deps);
  const createsAfter = (await metrics.all()).filter((e) => e.type === "order_created").length;
  assert(createsBefore === createsAfter, "no second order created (idempotent)");
  assert(!s.pending_order, "nothing newly proposed");

  console.log("\n[3] Follow-up crew-count change -> proposed PATCH -> confirm");
  s = await handleThread(thread([
    { message_id: "m1", date_iso: "2026-02-12T10:00:00Z", body: NEW.body },
    { message_id: "m2", date_iso: "2026-02-13T09:00:00Z", body: "Actually please make it 6 crew instead." },
  ]), deps);
  assert(s.classification === "update", "classified update");
  assert(s.status === "proposed" && s.pending_order?.kind === "patch", "patch proposed");
  assert(s.pending_order?.desired.slot_teams[0].size === 6, "staged patch size = 6");
  s = (await confirmOrder(TID, deps))!;
  assert(s.order_action_log.filter((l) => l.kind === "patch").length === 1, "one patch executed on confirm");

  console.log("\n[4] Bare acknowledgement -> confirmation-only");
  s = await handleThread(thread([
    { message_id: "m1", date_iso: "2026-02-12T10:00:00Z", body: "Hi, can I book 4 crew on 9th March at Savoy Place?" },
    { message_id: "m3", date_iso: "2026-02-14T09:00:00Z", body: "Perfect, thanks!" },
  ]), deps);
  assert(s.classification === "confirmation-only", "classified confirmation-only");

  console.log("\n[5] Dashboard aggregate");
  const stats = aggregate(await metrics.all());
  console.log("   " + JSON.stringify(stats));
  assert(stats.orders_proposed === 2, "2 orders proposed (create + patch)");
  assert(stats.orders_created === 1 && stats.orders_updated === 1, "1 created, 1 updated after confirms");
  assert(stats.awaiting_confirmation === 0, "nothing left awaiting confirmation");

  console.log("\n[6] order_mode:auto -> hands-free write (separate thread)");
  const autoDeps: PipelineDeps = { ...deps, settings: { order_mode: "auto" } };
  const s2 = await handleThread({ thread_id: "thread-B", messages: [msg({ message_id: "b1", body: NEW.body })] }, autoDeps);
  assert(s2.status === "ordered" && s2.onsinch_order_id === 9001, "auto mode wrote order without confirm");

  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
