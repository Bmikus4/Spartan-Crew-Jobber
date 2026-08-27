// ============================================================================
// A new client gets a rate, and an assumed rate never bills anyone.
// ----------------------------------------------------------------------------
// I1 says an order never goes out without an explicit pricelist_category_id,
// because OnSinch silently assigns its own otherwise - card 245, Tracy's original
// wrong-rate failure, which still appears on 7 first orders in the recent window
// where nobody set one.
//
// But I1 was also blocking every new client outright: a company with no orders has
// no history to derive a card from, so its first job could never be composed. Three
// live tickets were held on exactly this.
//
// 315 is the house standard by a wide margin, over the 498 recent orders carrying a
// card: 70.3% of all orders and 75.0% of companies' FIRST orders. So three new
// clients in four are priced right by it.
//
// The fourth is what this file is really about, and the answer changed on 2026-08-27.
// An order priced from the standard rather than from the client's own history used to be
// staged for a human rather than written. It is now WRITTEN and FLAGGED. Ben: "there are
// meant to be as little unnecessary blockers to creating a job as possible, as long as
// the actual content of the order can be created properly."
//
// A rate card is not order content - it decides what the job is INVOICED at, and it is
// Spartan's own number. The old hold existed because holding the order was the only way a
// human heard about the guess; `needs_human` now puts the "Manual" label on the thread in
// the bookings mailbox, so the price still gets checked and the booking does not wait.
//
// Run: npx tsx test/defaultRateCard.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { resolveRateCard } from "../app/lib/engine/rates";
import { DEFAULT_SETTINGS, type HydratedThread } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";
import { createHash } from "node:crypto";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const onsinch = new OnsinchClient(mockTransport);

/** A tenant where the company has NO order history at all. */
const noHistory: Transport = async (m, p, b) => {
  if (p.startsWith("/orders") && m === "GET") return { status: 200, data: { data: [], pagination: { pageCount: 1 } } };
  return mockTransport(m, p, b);
};

const thread = (id: string): HydratedThread => ({
  thread_id: id,
  messages: [msg({ message_id: "m1", body: "We need 6 crew on 12 August at ExCeL London, 08:00-18:00." })],
});

