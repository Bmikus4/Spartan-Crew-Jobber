// ============================================================================
// Delete-and-repost: the destructive path, and every way it must refuse or recover.
// ----------------------------------------------------------------------------
// A crew or time change cannot be PATCHed onto an existing order — nested slot teams
// expose no ids and GET /slot_teams is 405 — so the only route is to delete the draft
// and post the corrected one. That means the engine can now destroy a real booking, and
// the tests that matter are not the happy path.
//
// What is proven here:
//   REFUSAL   a non-draft order, a vanished order, another company's order, and a
//             replacement with no crew or no dates are all declined WITHOUT deleting.
//   ORDER     the snapshot is persisted BEFORE the delete, and the deletion BEFORE the
//             create. Asserted on a recorded sequence, not by reading the code.
//   RECOVERY  a create that fails after the delete leaves the snapshot and deleted:true
//             on the record, marks needs_human, and the retry re-posts WITHOUT deleting
//             a second time.
//   RESTRAINT a follow-up that changes no crew and no times patches as before.
//
// Fixtures only: a fake transport, an in-memory store. Nothing reaches OnSinch.
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { confirmOrder, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { DEFAULT_SETTINGS, type DesiredOrder } from "../app/lib/engine/types";
import { mockReasoner } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

const desired = (size = 4, end = "2026-09-12T16:00:00+01:00"): DesiredOrder => ({
  name: "Event Concept @ Tobacco Dock",
  company_id: 501, user_id: 9001,
  request_approval: true, provisional: true, quote: true,
  pricelist_category_id: 342,
  job_name: `${size} at Tobacco Dock on 2026-09-12`,
  slot_teams: [
    { name: "Crew", profession_id: 1, beginning: "2026-09-12T09:00:00+01:00", end, size, place_id: 304 },
  ],
  specification: "Get-in",
});

/**
 * A fake OnSinch that records every write in order, so the SEQUENCE can be asserted.
 * `liveOrder` is what GET returns; `failCreate` makes the POST throw the way a real
 * validation error or a timeout would.
 */
function fakeOnsinch(opts: { liveOrder?: Record<string, unknown> | null; failCreate?: boolean } = {}) {
  const calls: string[] = [];
  const live = opts.liveOrder === undefined
    ? { id: 13632, provisional: true, quote: true, company_id: 501, name: "Event Concept @ Tobacco Dock" }
    : opts.liveOrder;
  const client = new OnsinchClient(async (method, path, body) => {
    if (method === "GET" && path.startsWith("/orders")) {
      calls.push("GET");
      return { status: 200, data: { data: live ? [live] : [], pagination: { pageCount: 1, count: live ? 1 : 0 } } };
    }
    if (method === "DELETE" && path === "/orders") {
      calls.push(`DELETE ${JSON.stringify(body)}`);
      return { status: 200, data: null };
    }
    if (method === "POST" && path === "/orders") {
      calls.push("POST");
      if (opts.failCreate) throw new Error("createOrder 422: validationErrors");
      return { status: 201, data: { data: [{ id: 14001, number: "10999" }] } };
    }
    return { status: 200, data: { data: [], pagination: { pageCount: 1, count: 0 } } };
  });
  return { client, calls };
}

/** Hooks that record when each persistence point fired, interleaved with the API calls. */
function recordingHooks(calls: string[]) {
  const seen: unknown[] = [];
  return {
    seen,
    onIntent: async (snapshot: unknown) => { calls.push("PERSIST intent"); seen.push(snapshot); },
    onDeleted: async () => { calls.push("PERSIST deleted"); },
  };
}

console.log("replace order (delete + re-post)");

async function main() {

// ------------------------------------------------------------------ refusals
{
  const { client, calls } = fakeOnsinch({ liveOrder: { id: 13632, provisional: false, quote: true, company_id: 501 } });
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: desired() }, recordingHooks(calls));
  ok(!!r.refused && /no longer a draft/.test(r.refused), "an APPROVED order is refused, not deleted", r.refused);
  ok(!calls.some((c) => c.startsWith("DELETE")), "and nothing was deleted", calls.join(" -> "));
}
{
  const { client, calls } = fakeOnsinch({ liveOrder: { id: 13632, provisional: true, quote: false, company_id: 501 } });
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: desired() }, recordingHooks(calls));
  ok(!!r.refused, "quote=false alone is enough to refuse — both flags are the draft posture");
  ok(!calls.some((c) => c.startsWith("DELETE")), "still nothing deleted");
}
{
  const { client, calls } = fakeOnsinch({ liveOrder: null });
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: desired() }, recordingHooks(calls));
  ok(!!r.refused && /no longer exists/.test(r.refused), "a vanished order is refused, not silently recreated", r.refused);
  ok(!calls.includes("POST"), "and no duplicate is posted", calls.join(" -> "));
}
{
  const { client, calls } = fakeOnsinch({ liveOrder: { id: 13632, provisional: true, quote: true, company_id: 777 } });
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: desired() }, recordingHooks(calls));
  ok(!!r.refused && /another client's order/.test(r.refused), "an order belonging to a different company is refused", r.refused);
  ok(!calls.some((c) => c.startsWith("DELETE")), "another client's order is never deleted");
}
{
  const { client, calls } = fakeOnsinch();
  const empty = { ...desired(), slot_teams: [] };
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: empty }, recordingHooks(calls));
  ok(!!r.refused && /no slot teams/.test(r.refused), "a replacement with no crew is refused — that is a deletion in disguise");
  ok(calls.length === 0, "and it refuses before even reading OnSinch", calls.join(" -> "));
}
{
  const { client, calls } = fakeOnsinch();
  const tbc = { ...desired(), slot_teams: [{ name: "Crew (TBC)", profession_id: 1, beginning: "", end: "", size: 4, place_id: 304 }] };
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: tbc }, recordingHooks(calls));
  ok(!!r.refused && /no start or finish/.test(r.refused), "a TBC date is refused — never trade a real order for a dateless one");
  ok(calls.length === 0, "again without touching OnSinch");
}

