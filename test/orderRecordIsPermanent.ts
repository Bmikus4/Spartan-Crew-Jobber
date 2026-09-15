// ============================================================================
// A thread's order is recorded where nothing can rewrite it, and one order holds many threads.
// ----------------------------------------------------------------------------
// Until 2026-09-13 a thread->order link lived in one place: the `conversation_state`
// JSON blob, which every pass rewrites wholesale. `order_records` — the table built for
// exactly this — held 21 rows against 207 links, because only the CREATE path wrote to
// it. The route that produced most links wrote nothing: `matchExistingOrder` reads an
// order out of OnSinch history when a thread has no id yet, and 90 of 148 recorded ids
// came from there.
//
// Two things have to hold:
//
//   1. every pass over a thread that has an order id records it durably;
//   2. a (thread, order) pair, once written, is never rewritten.
//
// (2) is why `ensureOrderRecord` exists beside `recordOrder` instead of being a flag on
// it. `recordOrder` upserts, which is correct for the create path — it owns the row.
// Upserting here would rewrite the counterparty on every pass.
//
// THE KEY IS (thread_id, order_id), NOT order_id. Measured 2026-09-13: 19 orders are
// claimed by more than one thread, and 12 of those are ONE JOB the client emailed about
// across several Gmail threads — the PO in one, a crew change in another, a quote reply
// in a third, with no shared message ids. An order_id primary key encoded a one-to-one
// the business does not have and made those 12 look like conflicts.
//
// Run: npx tsx test/orderRecordIsPermanent.ts
// ============================================================================
import { handleThread, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
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

type Rec = Parameters<NonNullable<PipelineDeps["ensureOrderRecord"]>>[0];

/**
 * The table's contract, in memory: (thread_id, order_id) is the primary key and the insert
 * is ON CONFLICT DO NOTHING. Anything passing against this passes against Neon for the
 * reason that matters — a repeat of the same pair is ignored, a new pair is a new row.
 */
function fakeStore() {
  const rows = new Map<string, Rec>();
  const calls: Rec[] = [];
  const key = (r: Rec) => r.thread_id + "|" + r.order_id;
  return {
    rows,
    calls,
    ensure: async (rec: Rec) => {
      calls.push(rec);
      if (rows.has(key(rec))) return false;
      rows.set(key(rec), rec);
      return true;
    },
  };
}

(async () => {
  console.log("\n[1] a thread with an order records it durably, and says where the id came from");
  {
    const db = fakeStore();
    let clock = 1;
    const onsinch = new OnsinchClient(mockTransport);
    const deps: PipelineDeps = {
      reasoner: mockReasoner, onsinch, now: () => ++clock, store: new InMemoryStore(),
      metrics: new InMemoryMetrics(), settings: { ...DEFAULT_SETTINGS },
      hashOrder: (o) => JSON.stringify(o),
      ensureOrderRecord: db.ensure,
      executor: {
        async createReplyDraft() { return "d"; },
        async createOrder(o) { return onsinch.createOrder(buildOrderBody(o)); },
        async patchOrder() {},
      },
    };

    const state = await handleThread({
      thread_id: "T-rec",
      messages: [msg({ message_id: "m1", from: "piergiorgio@redbeast.co.uk", body: "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?" })],
    }, deps);

    ok(Number(state.onsinch_order_id) > 0, "the thread ended up with an order id", String(state.onsinch_order_id));
    ok(db.calls.length === 1, "the durable record was written once", `${db.calls.length} calls`);
    const rec = db.calls[0];
    ok(rec?.thread_id === "T-rec", "and it names the thread", String(rec?.thread_id));
    ok(Number(rec?.order_id) === Number(state.onsinch_order_id), "and the order the state is carrying", String(rec?.order_id));
    // Provenance is the column the outstanding document lacked: "read once from OnSinch"
    // and "minted for us on this call" are different facts about an id and were counted
    // as one population. The create path stamps api_response from deps.ts; this path
    // cannot know, so it must never claim more than `matched`.
    ok(rec?.id_source === "matched", "recorded as matched, never as api_response", String(rec?.id_source));
    ok(rec?.verified_at === null, "and unverified — null is a third state, not a false", String(rec?.verified_at));
    // shape_sent is what the Phase 2 matcher compares a candidate against, so an empty
    // record is a record that cannot be matched later.
    ok(!!rec && typeof rec.shape_sent === "object" && rec.shape_sent !== null, "the shape we sent is kept for the matcher");
  }

  console.log("\n[2] one order, many threads — a second conversation is a new row, never an overwrite");
  {
    const db = fakeStore();
    const base: Rec = {
      order_id: 15594, thread_id: "T-first", job_id: 16000, order_number: "10743",
      sender_email: "a@client.co.uk", sender_domain: "client.co.uk", place_id: 49,
      shape_sent: { company_id: 7, slot_teams: [{ size: 4 }] }, id_source: "matched", verified_at: null,
    };
    const firstWrote = await db.ensure(base);
    const secondThread = await db.ensure({ ...base, thread_id: "T-second", sender_email: "b@other.co.uk" });
    const repeat = await db.ensure({ ...base, sender_email: "changed@client.co.uk" });

    ok(firstWrote === true, "the first write inserts");
    // A client emails about one job in several threads — the PO in one, a crew change in
    // another. 12 of the 19 multi-thread orders measured 2026-09-13 are exactly that, so a
    // second thread is a second row and not a conflict.
    ok(secondThread === true, "a second thread claiming the same order is a NEW ROW");
    ok(db.rows.size === 2, "so the order now holds two conversations", `${db.rows.size}`);
    // The same pair twice must stay inert, or every pass over a thread rewrites it.
    ok(repeat === false, "the same (thread, order) pair a second time is refused");
    ok(db.rows.get("T-first|15594")?.sender_email === "a@client.co.uk", "and the first row is untouched");
  }

  console.log("\n[3] a thread with no order writes nothing");
  {
    const db = fakeStore();
    let clock = 1;
    const onsinch = new OnsinchClient(mockTransport);
    const deps: PipelineDeps = {
      reasoner: mockReasoner, onsinch, now: () => ++clock, store: new InMemoryStore(),
      metrics: new InMemoryMetrics(), settings: { ...DEFAULT_SETTINGS },
      hashOrder: (o) => JSON.stringify(o),
      ensureOrderRecord: db.ensure,
      executor: {
        async createReplyDraft() { return "d"; },
        async createOrder(o) { return onsinch.createOrder(buildOrderBody(o)); },
        async patchOrder() {},
      },
    };
    await handleThread({
      thread_id: "T-none",
      messages: [msg({ message_id: "m1", from: "someone@example.com", body: "Thanks, that all sounds great. Speak soon." })],
    }, deps);
    ok(db.calls.length === 0, "no order, no row — an empty record would be a false link", `${db.calls.length} calls`);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
