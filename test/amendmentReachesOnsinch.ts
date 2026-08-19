// ============================================================================
// A crew change on a second email must actually reach OnSinch.
// ----------------------------------------------------------------------------
// test/replaceOrder.ts already proves delete-and-repost works. It proves it by
// building the ConversationState by hand — `last_ordered_teams_hash` set, the
// action log populated — and calling the pipeline with it. That is the right way
// to test the mechanism and it is why the mechanism was correct while being
// unreachable: the field it reads is written by the pipeline AFTER compile() has
// returned, and compile() built its next state without carrying it forward. On
// every real second email the hash came back undefined, `teamsChanged` was false,
// tryReplace declined, and the crew change went to a note asking a human to apply
// it by hand — the exact outcome the replace path exists to prevent.
//
// So this file never constructs a state. It sends two emails through
// handleThread, the way Gmail does, and asks what reached the tenant. That is the
// only shape of test that can fail when a field stops surviving the compile seam.
//
// Run: npx tsx test/amendmentReachesOnsinch.ts
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS, type HydratedThread } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${cond || !extra ? "" : `  (${extra})`}`);
  if (!cond) fails++;
};

/** Order ids we handed out, so the preflight can read one back. */
const created: number[] = [];
const deleted: number[] = [];
let nextId = 9001;
/** Flipped to make the order read back as confirmed. */
let provisional = true;
/** Crew signed on to the order. 45% of real provisional orders have some. */
let assigned = 0;

const transport: Transport = async (method, path, body) => {
  if (method === "POST" && path === "/orders") {
    const id = nextId++;
    created.push(id);
    return { status: 201, data: { data: [{ id, number: String(10000 + id) }] } };
  }
  if (method === "DELETE" && path === "/orders") {
    deleted.push(...(body as number[]));
    return { status: 200, data: null };
  }
  // The attendance gate: how many crew are signed on. -999 stands for "the call fails",
  // which must refuse rather than be read as zero.
  if (method === "GET" && path.startsWith("/attendance")) {
    if (assigned === -999) throw new Error("attendance read timed out");
    return { status: 200, data: { data: [], pagination: { count: assigned, pageCount: 1, nextPage: false } } };
  }
  // The replace preflight: GET /orders?id=<n>. Must look like a real live order.
  const byId = /[?&]id=(\d+)/.exec(path);
  if (method === "GET" && path.startsWith("/orders") && byId) {
    const id = Number(byId[1]);
    if (!created.includes(id) || deleted.includes(id)) {
      return { status: 200, data: { data: [], pagination: { count: 0, pageCount: 1, nextPage: false } } };
    }
    return {
      status: 200,
      data: {
        data: [{ id, number: String(10000 + id), provisional, quote: false, company_id: 42, happening: "2026-03-09T08:00:00+00:00", Job: [{ id: 7000 + id }] }],
        pagination: { count: 1, pageCount: 1, nextPage: false },
      },
    };
  }
  return mockTransport(method, path, body);
};

function rig() {
  const onsinch = new OnsinchClient(transport);
  const store = new InMemoryStore();
  let clock = 1_700_000_000_000;
  const executor: Executor = {
    async createReplyDraft() { return "draft-1"; },
    async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder(p) {
      const applied: string[] = [];
      if (p.desired.specification) applied.push("specification");
      if (applied.length) await onsinch.patchOrder([{ id: p.order_id }]);
      return applied;
    },
    async replaceOrder(p) {
      return replaceProvisionalOrder(
        onsinch,
        { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted, weCreatedIt: p.weCreatedIt },
        { onIntent: p.onIntent, onDeleted: p.onDeleted }
      );
    },
  };
  const deps: PipelineDeps = {
    reasoner: mockReasoner, onsinch, now: () => ++clock, store,
    metrics: new InMemoryMetrics(), executor, settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  };
  return { deps, store };
}

const FIRST = "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?";
const thread = (bodies: Array<{ id: string; body: string; at: string }>): HydratedThread => ({
  thread_id: "t-amend",
  messages: bodies.map((b) => msg({ message_id: b.id, date_iso: b.at, body: b.body })),
});

(async () => {
  console.log("\n[1] a crew change on the SECOND email is applied by replacing the order");
  {
    const { deps, store } = rig();
    const first = await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    ok(first.status === "ordered" && !!first.onsinch_order_id, "the first email books an order", first.status);
    const original = first.onsinch_order_id!;

    // THE SEAM. Everything the replace path reads was written by the pipeline onto the
    // state the FIRST email produced, and has to survive being persisted and recompiled.
    const persisted = await store.get("t-amend");
    ok(!!persisted?.last_ordered_teams_hash, "the slot-team fingerprint survived to the store");

    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Actually please make it 6 crew instead.", at: "2026-02-13T09:00:00Z" },
    ]), deps);

    ok(second.classification === "update", "the second email is an update");
    ok(deleted.includes(original), "the original draft order was deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(second.onsinch_order_id !== original, "and a replacement order was posted", `still #${second.onsinch_order_id}`);
    ok(second.status === "ordered", "the thread reads as ordered", second.status);
    ok(
      second.order_action_log.some((l) => l.kind === "replace" && l.ok),
      "the action log records a replace, not a patch",
      JSON.stringify(second.order_action_log.map((l) => l.kind))
    );
    // The failure this file exists to catch: the change reaching a note instead of OnSinch.
    ok(
      !second.notes.some((n) => /must be applied by hand/.test(n)),
      "the crew change did NOT fall back to 'apply it by hand'",
      second.notes.find((n) => /must be applied by hand/.test(n)) ?? ""
    );
    ok(
      (second.desired_order?.slot_teams ?? []).reduce((n, t) => n + t.size, 0) === 6,
      "the replacement carries the 6 people the client asked for"
    );
  }

  console.log("\n[2] a CONFIRMED order is never deleted, whoever raised it");
  {
    created.length = 0; deleted.length = 0; nextId = 9101; provisional = true;
    const { deps } = rig();
    await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];
    provisional = false; // a human took the order on in OnSinch

    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Actually please make it 6 crew instead.", at: "2026-02-13T09:00:00Z" },
    ]), deps);

    ok(!deleted.includes(original), "nothing was deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(second.status === "needs-info", "the thread asks for a human", second.status);
    ok(second.notes.some((n) => /no longer provisional/.test(n)), "and says the order has been confirmed");
  }

  console.log("\n[3] a follow-up that changes no crew must not destroy the order");
  {
    created.length = 0; deleted.length = 0; nextId = 9201; provisional = true;
    const { deps } = rig();
    await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];

    // Same 4 crew, no change to the shift — the shape that used to be safe only by
    // accident, and is the reason teamsChanged is checked rather than "is an update".
    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Please update the booking with our PO 44821, still 4 crew.", at: "2026-02-13T09:00:00Z" },
    ]), deps);

    ok(!deleted.includes(original), "the order was not deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(second.onsinch_order_id === original, "and it is still the same order", `#${second.onsinch_order_id}`);
  }

  console.log("\n[4] an order with crew already signed on is NEVER rebuilt");
  {
    // Measured on the live tenant 2026-08-19: 18 of the 40 most recent PROVISIONAL
    // orders already had crew assigned, one of them 94 people. `provisional` alone
    // therefore does not mean "nobody's booking yet", and a rebuild detaches every one
    // of them — the replacement's slots are new and empty.
    created.length = 0; deleted.length = 0; nextId = 9301; provisional = true; assigned = 14;
    const { deps } = rig();
    await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];

    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Actually please make it 6 crew instead.", at: "2026-02-13T09:00:00Z" },
    ]), deps);

    ok(!deleted.includes(original), "the staffed order was NOT deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(second.onsinch_order_id === original, "it is still the same order", `#${second.onsinch_order_id}`);
    ok(second.status === "needs-info", "the thread asks for a human", second.status);
    ok(
      second.notes.some((n) => /14 crew signed on/.test(n)),
      "and the note says how many people would have been detached",
      second.notes.join(" | ")
    );
    assigned = 0; // leave the module clean for any later case
  }

  console.log("\n[5] an unreadable attendance count refuses rather than guessing");
  {
    created.length = 0; deleted.length = 0; nextId = 9401; provisional = true; assigned = -999; // sentinel: throw
    const { deps } = rig();
    await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];
    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Actually please make it 6 crew instead.", at: "2026-02-13T09:00:00Z" },
    ]), deps);
    ok(!deleted.includes(original), "nothing was deleted when the count could not be read");
    ok(second.notes.some((n) => /could not check|crew signed on/.test(n)), "and it says so", second.notes.join(" | "));
    assigned = 0;
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