// --------------------------------------------------- the happy path, in order
{
  const { client, calls } = fakeOnsinch();
  const hooks = recordingHooks(calls);
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: desired(6) }, hooks);
  ok(r.created?.id === 14001, "the replacement is created and its id returned", String(r.created?.id));
  ok(r.deleted === true, "and the call reports that it deleted");
  const seq = calls.join(" -> ");
  ok(seq === "GET -> PERSIST intent -> DELETE [13632] -> PERSIST deleted -> POST",
     "the sequence is read, persist, delete, persist, create", seq);
  ok((hooks.seen[0] as Record<string, unknown>)?.id === 13632,
     "the snapshot handed to the caller is the order that was destroyed", JSON.stringify(hooks.seen[0]));
}

// ------------------------------------------ create fails after the delete
{
  const { client, calls } = fakeOnsinch({ failCreate: true });
  const hooks = recordingHooks(calls);
  let threw: Error | null = null;
  try { await replaceProvisionalOrder(client, { order_id: 13632, desired: desired(6) }, hooks); }
  catch (e) { threw = e as Error; }
  ok(!!threw, "a failed create throws rather than returning quietly");
  ok(calls.includes("PERSIST deleted"), "and 'deleted' was persisted BEFORE the create was attempted", calls.join(" -> "));
  ok(hooks.seen.length === 1, "so the snapshot of the destroyed order is on the record", String(hooks.seen.length));
}

// ------------------------------------------------- resuming never deletes twice
{
  const { client, calls } = fakeOnsinch();
  const r = await replaceProvisionalOrder(client, { order_id: 13632, desired: desired(6), alreadyDeleted: true }, recordingHooks(calls));
  ok(r.created?.id === 14001, "a resumed replace posts the replacement");
  ok(!calls.some((c) => c.startsWith("DELETE")), "and does NOT delete again", calls.join(" -> "));
  ok(!calls.includes("GET"), "nor preflight a deleted order into a refusal", calls.join(" -> "));
}

// -------------------------------------------------- deleteOrders refuses junk
{
  const { client } = fakeOnsinch();
  let threw = 0;
  for (const ids of [[], [0], [NaN], [-1]]) {
    try { await client.deleteOrders(ids as number[]); } catch { threw++; }
  }
  ok(threw === 4, "deleteOrders refuses an empty list and any non-id", String(threw));
}

// ------------------------------------------------ the trigger: teams vs no teams
// The pipeline only replaces when the slot-team fingerprint moved. This is that
// arithmetic, checked directly — a PO-only follow-up must not delete a real order.
{
  const before = hashOrder(desired(4).slot_teams);
  ok(hashOrder(desired(4).slot_teams) === before, "identical teams hash identically — no replace triggered");
  ok(hashOrder(desired(6).slot_teams) !== before, "a changed crew size changes the hash — replace triggered");
  ok(hashOrder(desired(4, "2026-09-12T18:00:00+01:00").slot_teams) !== before,
     "a changed finish time changes the hash too");
  const poOnly = { ...desired(4), intern_name: "PO-12345" };
  ok(hashOrder(poOnly.slot_teams) === before,
     "adding a PO leaves the teams hash untouched, so no order is destroyed for it");
}

