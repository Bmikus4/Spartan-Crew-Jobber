// ============================================================================
// The live feed's projection: what the office TV says, and in what order.
// ----------------------------------------------------------------------------
// The four status phrases are the requester's own words and are pinned byte for byte.
// Red and blue follow the label rule (is there an order?), not the classification, so a
// card can never say "update" beside "needs created". An order or update the engine
// made is done (green) the moment it is written (Ben, 2026-10-04).
// Run: npx tsx test/feedProjection.ts
// ============================================================================
import { project, STATUS_TEXT, DONE_DWELL_MS, STALE_UNDATED_MS, dismissKey, londonInstant, type FeedMark } from "../app/lib/feed/project";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NOW = Date.parse("2026-10-03T12:00:00Z");
const H = 3_600_000;

function st(over: Partial<ConversationState>): ConversationState {
  return {
    thread_id: "t", subject: "Crew for Friday", participants: [], last_message_id: "m", last_processed_epoch: NOW - 5 * H,
    classification: "new-job", facts: { company_name: "Blackout Limited", contact_name: "Sam Jones", location_text: "ExCeL London", requests: [{ date: "2026-10-16", size: 4 }] },
    desired_order: null, priority: "medium", status: "ordered", notes: [], order_action_log: [],
    ...over,
  } as ConversationState;
}
const needsCreated = (id: string, over: Partial<ConversationState> = {}) => st({ thread_id: id, status: "needs-info", ...over });
const needsUpdated = (id: string, over: Partial<ConversationState> = {}) => st({ thread_id: id, classification: "update", status: "error", onsinch_order_id: 900, onsinch_order_number: "11312", onsinch_job_id: 13925, ...over });
const created = (id: string, ts: number, over: Partial<ConversationState> = {}) => st({ thread_id: id, onsinch_order_id: 901, onsinch_order_number: "11400", onsinch_job_id: 14000, order_action_log: [{ ts, kind: "create", order_id: 901, ok: true }], ...over });
const updated = (id: string, ts: number, over: Partial<ConversationState> = {}) => st({ thread_id: id, classification: "update", onsinch_order_id: 902, onsinch_order_number: "11401", order_action_log: [{ ts: ts - 3 * H, kind: "create", order_id: 902, ok: true }, { ts, kind: "patch", order_id: 902, ok: true }], ...over });
const mark = (key: string, thread: string, at: number, m: FeedMark["mark"] = "checked"): FeedMark => ({ item_key: key, thread_id: thread, mark: m, by: "kate@spartancrew.co.uk", evidence: null, at });

console.log("\n[1] the four phrases, byte for byte");
{
  ok(STATUS_TEXT["needs-created"] === "Order needs created", "needs created");
  ok(STATUS_TEXT["needs-updated"] === "Order needs updated", "needs updated");
  ok(STATUS_TEXT["created-check"] === "Order was created, check to verify", "created, check");
  ok(STATUS_TEXT["updated-check"] === "Order was updated, check to verify", "updated, check");
  const p = project([needsCreated("a"), needsUpdated("b"), created("c", NOW - H), updated("d", NOW - H)], new Map(), [], null, NOW);
  const by = new Map(p.cards.map((c) => [c.thread_id, c]));
  ok(by.get("a")?.items[0].status === "Order needs created", "a held new job reads needs created");
  ok(by.get("b")?.items[0].status === "Order needs updated", "a failed update on an order reads needs updated");
  ok(by.get("c")?.items[0].status === "Order was created, check to verify", "a create reads created, check");
  ok(by.get("d")?.items[0].status === "Order was updated, check to verify", "a patch reads updated, check");
}

console.log("\n[2] red and blue come from the order, not the classification");
{
  const p = project([needsCreated("x", { classification: "update" }), needsUpdated("y"), created("z", NOW - H)], new Map(), [], null, NOW);
  const by = new Map(p.cards.map((c) => [c.thread_id, c]));
  ok(by.get("x")?.colour === "red" && by.get("x")?.items[0].kind === "needs-created", "an 'update' with no order is red and needs created");
  ok(by.get("y")?.colour === "blue", "a need on an order is blue");
  ok(by.get("z")?.colour === "blue", "a created order is blue");
  ok(by.get("x")?.r_number === null && by.get("y")?.r_number === "R11312" && by.get("y")?.j_number === "J13925", "R and J numbers only where an order exists");
  const held = project([st({ thread_id: "h", status: "proposed", pending_order: {} as never })], new Map(), [], null, NOW);
  ok(held.cards[0]?.items[0].kind === "needs-created", "a held write is a need with no special case");
}

