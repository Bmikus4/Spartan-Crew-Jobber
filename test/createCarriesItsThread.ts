// ============================================================================
// The create path knows which conversation it is serving — and a booking that was
// made is never thrown away because a follow-up read failed.
// ----------------------------------------------------------------------------
// TWO DEFECTS, ONE MISSING ARGUMENT.
//
// `Executor.createOrder` took a `DesiredOrder`, which says what to book and nothing
// about who asked. Two finished features were written against that gap and neither
// could run:
//
//   order_records (orderRecordsDb.ts, 2026-08-28) — one durable row per order written,
//     holding the shape sent and the counterparty. `recordOrder` only runs when
//     `createOrderWithPlace` gets a context argument; deps.ts passed three arguments.
//     Verified 2026-09-02 against the live database: `information_schema.tables` had no
//     `order_records` at all. The store had never executed once.
//
//   verifyCreate (verifyWrite.ts, same day) — "READY AND INERT" in its own docstring,
//     naming this exact blocker.
//
// The second defect is a STALE INVARIANT. `readOrderIdentifiers` threw when the job id
// would not read back, justified by "every block that follows has to be posted against a
// job_id". Nothing follows the create any more — since 2026-08-28 the crew is nested in
// it, and `createSlotTeam` is reached only from `amendOrder.ts` (verified: no other call
// site). So the throw discarded a COMPLETED booking: the order exists in OnSinch, the
// exception reaches the pipeline's catch, the thread goes to `error`, and the id is never
// persisted. The order then belongs to nobody.
//
// Never realised — no thread in `conversation_state` carries that message — so this is a
// hazard removed, not a loss recovered. Said plainly because the difference matters.
//
// Run: npx tsx test/createCarriesItsThread.ts
// ============================================================================
import { handleThread, type PipelineDeps, type OrderContext } from "../app/lib/engine/pipeline";
import { createOrderWithPlace } from "../app/lib/deps";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import type { DesiredOrder } from "../app/lib/engine/types";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const order: DesiredOrder = {
  name: "RedBeast Energy — stand build",
  job_name: "Stand build",
  company_id: 512,
  user_id: 9,
  pricelist_category_id: 342,
  slot_teams: [
    { name: "Crew", profession_id: 3, beginning: "2026-03-09T08:00:00+00:00", end: "2026-03-09T18:00:00+00:00", size: 4, place_id: 49 },
  ],
} as unknown as DesiredOrder;

(async () => {
  console.log("\n[1] the pipeline tells the create which thread it is for");
  {
    const store = new InMemoryStore();
    const onsinch = new OnsinchClient(mockTransport);
    let seen: OrderContext | undefined;
    let called = 0;
    let clock = 1;
    const deps: PipelineDeps = {
      reasoner: mockReasoner, onsinch, now: () => ++clock, store,
      metrics: new InMemoryMetrics(), settings: { ...DEFAULT_SETTINGS },
      hashOrder: (o) => JSON.stringify(o),
      executor: {
        async createReplyDraft() { return "d"; },
        async createOrder(o, where) { called++; seen = where; return onsinch.createOrder(buildOrderBody(o)); },
        async patchOrder() {},
      },
    };
    const state = await handleThread({
      thread_id: "T-ctx",
      messages: [msg({ message_id: "m1", from: "piergiorgio@redbeast.co.uk", body: "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?" })],
    }, deps);

    ok(called === 1, "an order was written", `${called} creates`);
    // THE BUG, DIRECTLY. Before this change `where` was undefined at every call site,
    // which is why order_records had never been created in the database.
    ok(seen !== undefined, "THE CONTEXT ARRIVES AT ALL — it was undefined for the life of the store");
    ok(seen?.thread_id === "T-ctx", "and names the thread", String(seen?.thread_id));
    ok(seen?.thread_id === state.thread_id, "the same thread the state is keyed on");
    // sender_domain is what makes an order attributable to a client across mailboxes;
    // it is set by the compiler from counterpartyIdentity and was simply unreachable.
    ok(seen?.sender_email === "piergiorgio@redbeast.co.uk", "the counterparty address", String(seen?.sender_email));
    ok(seen?.sender_domain === "redbeast.co.uk", "and their organisational domain", String(seen?.sender_domain));
    ok(seen?.sender_domain === state.sender_domain, "matching what the state recorded — one derivation, not two");
  }

  console.log("\n[2] an order OnSinch made is kept even when its job id will not read back");
  {
    // The create succeeds; the follow-up GET returns the order with no Job. This threw
    // before, and the throw reached the pipeline as a failed booking.
    const calls: string[] = [];
    const tr: Transport = async (method, path) => {
      calls.push(`${method} ${path.split("?")[0]}`);
      if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9001 }] } };
      if (method === "GET" && path.startsWith("/orders"))
        return { status: 200, data: { data: [{ id: 9001, number: "R1" }] } }; // no Job
      return { status: 200, data: null };
    };
    let threw = "";
    let res: Awaited<ReturnType<typeof createOrderWithPlace>> | null = null;
    try { res = await createOrderWithPlace(new OnsinchClient(tr), order); }
    catch (e) { threw = String((e as Error)?.message ?? e); }

    ok(threw === "", "THE BOOKING IS NOT DISCARDED — it no longer throws", threw.slice(0, 60));
    ok(res?.id === 9001, "the order id survives, which is the whole point", String(res?.id));
    ok(res?.job_id === undefined, "the job id is absent rather than invented", String(res?.job_id));
    ok(typeof res?.unread === "string" && /job id/.test(res!.unread!), "and the gap is reported, not swallowed", String(res?.unread));
    // The R number still comes off the same read, so a human can still find the order.
    ok(res?.number === "R1", "the R number is still read from the same call", String(res?.number));
  }

  console.log("\n[3] a read-back that fails outright is also survivable");
  {
    const tr: Transport = async (method, path) => {
      if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9002 }] } };
      if (method === "GET" && path.startsWith("/orders")) throw new Error("socket hang up");
      return { status: 200, data: null };
    };
    let threw = "";
    let res: Awaited<ReturnType<typeof createOrderWithPlace>> | null = null;
    try { res = await createOrderWithPlace(new OnsinchClient(tr), order); }
    catch (e) { threw = String((e as Error)?.message ?? e); }
    ok(threw === "", "a thrown read-back does not lose the order either", threw.slice(0, 60));
    ok(res?.id === 9002, "the id is still returned", String(res?.id));
    ok(/could not be read back/.test(String(res?.unread)), "and says so", String(res?.unread));
  }

  console.log("\n[4] when everything reads, nothing is reported as missing");
  {
    // The guard against a fix that reports a problem on every order. `unread` must be
    // absent on the happy path or it becomes noise and stops being read.
    const tr: Transport = async (method, path) => {
      if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9003 }] } };
      if (method === "GET" && path.startsWith("/orders"))
        return { status: 200, data: { data: [{ id: 9003, number: "R2", Job: [{ id: 4002 }] }] } };
      return { status: 200, data: null };
    };
    const res = await createOrderWithPlace(new OnsinchClient(tr), order);
    ok(res.job_id === 4002, "the job id is read as before", String(res.job_id));
    ok(res.number === "R2", "and the R number", String(res.number));
    ok(!("unread" in res) || res.unread === undefined, "and nothing is flagged", JSON.stringify(res));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