// ------------------------------------------- the store really persists mid-flight
// InMemoryStore stands in for Neon here: the point is that the caller's hooks write
// something a later run can read, not that Postgres works.
{
  const store = new InMemoryStore();
  const { client, calls } = fakeOnsinch({ failCreate: true });
  const state = {
    thread_id: "t-replace", subject: "Re: crew change", participants: ["a@b.com"],
    last_message_id: "m3", last_processed_epoch: 1, classification: "update" as const,
    facts: { requests: [] }, desired_order: desired(6), priority: "medium" as const,
    needs_human: false, status: "ordered" as const, notes: [], order_action_log: [],
    onsinch_order_id: 13632,
  };
  await store.put(state as never);
  try {
    await replaceProvisionalOrder(client, { order_id: 13632, desired: desired(6) }, {
      async onIntent(snapshot) {
        await store.put({ ...(await store.get("t-replace"))!, order_replace: { order_id: 13632, deleted: false, snapshot, ts: 1 } } as never);
      },
      async onDeleted() {
        const cur = (await store.get("t-replace"))!;
        await store.put({ ...cur, order_replace: { ...cur.order_replace!, deleted: true } } as never);
      },
    });
  } catch { /* expected */ }
  const after = await store.get("t-replace");
  ok(after?.order_replace?.deleted === true, "after a failed replace the store says the order was deleted");
  ok(!!after?.order_replace?.snapshot, "and holds the snapshot needed to recreate it by hand");
  // These hooks write to the store rather than to `calls`, so the sequence assertion
  // here is over the API calls only; the two checks above are what prove the writes
  // landed, and the recorded-hook case earlier proves the interleaving.
  ok(calls.join(" -> ") === "GET -> DELETE [13632] -> POST", "the API sequence is read, delete, create", calls.join(" -> "));
}

// ===========================================================================
// Through the real pipeline. confirmOrder is the live path — order_mode is
// draft-only, so every order write goes through a human pressing confirm.
// ===========================================================================
console.log("\nthrough confirmOrder");

/** A thread already staged as a patch of a real order, as the live board holds them. */
const staged = (over: Record<string, unknown> = {}) => ({
  thread_id: "t-rep", subject: "Re: crew change", participants: ["izzabelle@eventconcept.com"],
  last_message_id: "m3", last_processed_epoch: 1, classification: "update" as const,
  facts: { requests: [{ date: "2026-09-12", size: 6 }] },
  company_id: 501, user_id: 9001, place_id: 304,
  onsinch_order_id: 13632,
  desired_order: desired(6),
  // The order as originally written asked for 4; the thread now asks for 6.
  last_ordered_teams_hash: hashOrder(desired(4).slot_teams),
  priority: "medium" as const, needs_human: false,
  pending_order: { kind: "patch" as const, desired: desired(6), order_id: 13632 },
  status: "proposed" as const, notes: [], order_action_log: [],
  ...over,
});

async function runConfirm(opts: {
  state?: Record<string, unknown>;
  liveOrder?: Record<string, unknown> | null;
  failCreate?: boolean;
  withReplace?: boolean;
}) {
  const { client, calls } = fakeOnsinch({ liveOrder: opts.liveOrder, failCreate: opts.failCreate });
  const store = new InMemoryStore();
  await store.put((opts.state ?? staged()) as never);
  const patched: number[] = [];

  const exec: Record<string, unknown> = {
    async createReplyDraft() { return "d1"; },
    async createOrder(o: DesiredOrder) { return client.createOrder(buildOrderBody(o)); },
    async patchOrder(p: { order_id: number }) { patched.push(p.order_id); return ["specification"]; },
  };
  if (opts.withReplace !== false) {
    exec.replaceOrder = (p: Parameters<NonNullable<Executor["replaceOrder"]>>[0]) =>
      replaceProvisionalOrder(client, { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted },
        { onIntent: p.onIntent, onDeleted: p.onDeleted });
  }

  const deps = {
    reasoner: mockReasoner, onsinch: client, store, metrics: new InMemoryMetrics(),
    settings: { ...DEFAULT_SETTINGS }, executor: exec as unknown as Executor,
    now: () => 2, hashOrder,
  } as unknown as PipelineDeps;

  const out = await confirmOrder("t-rep", deps);
  return { out, calls, patched, store };
}

