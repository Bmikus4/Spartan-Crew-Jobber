// ============================================================================
// The J number reaches the board — for an order we create AND one we inherit.
// ----------------------------------------------------------------------------
// Ben, 2026-08-10: "I was wondering if we could get a job identifier in the
// detail section such as R (Order) number, S (Shift) number or J (Job) Number.
// J number may be best it will be easy to search for the J number and pull up
// the correct job."
//
// Three number spaces, and the board only ever held the one a human cannot use:
//
//   api order id   13645   POST /orders returns this; OnSinch's UI never shows it
//   order number   R10560  order.number
//   job number     J13925  Job[0].id — no GET /jobs exists, only ?with=Job
//
// The two paths that learn these are completely different, which is why both are
// tested: a CREATED order has to be read back (the POST response carries the order
// id alone), while an INHERITED one gets them free from the dedup lookup, which
// already pulls `with=Job` — and threw that half of its answer away.
//
// The third case is the one that would hurt: the read-back runs immediately after
// a successful POST, so if it can throw, a real order becomes a reported failure
// and the next run creates it a second time.
//
// Run: npx tsx test/jobNumber.ts
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { matchExistingOrder } from "../app/lib/engine/resolve";
import { handleThread, confirmOrder, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS, type HydratedThread, type Settings } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const assert = (cond: boolean, label: string) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fails++;
};

const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const NEW = { message_id: "m1", body: "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?" };
const thread = (id: string): HydratedThread => ({ thread_id: id, messages: [msg(NEW)] });

/** Deps over a given transport + executor. draft-only, so a confirm does the write. */
function build(transport: Transport, exec: Partial<Executor>): PipelineDeps {
  const onsinch = new OnsinchClient(transport);
  let clock = 1_700_000_000_000;
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const executor: Executor = {
    async createReplyDraft() { return "draft-1"; },
    async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
    ...exec,
  };
  return {
    reasoner: mockReasoner, onsinch, now: () => ++clock,
    store: new InMemoryStore(), metrics: new InMemoryMetrics(),
    executor, settings, hashOrder,
  };
}

(async () => {
  console.log("\n[1] matchExistingOrder hands back the numbers it already read");
  const m = matchExistingOrder("2026-03-09T08:00:00Z", [
    { id: 13645, number: "10560", happening: "2026-03-09T08:00:00+00:00", name: "X @ Savoy Place", Job: [{ id: 13925 }] },
  ]);
  assert(!!m && "order_id" in m && m.order_id === 13645, "api order id 13645");
  assert(!!m && "order_id" in m && m.order_number === "10560", "order number 10560 (R10560), not the api id");
  assert(!!m && "order_id" in m && m.job_id === 13925, "job id 13925 (J13925)");

  console.log("\n[2] A CREATED order: the J number is read back after the POST");
  const deps = build(mockTransport, {
    async identifiersForOrder(id) { return id === 9001 ? { job_id: 12345, order_number: "10560" } : {}; },
  });
  // The order is written on the spot now (Ben, Q1), so the read-back happens there
  // rather than after a confirm click. confirmOrder is still exercised below.
  const s = await handleThread(thread("t-create"), deps);
  assert(s.onsinch_order_id === 9001, "order created");
  // POST /orders never returns the number, so this can only have come from the read-back.
  assert(s.onsinch_order_number === "10560", "order number stored from the read-back, not from the POST");
  assert(s.onsinch_job_id === 12345, "job number stored from the read-back");

  console.log("\n[3] The read-back cannot turn a written order into a failure");
  const boom = build(mockTransport, {
    async identifiersForOrder() { throw new Error("orders read timed out"); },
  });
  const t = await handleThread(thread("t-boom"), boom);
  assert(t.onsinch_order_id === 9001, "the order is still recorded as created");
  assert(t.status === "ordered", "status is ordered, NOT error — a retry would create it twice");
  assert(t.onsinch_job_id === undefined, "job number simply absent");

  console.log("\n[4] An executor with no jobIdForOrder at all still writes orders");
  const bare = build(mockTransport, {});
  const u = await handleThread(thread("t-bare"), bare);
  assert(u.onsinch_order_id === 9001 && u.status === "ordered", "order created without the optional method");

  console.log("\n[5] An INHERITED order: numbers come free from the dedup lookup");
  // Same transport, except the company's order history holds an order on the very
  // day this thread asks for — which is what makes dedup match instead of create.
  const inheriting: Transport = async (method, path, body) => {
    if (method === "GET" && path.startsWith("/orders"))
      return {
        status: 200,
        data: {
          data: [{
            id: 13645, number: "10560",
            happening: "2026-03-09T08:00:00+00:00",
            name: "RedBeast Energy @ Savoy Place",
            Job: [{ id: 13925, pricelist_category_id: 197 }],
          }],
          pagination: { count: 1, pageCount: 1, nextPage: false },
        },
      };
    return mockTransport(method, path, body);
  };
  const dedup = build(inheriting, {});
  const v = await handleThread(thread("t-inherit"), dedup);
  assert(v.onsinch_order_id === 13645, "matched the existing order, did not create one");
  assert(v.onsinch_order_number === "10560", "R10560 carried through — this used to be dropped");
  assert(v.onsinch_job_id === 13925, "J13925 carried through — the dedup lookup already had it");
  assert(v.notes.some((n) => n.includes("J13925")), "the note names the job a human would search for");

  console.log(fails ? `\n${fails} FAILED\n` : "\nall passed\n");
  process.exit(fails ? 1 : 0);
})();
