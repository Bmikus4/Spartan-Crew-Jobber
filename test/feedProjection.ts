// ============================================================================
// The live feed's projection: what the office TV says, and in what order.
// ----------------------------------------------------------------------------
// The four status phrases are the requester's own words and are pinned byte for byte.
// Red and blue follow the label rule (is there an order?), not the classification, so a
// card can never say "update" beside "needs created".
// Run: npx tsx test/feedProjection.ts
// ============================================================================
import { project, STATUS_TEXT, GREEN_DWELL_MS, UNCHECKED_EXPIRY_MS, type FeedMark } from "../app/lib/feed/project";
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
  // classified as an update, but no order exists: the label is Order Needs Built.
  const p = project([needsCreated("x", { classification: "update" }), needsUpdated("y"), created("z", NOW - H)], new Map(), [], null, NOW);
  const by = new Map(p.cards.map((c) => [c.thread_id, c]));
  ok(by.get("x")?.colour === "red" && by.get("x")?.items[0].kind === "needs-created", "an 'update' with no order is red and needs created");
  ok(by.get("y")?.colour === "blue", "a need on an order is blue");
  ok(by.get("z")?.colour === "blue", "a created order is blue");
  ok(by.get("x")?.r_number === null && by.get("y")?.r_number === "R11312" && by.get("y")?.j_number === "J13925", "R and J numbers only where an order exists");
  // a held write on an order awaiting confirmation is already a need
  const held = project([st({ thread_id: "h", status: "proposed", pending_order: {} as never })], new Map(), [], null, NOW);
  ok(held.cards[0]?.items[0].kind === "needs-created", "a held write is a need with no special case");
}

console.log("\n[3] keys");
{
  const p = project([needsCreated("a"), needsUpdated("b"), created("c", 1_700_000_000_000)], new Map([["a", NOW - 2 * H]]), [], null, NOW - 0);
  const keys = p.cards.map((c) => c.items[0].item_key).concat(project([created("c", NOW - H)], new Map(), [], null, NOW).cards.map((c) => c.items[0].item_key));
  ok(keys.includes(`needs-created:a:0:${NOW - 2 * H}`), "needs key: kind, thread, no order, latest client email", keys.join(" "));
  ok(keys.includes("needs-updated:b:900:0"), "needs key carries the order");
  ok(keys.includes(`created-check:901:${NOW - H}`), "check key: kind, order, the write's ts");
}

console.log("\n[4] ordering: replies, then needs oldest first, then checks newest first");
{
  const inbound = new Map([["n-old", NOW - 9 * H], ["n-new", NOW - 1 * H]]);
  const p = project(
    [created("c-old", NOW - 8 * H), needsCreated("n-new"), created("c-new", NOW - 2 * H), needsUpdated("n-old")],
    inbound, [], [{ thread_id: "r", since_iso: new Date(NOW - 30 * H).toISOString(), company: "Acme", contact: "Jo Bloggs", subject: "Re: quote" }], NOW);
  const order = p.cards.map((c) => c.thread_id).join(",");
  ok(order === "r,n-old,n-new,c-new,c-old", "lane order", order);
  ok(p.cards[0].colour === "neutral" && p.cards[0].contact === "Jo", "a reply-only card is neutral grey and shows a first name");
}

console.log("\n[5] one card carries two needs");
{
  const p = project([needsUpdated("b")], new Map(), [], [{ thread_id: "b", since_iso: new Date(NOW - 30 * H).toISOString(), company: null, contact: null, subject: "s" }], NOW);
  ok(p.cards.length === 1, "one card for the thread");
  ok(p.cards[0].items.map((i) => i.kind).join("+") === "needs-updated+needs-reply", "carrying the order need and the reply");
  ok(p.cards[0].colour === "blue" && p.cards[0].lane === "reply", "keeps its order colour and rises with the replies");
  ok(p.counts.needs_updated === 1 && p.counts.needs_reply === 1, "both counted");
}