{
  const { out, calls, patched } = await runConfirm({});
  ok(out?.onsinch_order_id === 14001, "a crew change replaces the draft and the thread points at the NEW order", String(out?.onsinch_order_id));
  ok(out?.status === "ordered", "status is ordered", String(out?.status));
  ok(!patched.length, "and patchOrder was not used for it", JSON.stringify(patched));
  ok(calls.join(" -> ").includes("DELETE [13632]"), "the old draft was deleted", calls.join(" -> "));
  ok((out?.notes ?? []).some((n) => /replacing draft order #13632 with #14001/.test(n)),
     "a note records the replacement so the id change is traceable", JSON.stringify(out?.notes));
  ok(out?.order_action_log.at(-1)?.kind === "replace" && out?.order_action_log.at(-1)?.ok === true,
     "the audit log records a successful replace", JSON.stringify(out?.order_action_log.at(-1)));
  ok(out?.order_replace === undefined, "and the in-flight marker is cleared");
  ok(out?.last_ordered_teams_hash === hashOrder(desired(6).slot_teams),
     "the teams fingerprint is updated, so the same change cannot replace twice");
}

{
  // The restraint case: nothing about the crew moved, so the order must survive.
  const unchanged = staged({ last_ordered_teams_hash: hashOrder(desired(6).slot_teams) });
  const { out, calls, patched } = await runConfirm({ state: unchanged });
  ok(!calls.some((c) => c.startsWith("DELETE")), "a follow-up that changes no crew deletes nothing", calls.join(" -> "));
  ok(patched.length === 1, "it patches instead, exactly as before", JSON.stringify(patched));
  ok(out?.onsinch_order_id === 13632, "and the thread still points at the original order");
}

{
  // An executor with no replaceOrder is the old world, and must behave like it.
  const { out, calls, patched } = await runConfirm({ withReplace: false });
  ok(!calls.some((c) => c.startsWith("DELETE")), "no replace capability means no deletion", calls.join(" -> "));
  ok(patched.length === 1, "it falls back to patching what it can", JSON.stringify(patched));
  ok((out?.notes ?? []).some((n) => /by hand/i.test(n)), "and still tells a human about the crew change", JSON.stringify(out?.notes));
}

{
  // Refused by preflight: the order was approved between staging and confirming.
  const { out, calls } = await runConfirm({ liveOrder: { id: 13632, provisional: false, quote: true, company_id: 501 } });
  ok(!calls.some((c) => c.startsWith("DELETE")), "an approved order is not deleted at confirm time", calls.join(" -> "));
  ok(out?.status === "needs-info", "the thread goes to needs-info", String(out?.status));
  ok(out?.order_action_log.at(-1)?.ok === false, "the log records the refusal, not a success",
     JSON.stringify(out?.order_action_log.at(-1)));
  ok((out?.notes ?? []).some((n) => /NOT applied/.test(n)), "and says the change did not land", JSON.stringify(out?.notes));
}

{
  // The incident: deleted, then the create failed.
  const { out, store } = await runConfirm({ failCreate: true });
  ok(out?.status === "error", "a failed replace is an error, not a quiet miss", String(out?.status));
  ok(out?.needs_human === true, "and it demands a human");
  ok(out?.order_replace?.deleted === true, "the marker is KEPT with deleted:true so the retry re-posts");
  ok(!!out?.order_replace?.snapshot, "and holds a snapshot of the destroyed order");
  ok((out?.notes ?? []).some((n) => /URGENT/.test(n)), "the note is unmissable", JSON.stringify(out?.notes));
  const persisted = await store.get("t-rep");
  ok(persisted?.order_replace?.deleted === true, "all of which survived to the store", JSON.stringify(persisted?.order_replace));
}

{
  // Resuming that incident on the next run: post the replacement, delete nothing.
  const wounded = staged({
    order_replace: { order_id: 13632, deleted: true, snapshot: { id: 13632 }, ts: 1 },
    status: "error", needs_human: true,
  });
  const { out, calls } = await runConfirm({ state: wounded, liveOrder: null });
  ok(!calls.some((c) => c.startsWith("DELETE")), "the resumed run deletes nothing", calls.join(" -> "));
  ok(calls.includes("POST"), "it posts the replacement", calls.join(" -> "));
  ok(out?.onsinch_order_id === 14001, "and the thread is whole again", String(out?.onsinch_order_id));
  ok(out?.order_replace === undefined, "with the in-flight marker cleared");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
if (fails) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