console.log("\n[3] what the engine made is done the moment it is made");
{
  const p = project([created("c", NOW - H), updated("d", NOW - 2 * H)], new Map(), [], null, NOW);
  const c = p.cards.find((x) => x.thread_id === "c")!;
  ok(c.green && c.lane === "done" && c.items[0].green?.mark === "made", "a create is green, in the done group, marked made");
  ok((c.items[0].green?.evidence as { text: string }).text === "Order created by the system", "and says so");
  ok(p.counts.done === 2 && p.counts.needs_created === 0, "both counted as done");
  const t = project([created("c", NOW - H)], new Map(), [mark(`created-check:901:${NOW - H}`, "c", NOW - 60_000)], null, NOW);
  ok(t.cards[0].items[0].green?.mark === "checked" && t.cards[0].items[0].green?.by === "kate@spartancrew.co.uk", "a tick on it shows who checked it");
  ok(t.cards[0].items[0].green?.at === NOW - H, "but it went green when the engine wrote it");
}

console.log("\n[4] keys");
{
  const p = project([needsCreated("a"), needsUpdated("b"), created("c", NOW - H)], new Map([["a", NOW - 2 * H]]), [], null, NOW);
  const keys = p.cards.map((c) => c.items[0].item_key);
  ok(keys.includes(`needs-created:a:0:${NOW - 2 * H}`), "needs key: kind, thread, no order, latest client email", keys.join(" "));
  ok(keys.includes("needs-updated:b:900:0"), "needs key carries the order");
  ok(keys.includes(`created-check:901:${NOW - H}`), "made key: kind, order, the write's ts");
}

console.log("\n[5] ordering: replies, then needs oldest first, then done newest first");
{
  const inbound = new Map([["n-old", NOW - 9 * H], ["n-new", NOW - 1 * H]]);
  const p = project(
    [created("c-old", NOW - 8 * H), needsCreated("n-new"), created("c-new", NOW - 2 * H), needsUpdated("n-old")],
    inbound, [], [{ thread_id: "r", since_iso: new Date(NOW - 30 * H).toISOString(), company: "Acme", contact: "Jo Bloggs", subject: "Re: quote" }], NOW);
  const order = p.cards.map((c) => c.thread_id).join(",");
  ok(order === "r,n-old,n-new,c-new,c-old", "lane order", order);
  ok(p.cards[0].colour === "neutral" && p.cards[0].contact === "Jo", "a reply-only card is neutral grey and shows a first name");
}

console.log("\n[6] one card carries two needs");
{
  const p = project([needsUpdated("b")], new Map(), [], [{ thread_id: "b", since_iso: new Date(NOW - 30 * H).toISOString(), company: null, contact: null, subject: "s" }], NOW);
  ok(p.cards.length === 1, "one card for the thread");
  ok(p.cards[0].items.map((i) => i.kind).join("+") === "needs-updated+needs-reply", "carrying the order need and the reply");
  ok(p.cards[0].colour === "blue" && p.cards[0].lane === "reply", "keeps its order colour and rises with the replies");
  ok(p.counts.needs_updated === 1 && p.counts.needs_reply === 1, "both counted");
}

console.log("\n[7] green needs, and how long done work stays");
{
  const key = `needs-updated:b:900:${NOW - 3 * H}`;
  let p = project([needsUpdated("b")], new Map([["b", NOW - 3 * H]]), [mark(key, "b", NOW - 10 * 60_000, "staff-edit")], null, NOW);
  ok(p.cards[0]?.green === true && p.cards[0].lane === "done" && p.counts.done === 1 && p.counts.needs_updated === 0, "a staff edit closes a need");
  p = project([needsUpdated("b")], new Map([["b", NOW - 3 * H]]), [mark(key, "b", NOW - DONE_DWELL_MS - 1)], null, NOW);
  ok(p.cards.length === 0, "a done card leaves after a day");
  p = project([created("c", NOW - DONE_DWELL_MS + H)], new Map(), [], null, NOW);
  ok(p.cards.length === 1, "a create from 23 hours ago is still on the list");
  p = project([needsUpdated("b")], new Map([["b", NOW - 3 * H]]), [mark(key, "b", NOW - H, "history")], null, NOW);
  ok(p.cards[0]?.green === false, "a history record is not evidence of anything");
}