console.log("\n[6] green: a mark turns the item green, dwell and expiry");
{
  const mark = (key: string, at: number, m: FeedMark["mark"] = "checked"): FeedMark => ({ item_key: key, thread_id: "c", mark: m, by: "kate@spartancrew.co.uk", evidence: null, at });
  const key = `created-check:901:${NOW - H}`;
  let p = project([created("c", NOW - H)], new Map(), [mark(key, NOW - 10 * 60_000)], null, NOW);
  ok(p.cards[0]?.green === true && p.cards[0].items[0].green?.by === "kate@spartancrew.co.uk", "ticked: green, with who");
  ok(p.counts.verified === 1 && p.counts.to_verify === 0, "counted verified, not to verify");
  p = project([created("c", NOW - 4 * H)], new Map(), [mark(`created-check:901:${NOW - 4 * H}`, NOW - GREEN_DWELL_MS - 1)], null, NOW);
  ok(p.cards.length === 0, "a green card leaves after the dwell");
  p = project([created("c", NOW - UNCHECKED_EXPIRY_MS - H)], new Map(), [], null, NOW);
  ok(p.cards.length === 0 && p.counts.older_unchecked === 1, "an unverified check leaves after 7 days into older, unchecked");
  p = project([needsCreated("n")], new Map([["n", NOW - UNCHECKED_EXPIRY_MS - H]]), [], null, NOW);
  ok(p.cards.length === 1, "a need does not expire");
  // the tick shows over automatic evidence, but the earliest mark decides when it went green
  p = project([created("c", NOW - H)], new Map(), [mark(key, NOW - 50 * 60_000, "staff-edit"), mark(key, NOW - 5 * 60_000)], null, NOW);
  ok(p.cards[0]?.items[0].green?.mark === "checked" && p.cards[0].items[0].green?.at === NOW - 50 * 60_000, "two marks: the tick is shown, the first one dates it");
}

console.log("\n[7] a tick on one event does not turn a later event green");
{
  const first = `updated-check:902:${NOW - 5 * H}`;
  const m: FeedMark = { item_key: first, thread_id: "d", mark: "checked", by: "x", evidence: null, at: NOW - 4 * H };
  const p = project([updated("d", NOW - H)], new Map(), [m], null, NOW);
  ok(p.cards[0]?.green === false, "a later engine write is a new item, not green");
  const n1 = `needs-updated:b:900:${NOW - 5 * H}`;
  const q = project([needsUpdated("b")], new Map([["b", NOW - H]]), [{ ...m, item_key: n1, thread_id: "b" }], null, NOW);
  ok(q.cards[0]?.green === false, "a need ticked before the client's next email is open again after it");
}

console.log("\n[8] what is left out");
{
  const p = project([
    needsCreated("past", { facts: { requests: [{ date: "2026-09-30" }] } }),
    needsCreated("undated", { facts: { requests: [{}] } }),
    st({ thread_id: "naj", classification: "not-a-job", status: "error" }),
    st({ thread_id: "cancel", classification: "not-a-job", cancellation: true, onsinch_order_id: 77 }),
    st({ thread_id: "unbooked-ok", status: "ordered" }),
    st({ thread_id: "review", status: "ordered", needs_human: true, review_only: true, onsinch_order_id: 5, order_action_log: [{ ts: NOW - H, kind: "create", order_id: 5, ok: true }] }),
  ], new Map(), [], null, NOW);
  const ids = p.cards.map((c) => c.thread_id);
  ok(!ids.includes("past"), "a job whose dates have passed");
  ok(ids.includes("undated"), "an undated job stays");
  ok(!ids.includes("naj"), "not-a-job");
  ok(ids.includes("cancel") && p.cards.find((c) => c.thread_id === "cancel")?.items[0].kind === "needs-updated", "except a cancellation of a booked job, which the engine itself holds as a need");
  ok(!ids.includes("unbooked-ok"), "a thread with nothing booked and nothing needed");
  ok(p.cards.find((c) => c.thread_id === "review")?.items[0].kind === "created-check", "a review-only booking is a check, not a need");
}

console.log("\n[9] crew is the busiest day, not the sum");
{
  const teams = (d: string, n: number) => ({ name: "", profession_id: 1, beginning: `${d}T08:00:00+01:00`, end: `${d}T18:00:00+01:00`, size: n, place_id: 1 });
  const p = project([created("c", NOW - H, { desired_order: { slot_teams: [teams("2026-10-16", 6), teams("2026-10-16", 2), teams("2026-10-17", 5)] } as never })], new Map(), [], null, NOW);
  ok(p.cards[0]?.crew === 8, "two blocks on the 16th (6+2) beat five on the 17th", String(p.cards[0]?.crew));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
