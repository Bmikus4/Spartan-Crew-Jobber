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
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
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

/**
 * The slot teams each order holds, and their ids — the tenant's own record, which the
 * engine can only see through the audit log. Keyed by order id.
 */
const teamsOf = new Map<number, number[]>();
let nextTeamId = 500;
/** Every slot-team write, so a case can assert the change went as PATCHes not a rebuild. */
const teamWrites: Array<{ method: string; body: any }> = [];

const transport: Transport = async (method, path, body) => {
  if (method === "POST" && path === "/orders") {
    const id = nextId++;
    created.push(id);
    const nested = ((body as any[])?.[0]?.SlotTeam ?? []).length || 1;
    teamsOf.set(id, Array.from({ length: nested }, () => ++nextTeamId));
    return { status: 201, data: { data: [{ id, number: String(10000 + id) }] } };
  }
  if (method === "DELETE" && path === "/orders") {
    deleted.push(...(body as number[]));
    return { status: 200, data: null };
  }
  /**
   * The audit log — the only route by which an order's slot team ids are readable, and
   * therefore the only reason an amendment can be applied in place at all. Shaped as the
   * live tenant returns it: `data` is a JSON string with escaped slashes.
   */
  if (method === "GET" && path.startsWith("/timelineAudits")) {
    const want = /Order%3A(\d+)/.exec(path) ?? /Order:(\d+)/.exec(decodeURIComponent(path));
    const oid = Number(want?.[1]);
    const rows = (teamsOf.get(oid) ?? []).map((tid, i) => ({
      id: 1000 + i,
      action: "common_create",
      creator: null,
      data: JSON.stringify({
        id: String(tid),
        name: "General",
        model: "SlotTeam",
        data: { path: `Order:${oid}/Job:${7000 + oid}/SlotTeam:${tid}` },
      }).replace(/\//g, "\\/"),
    }));
    return { status: 200, data: { data: rows, pagination: { count: rows.length, pageCount: 1, nextPage: false } } };
  }
  if (method === "PATCH" && path === "/slotTeams") {
    teamWrites.push({ method, body });
    return { status: 204, data: null };
  }
  if (method === "POST" && path === "/slotTeams") {
    teamWrites.push({ method, body });
    const job = Number((body as any[])[0]?.job_id);
    const oid = job - 7000;
    const id = ++nextTeamId;
    teamsOf.set(oid, [...(teamsOf.get(oid) ?? []), id]);
    return { status: 201, data: { data: [{ id }] } };
  }
  /**
   * The attendance gate. Rows carry their SlotTeam, because the two callers ask
   * different questions of the same read: the rebuild path counts the order, the
   * amendment asks WHICH block each person is on. `assigned` people are all put on the
   * FIRST block, which is what makes "shrink the staffed block" expressible here.
   * -999 stands for "the call fails", which must refuse rather than read as zero.
   */
  if (method === "GET" && path.startsWith("/attendance")) {
    if (assigned === -999) throw new Error("attendance read timed out");
    const oid = Number(/Order__id=(\d+)/.exec(path)?.[1]);
    const first = (teamsOf.get(oid) ?? [])[0];
    const rows = Array.from({ length: Math.max(0, assigned) }, (_, i) => ({
      id: 8000 + i,
      SlotTeam: { id: first, name: "General" },
    }));
    return { status: 200, data: { data: rows, pagination: { count: Math.max(0, assigned), pageCount: 1, nextPage: false } } };
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

function rig(reasoner: PipelineDeps["reasoner"] = mockReasoner) {
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
    async amendOrderInPlace(p) {
      return amendOrderInPlace(
        onsinch,
        { order_id: p.order_id, previous: p.previous, desired: p.desired, alreadyCreated: p.alreadyCreated },
        { onCreated: p.onCreated }
      );
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
    reasoner, onsinch, now: () => ++clock, store,
    metrics: new InMemoryMetrics(), executor, settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  };
  return { deps, store };
}

/**
 * The stock mock extractor always returns ONE request, so "the client dropped a block"
 * cannot be expressed through it — and that is the one amendment OnSinch has no way to
 * apply in place, so it is the case that proves the fallback chain still works.
 *
 * Two dated blocks until an email says to drop the second, then one.
 */
const twoBlockReasoner = {
  ...mockReasoner,
  async extractFacts(latest: any, history: any) {
    const all = [latest, ...history].map((m: any) => m.body).join(" ");
    const dropped = /drop the second/.test(all);
    return {
      company_name: "RedBeast Energy",
      contact_name: "Piergiorgio Mammone",
      contact_email: latest.from,
      location_text: "2 Savoy Place London WC2R 0BL United Kingdom",
      requests: dropped
        ? [{ date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4, task: "Exhibition stand build" }]
        : [
            { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4, task: "Exhibition stand build" },
            { date: "2026-03-10", start_time: "09:00", end_time: "17:00", size: 2, task: "Exhibition stand derig" },
          ],
    };
  },
} as PipelineDeps["reasoner"];

const TWO_DAY = "Can I book 4 crew on 9th March 8am-6pm and 2 crew on 10th March 9am-5pm at Savoy Place?";
const DROP_ONE = "Please drop the second day — just the 4 crew on the 9th, 8am-6pm.";

const FIRST = "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?";
const thread = (bodies: Array<{ id: string; body: string; at: string }>): HydratedThread => ({
  thread_id: "t-amend",
  messages: bodies.map((b) => msg({ message_id: b.id, date_iso: b.at, body: b.body })),
});

(async () => {
  console.log("\n[1] a crew change on the SECOND email reaches OnSinch IN PLACE");
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
    ok(!deleted.length, "NOTHING was deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(second.onsinch_order_id === original, "it is still the same order, so the R number is unmoved", `#${second.onsinch_order_id}`);
    ok(teamWrites.some((w) => w.method === "PATCH"), "the crew block was PATCHed rather than rebuilt", JSON.stringify(teamWrites));
    ok(second.status === "ordered", "the thread reads as ordered", second.status);
    ok(
      second.order_action_log.some((l) => l.kind === "amend" && l.ok),
      "the action log records an amend, not a replace or a patch",
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
    created.length = 0; deleted.length = 0; teamWrites.length = 0; teamsOf.clear(); nextId = 9101; provisional = true;
    const { deps } = rig();
    await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];
    provisional = false; // a human took the order on in OnSinch

    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Actually please make it 6 crew instead.", at: "2026-02-13T09:00:00Z" },
    ]), deps);

    // THE REGRESSION THIS CASE NOW GUARDS, WHICH IS THE OPPOSITE OF THE ONE IT USED TO.
    //
    // It used to assert that flipping `provisional` to false sent the amendment to a
    // human. That flag stopped meaning anything on 2026-08-25: orders are raised in the
    // To Confirm posture, so provisional=false is the state EVERY order the engine
    // writes is born in. The old assertion would have made the engine refuse every
    // amendment it ever attempted — the failure this file exists to catch.
    //
    // Nothing is deleted here either way, because the change is a size and amending in
    // place destroys nothing. Deletion is still refused when crew are signed on: [5],
    // [7] and [8] below hold that line, on attendance rather than on a flag.
    ok(!deleted.includes(original), "nothing was deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(second.status !== "needs-info", "provisional=false does NOT send the amendment to a human", second.status);
    ok(teamWrites.some((w) => w.method === "PATCH"), "the crew change is applied in place", JSON.stringify(teamWrites));
  }

  console.log("\n[3] a follow-up that changes no crew must not destroy the order");
  {
    created.length = 0; deleted.length = 0; teamWrites.length = 0; teamsOf.clear(); nextId = 9201; provisional = true;
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

  console.log("\n[4] a DROPPED crew block still falls back to delete-and-repost");
  {
    // OnSinch cannot remove a slot team — DELETE is 405, size 0 is refused, the floor is
    // 1 — so this is the one shape of amendment that still has to rebuild the order. It
    // is why the replace path stays in the codebase.
    created.length = 0; deleted.length = 0; teamWrites.length = 0; teamsOf.clear(); nextId = 9501; provisional = true; assigned = 0;
    const { deps } = rig(twoBlockReasoner);
    await handleThread(thread([{ id: "m1", body: TWO_DAY, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];
    const before = (teamsOf.get(original) ?? []).length;

    const second = await handleThread(thread([
      { id: "m1", body: TWO_DAY, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: DROP_ONE, at: "2026-02-13T09:00:00Z" },
    ]), deps);

    const after = (second.desired_order?.slot_teams ?? []).length;
    ok(after < before, `the amendment really does drop a block (${before} -> ${after})`);
    ok(deleted.includes(original), "so the order was REBUILT — a slot team cannot be removed", `deleted=${JSON.stringify(deleted)}`);
    ok(second.onsinch_order_id !== original, "and this one IS a replacement", `#${second.onsinch_order_id}`);
    ok(!teamWrites.some((w) => w.method === "PATCH"), "the in-place path declined without writing anything", JSON.stringify(teamWrites));
  }

  console.log("\n[5] a staffed order is AMENDED now, not refused — unless a block shrinks");
  {
    // Measured on the live tenant 2026-08-19: 18 of the 40 most recent PROVISIONAL orders
    // already had crew assigned, one of them 94 people. None of those orders could be
    // amended at all, because the only route was a rebuild and a rebuild detaches every
    // one of them. In place, growing a block is safe, so it goes.
    created.length = 0; deleted.length = 0; teamWrites.length = 0; teamsOf.clear(); nextId = 9301; provisional = true; assigned = 14;
    const { deps } = rig();
    await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];

    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Actually please make it 6 crew instead.", at: "2026-02-13T09:00:00Z" },
    ]), deps);

    ok(!deleted.includes(original), "the staffed order was NOT deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(second.onsinch_order_id === original, "it is still the same order", `#${second.onsinch_order_id}`);
    ok(second.status === "ordered", "and the change LANDED — this used to be needs-info", second.status);
    ok(teamWrites.some((w) => w.method === "PATCH"), "growing a staffed block is applied", JSON.stringify(teamWrites));
    assigned = 0;
  }

  console.log("\n[6] shrinking a block people are signed on to is refused, and sends nothing");
  {
    created.length = 0; deleted.length = 0; teamWrites.length = 0; teamsOf.clear(); nextId = 9601; provisional = true; assigned = 3;
    const { deps } = rig();
    await handleThread(thread([{ id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];

    const second = await handleThread(thread([
      { id: "m1", body: FIRST, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: "Actually please make it 2 crew instead.", at: "2026-02-13T09:00:00Z" },
    ]), deps);

    ok(!deleted.includes(original), "nothing was deleted", `deleted=${JSON.stringify(deleted)}`);
    ok(!teamWrites.length, "and nothing was written to the crew blocks either", JSON.stringify(teamWrites));
    ok(second.status === "needs-info", "the thread asks for a human", second.status);
    ok(second.notes.some((n) => /signed on/.test(n)), "and the note says people are signed on to it", second.notes.join(" | "));
    assigned = 0;
  }

  console.log("\n[7] an order with crew already signed on is NEVER rebuilt");
  {
    /**
     * The rebuild path's own staffed guard, and the only test of it. It needs an
     * amendment the in-place path CANNOT take — a dropped block — because in-place now
     * handles everything else and the rebuild would never be reached.
     *
     * Measured on the live tenant 2026-08-19: 18 of the 40 most recent provisional orders
     * already had crew signed on, one of them 94 people. A rebuild detaches every one of
     * them, so a dropped block on a staffed order goes to a human and nothing is touched.
     */
    created.length = 0; deleted.length = 0; teamWrites.length = 0; teamsOf.clear(); nextId = 9701; provisional = true; assigned = 14;
    const { deps } = rig(twoBlockReasoner);
    await handleThread(thread([{ id: "m1", body: TWO_DAY, at: "2026-02-12T10:00:00Z" }]), deps);
    const original = created[0];

    const second = await handleThread(thread([
      { id: "m1", body: TWO_DAY, at: "2026-02-12T10:00:00Z" },
      { id: "m2", body: DROP_ONE, at: "2026-02-13T09:00:00Z" },
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

  console.log("[8] an unreadable attendance count refuses rather than guessing");
  {
    created.length = 0; deleted.length = 0; teamWrites.length = 0; teamsOf.clear(); nextId = 9401; provisional = true; assigned = -999; // sentinel: throw
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