async function main() {

console.log("\n[1] resolveRateCard falls back only when there is nothing to derive");
{
  const bare = new OnsinchClient(noHistory);
  const none = await resolveRateCard(42, { onsinch: bare });
  ok(none.card === null && none.source === "none", "no history and no default -> nothing, as before", JSON.stringify(none));

  const std = await resolveRateCard(42, { onsinch: bare, defaultCard: 315 });
  ok(std.card === 315 && std.source === "default", "no history + a default -> the standard, labelled", JSON.stringify(std));

  // The client's OWN history still wins. mockTransport gives company history on card 197.
  const own = await resolveRateCard(42, { onsinch, defaultCard: 315 });
  ok(own.card === 197 && own.source === "history", "a client with history is priced by it, not the standard", JSON.stringify(own));

  // And a seeded card outranks everything.
  const seeded = await resolveRateCard(42, { onsinch, seededRateCard: async () => 282, defaultCard: 315 });
  ok(seeded.card === 282 && seeded.source === "seeded", "the seeded table still wins", JSON.stringify(seeded));

  ok((await resolveRateCard(42, { onsinch: bare, defaultCard: 0 })).card === null,
    "0 means no fallback - the thread holds, deliberately");
}

console.log("\n[2] a client with no history now gets an order at all");
{
  __resetListCache();
  const bare = new OnsinchClient(noHistory);
  const { state, actions } = await compile(thread("t-newclient"), undefined, {
    reasoner: mockReasoner, onsinch: bare, now: () => 1, repliesEnabled: false, defaultRateCard: 315,
  });
  ok(!!state.desired_order, "an order was composed", JSON.stringify(state.notes));
  ok(state.desired_order?.pricelist_category_id === 315, "on the standard card", String(state.desired_order?.pricelist_category_id));
  ok(state.desired_order?.rate_card_source === "default", "marked as assumed, not derived");
  ok(!!actions.createOrder, "and it is staged");
  ok((state.notes ?? []).some((n) => /CHECK THE PRICE — the job is booked/.test(n)),
    "with the check said in words a human will not miss", JSON.stringify(state.notes));
  ok(state.needs_human === true, "and a human is called");
}

console.log("\n[3] without the setting, nothing changes - it still holds");
{
  __resetListCache();
  const bare = new OnsinchClient(noHistory);
  const { state, actions } = await compile(thread("t-nodefault"), undefined, {
    reasoner: mockReasoner, onsinch: bare, now: () => 1, repliesEnabled: false,
  });
  ok(!actions.createOrder, "no order without a fallback card");
  ok((state.notes ?? []).some((n) => /no confident rate card/.test(n)), "and the old reason is still recorded");
}

console.log("\n[4] AN ASSUMED PRICE IS BOOKED AND FLAGGED, NOT HELD");
{
  __resetListCache();
  const written: string[] = [];
  const exec: Executor = {
    async createReplyDraft() { return "d1"; },
    async createOrder(o) { written.push(`create ${o.pricelist_category_id}`); return { id: 9001, number: "SC-9001" }; },
    async patchOrder() { return ["specification"]; },
  };
  const deps = {
    reasoner: mockReasoner, onsinch: new OnsinchClient(noHistory), store: new InMemoryStore(),
    metrics: new InMemoryMetrics(),
    // Every other order now goes straight to OnSinch (Ben, Q1). This is the one
    // guard that survives that, and it is checked on the order rather than on a mode.
    settings: { ...DEFAULT_SETTINGS, default_rate_card: 315 },
    executor: exec, now: () => 1, hashOrder, repliesEnabled: false, defaultRateCard: 315,
  } as unknown as PipelineDeps;

  /**
   * THIS BLOCK ASSERTED THE OPPOSITE UNTIL 2026-08-27, AND THE INVERSION IS THE POINT.
   *
   * It required that an assumed card be staged rather than written. Ben overruled it:
   * "there are meant to be as little unnecessary blockers to creating a job as possible,
   * as long as the actual content of the order can be created properly."
   *
   * A rate card is not order content. Everything deciding which crew turn up, when and
   * where is fully determined; the card decides what the job is INVOICED at, and it is
   * Spartan's own number, not something the client supplies.
   *
   * The old behaviour had a real argument — an assumed price reaches an invoice — and the
   * answer to it was that holding the order WAS the only way a human heard about it. That
   * stopped being true the same day: `needs_human` now puts the "Manual" label on the
   * thread in the bookings mailbox, so the price gets a person's eyes without the booking
   * waiting for them.
   *
   * Measured: of four live test enquiries with everything else correct — professions
   * resolved by cue, chief bands right, venues matched on postcode — two were held purely
   * because the client was new. Nothing was wrong with either order.
   */
  const s = await handleThread(thread("t-auto-assumed"), deps);
  ok(written.length === 1, "the order IS written to OnSinch", JSON.stringify(written));
  ok(written[0] === "create 315", "on the standard card", written[0]);
  ok(s.status === "ordered", "and the thread reads ordered, not proposed", String(s.status));
  ok(!s.pending_order, "nothing is left waiting on a click");
  ok(s.needs_human === true, "but a human is still called — this is what the Manual tag rides on");
  ok((s.notes ?? []).some((n) => /CHECK THE PRICE — the job is booked/.test(n)),
    "and the note says the price was assumed AND that the job went", JSON.stringify(s.notes).slice(0, 200));
}

console.log("\n[5] a DERIVED price still goes hands-free in auto mode");
{
  __resetListCache();
  const written: string[] = [];
  const exec: Executor = {
    async createReplyDraft() { return "d1"; },
    async createOrder(o) { written.push(`create ${o.pricelist_category_id}`); return { id: 9002, number: "SC-9002" }; },
    async patchOrder() { return ["specification"]; },
  };
  const deps = {
    reasoner: mockReasoner, onsinch, store: new InMemoryStore(), metrics: new InMemoryMetrics(),
    settings: { ...DEFAULT_SETTINGS, order_mode: "auto" as const, default_rate_card: 315 },
    executor: exec, now: () => 1, hashOrder, repliesEnabled: false, defaultRateCard: 315,
  } as unknown as PipelineDeps;

  const s = await handleThread(thread("t-auto-derived"), deps);
  ok(written.length === 1 && written[0] === "create 197",
    "a card derived from the client's own history is written as before", JSON.stringify(written));
  ok(s.status === "ordered", "and the thread is ordered, not proposed", String(s.status));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