console.log("\n[8] a tick on one event does not turn a later event green");
{
  const n1 = `needs-updated:b:900:${NOW - 5 * H}`;
  const q = project([needsUpdated("b")], new Map([["b", NOW - H]]), [mark(n1, "b", NOW - 4 * H)], null, NOW);
  ok(q.cards[0]?.green === false, "a need ticked before the client's next email is open again after it");
}

console.log("\n[9] what is left out");
{
  const p = project([
    needsCreated("past", { facts: { requests: [{ date: "2026-09-30" }] } }),
    needsCreated("undated", { facts: { requests: [{}] } }),
    needsCreated("stale", { facts: { requests: [{}] } }),
    needsCreated("stale-dated"),
    needsCreated("test"),
    st({ thread_id: "naj", classification: "not-a-job", status: "error" }),
    st({ thread_id: "cancel", classification: "not-a-job", cancellation: true, onsinch_order_id: 77 }),
    st({ thread_id: "unbooked-ok", status: "ordered" }),
  ], new Map([["undated", NOW - 2 * 86_400_000], ["stale", NOW - STALE_UNDATED_MS - H], ["stale-dated", NOW - STALE_UNDATED_MS - H]]),
  [{ item_key: dismissKey("test"), thread_id: "test", mark: "dismissed", by: "audit", evidence: { reason: "test enquiry" }, at: NOW }], null, NOW);
  const ids = p.cards.map((c) => c.thread_id);
  ok(!ids.includes("past"), "a job whose dates have passed");
  ok(ids.includes("undated"), "an undated job the client wrote about recently stays");
  ok(!ids.includes("stale") && p.counts.older === 1, "an undated job silent for a fortnight goes to older");
  ok(ids.includes("stale-dated"), "a dated job does not go stale; its date decides");
  ok(!ids.includes("test") && p.counts.needs_created === 2, "a dismissed thread is gone and not counted");
  ok(!ids.includes("naj"), "not-a-job");
  ok(ids.includes("cancel") && p.cards.find((c) => c.thread_id === "cancel")?.items[0].kind === "needs-updated", "except a cancellation of a booked job");
  ok(!ids.includes("unbooked-ok"), "a thread with nothing booked and nothing needed");
}

console.log("\n[10] crew is the busiest day, not the sum");
{
  const teams = (d: string, n: number) => ({ name: "", profession_id: 1, beginning: `${d}T08:00:00+01:00`, end: `${d}T18:00:00+01:00`, size: n, place_id: 1 });
  const p = project([created("c", NOW - H, { desired_order: { slot_teams: [teams("2026-10-16", 6), teams("2026-10-16", 2), teams("2026-10-17", 5)] } as never })], new Map(), [], null, NOW);
  ok(p.cards[0]?.crew === 8, "two blocks on the 16th (6+2) beat five on the 17th", String(p.cards[0]?.crew));
}

console.log("\n[11] when the job starts, for the countdown");
{
  ok(londonInstant("2026-10-16", "08:00") === Date.parse("2026-10-16T07:00:00Z"), "08:00 in October is 07:00 UTC (BST)");
  ok(londonInstant("2026-12-07", "08:00") === Date.parse("2026-12-07T08:00:00Z"), "08:00 in December is 08:00 UTC (GMT)");
  const team = (iso: string) => ({ name: "", profession_id: 1, beginning: iso, end: iso, size: 2, place_id: 1 });
  const p = project([created("c", NOW - H, { desired_order: { slot_teams: [team("2026-10-03T09:00:00+01:00"), team("2026-10-04T07:30:00+01:00")] } as never })], new Map(), [], null, NOW);
  ok(p.cards[0]?.starts_at === Date.parse("2026-10-04T06:30:00Z"), "the first block not yet started, not one already under way", String(p.cards[0]?.starts_at));
  const q = project([needsCreated("n", { facts: { requests: [{ date: "2026-10-05", start_time: "06:00" }] } })], new Map(), [], null, NOW);
  ok(q.cards[0]?.starts_at === Date.parse("2026-10-05T05:00:00Z"), "a request's date and time are London's");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
