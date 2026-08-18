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
// The fourth is what this file is really about. An order priced from the standard
// rather than from the client's own history is NEVER written hands-free - it is
// staged for a human even when order_mode is "auto" - because a guessed price on a
// real booking is the exact failure I1 exists to prevent. Money is worth a click.
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
  ok((state.notes ?? []).some((n) => /CHECK IT BEFORE CONFIRMING/.test(n)),
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

console.log("\n[4] AN ASSUMED PRICE IS NEVER WRITTEN HANDS-FREE");
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

  const s = await handleThread(thread("t-auto-assumed"), deps);
  ok(written.length === 0, "an assumed card is NOT written to OnSinch", JSON.stringify(written));
  ok(s.status === "proposed", "it was staged for confirmation instead", String(s.status));
  ok(!!s.pending_order, "the staged order is on the confirm queue");
  ok((s.notes ?? []).some((n) => /held for confirmation: the rate card was assumed/.test(n)),
    "and the reason is on the ticket", JSON.stringify(s.notes));
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
