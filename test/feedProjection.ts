// ============================================================================
// The live feed's projection: what the office TV says, and in what order.
// ----------------------------------------------------------------------------
// The four status phrases are the requester's own words and are pinned byte for byte.
// Red and blue follow the label rule (is there an order?), not the classification, so a
// card can never say "update" beside "needs created". An order or update the engine
// made is NOT done until a person checks it (Ben, 2026-10-05).
// Run: npx tsx test/feedProjection.ts
// ============================================================================
import { project, STATUS_TEXT, DONE_DWELL_MS, STALE_UNDATED_MS, QUIET_MS, dismissKey, londonInstant, type FeedMark } from "../app/lib/feed/project";
import type { ConversationState } from "../app/lib/engine/types";
import { v2Sources, type V2Row } from "../app/lib/feed/v2";

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

console.log("\n[2] red and blue come from the need: created is red, updated is blue");
{
  const p = project([needsCreated("x", { classification: "update" }), needsUpdated("y"), created("z", NOW - H)], new Map(), [], null, NOW);
  const by = new Map(p.cards.map((c) => [c.thread_id, c]));
  // Needs UPDATED because an update's booking exists (needsLabelFor, 2026-10-04), so blue
  // although no order is bound: the colour must agree with the label beside it.
  ok(by.get("x")?.colour === "blue" && by.get("x")?.items[0].kind === "needs-updated", "an 'update' with no order is blue and needs updated");
  ok(by.get("y")?.colour === "blue", "a need on an order is blue");
  ok(by.get("z")?.colour === "red", "a created order is red, a new job");
  ok(by.get("x")?.r_number === null && by.get("y")?.r_number === "R11312" && by.get("y")?.j_number === "J13925", "R and J numbers only where an order exists");
  const held = project([st({ thread_id: "h", status: "proposed", pending_order: {} as never })], new Map(), [], null, NOW);
  ok(held.cards[0]?.items[0].kind === "needs-created", "a held write is a need with no special case");
}

console.log("\n[3] what the engine made stays open until somebody checks it (Ben, 2026-10-05)");
{
  const p = project([created("c", NOW - H), updated("d", NOW - 2 * H)], new Map(), [], null, NOW);
  const c = p.cards.find((x) => x.thread_id === "c")!;
  ok(!c.green && c.lane === "need" && c.items[0].green === null && c.items[0].status === "Order was created, check to verify", "a create is open, reading check to verify");
  ok(p.counts.to_check === 2 && p.counts.done === 0 && p.counts.needs_created === 0 && p.counts.needs_updated === 0, "both counted to check, not done and not as needs");
  const ed = project([updated("d", NOW - 2 * H)], new Map(), [{ ...mark(`updated-check:902:${NOW - 2 * H}`, "d", NOW - H, "staff-edit"), by: null }], null, NOW);
  ok(ed.cards[0].green && ed.cards[0].items[0].green?.mark === "staff-edit", "a staff edit after the write closes it");
  const t = project([created("c", NOW - H)], new Map(), [mark(`created-check:901:${NOW - H}`, "c", NOW - 60_000)], null, NOW);
  ok(t.cards[0].items[0].green?.mark === "checked" && t.cards[0].items[0].green?.by === "kate@spartancrew.co.uk", "a tick on it shows who checked it");
  ok(t.cards[0].items[0].green?.at === NOW - 60_000 && t.counts.done === 1, "and it went green when it was checked");
}

console.log("\n[4] keys");
{
  const p = project([needsCreated("a"), needsUpdated("b"), created("c", NOW - H)], new Map([["a", NOW - 2 * H]]), [], null, NOW);
  const keys = p.cards.map((c) => c.items[0].item_key);
  ok(keys.includes(`needs-created:a:0:${NOW - 2 * H}`), "needs key: kind, thread, no order, latest client email", keys.join(" "));
  ok(keys.includes("needs-updated:b:900:0"), "needs key carries the order");
  ok(keys.includes(`created-check:901:${NOW - H}`), "made key: kind, order, the write's ts");
}

console.log("\n[5] ordering: a day-long reply wait first, then needs by job date, then done newest first");
{
  const inbound = new Map([["n-old", NOW - 9 * H], ["n-new", NOW - 1 * H]]);
  const p = project(
    [created("c-old", NOW - 8 * H), needsCreated("n-new"), created("c-new", NOW - 2 * H), needsUpdated("n-old")],
    inbound, [], [{ thread_id: "r", since_iso: new Date(NOW - 30 * H).toISOString(), company: "Acme", contact: "Jo Bloggs", subject: "Re: quote" }], NOW);
  const order = p.cards.map((c) => c.thread_id).join(",");
  // n-old is an update on a booked job, so it has no clock (Ben, 2026-10-06) and no wait to
  // rank by; on the same job day the enquiry still waiting on a reply goes first.
  ok(order === "r,n-new,n-old,c-old,c-new", "lane order", order);
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
  p = project([needsUpdated("b")], new Map([["b", NOW - 3 * H]]), [mark(key, "b", NOW - H, "stamps")], null, NOW);
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

console.log("\n[12] how long the client has waited for a reply");
{
  const p = project([needsCreated("w"), needsCreated("r"), needsCreated("silent")],
    new Map([["w", NOW - 5 * H], ["r", NOW - 5 * H]]), [], null, NOW,
    new Map([["r", NOW - 2 * H], ["w", NOW - 9 * H]]));
  const by = new Map(p.cards.map((c) => [c.thread_id, c]));
  ok(by.get("w")?.awaiting_reply_since === NOW - 5 * H, "our last email was before theirs: waiting since theirs");
  ok(by.get("r")?.awaiting_reply_since === null, "we replied after their email: not waiting");
  ok(by.get("silent")?.awaiting_reply_since === null, "no client email on record: no clock");
  const jobs = project([needsUpdated("u"), created("c", NOW - 6 * H), needsUpdated("m", { onsinch_order_id: undefined, onsinch_order_number: undefined, onsinch_job_id: undefined })],
    new Map([["u", NOW - 5 * H], ["c", NOW - 5 * H], ["m", NOW - 5 * H]]),
    [{ item_key: `needs-updated:m:0:${NOW - 5 * H}`, thread_id: "m", mark: "matched", by: null, evidence: { r_number: "11029", j_number: "J16100" }, at: NOW - H }], null, NOW);
  const jb = new Map(jobs.cards.map((c) => [c.thread_id, c]));
  ok(jb.get("u")?.awaiting_reply_since === null && jb.get("c")?.awaiting_reply_since === null, "a job has no clock, whether it needs updating or the engine wrote it (Ben, 2026-10-06)");
  ok(jb.get("m")?.r_number === "R11029" && jb.get("m")?.awaiting_reply_since === null, "nor does a need matched to a job staff booked by hand");
}

console.log("\n[13] the order of the list (Ben, 2026-10-04 and 10-05)");
{
  const day = (d: string) => ({ facts: { company_name: "X", requests: [{ date: d }] } });
  const p = project([
    created("done-old", NOW - 5 * H, { facts: { company_name: "X", requests: [{ date: "2026-10-16" }] } }),
    created("check-old", NOW - 6 * H),
    created("check-new", NOW - 2 * H),
    needsCreated("undated", { facts: { company_name: "X", requests: [{}] } }),
    needsCreated("later", day("2026-10-16")),
    needsCreated("quiet", day("2026-10-04")),
    needsCreated("soon", day("2026-10-05")),
    created("done-new", NOW - 1 * H),
    needsCreated("later-longer", day("2026-10-16")),
    needsCreated("red-wait", day("2026-10-20")),
  ], new Map([["soon", NOW - 2 * H], ["later", NOW - 3 * H], ["later-longer", NOW - 5 * H], ["red-wait", NOW - 30 * H], ["undated", NOW - H], ["quiet", NOW - QUIET_MS - H]]),
    [mark(`created-check:901:${NOW - 5 * H}`, "done-old", NOW - 3 * H), mark(`created-check:901:${NOW - H}`, "done-new", NOW - 30 * 60_000)], null, NOW);
  const order = p.cards.map((c) => c.thread_id).join(",");
  ok(order === "red-wait,soon,later-longer,later,check-old,check-new,undated,quiet,done-new,done-old", "red wait, nearest job, longer wait on a tie, undated, quiet, then done newest first", order);
  const by = new Map(p.cards.map((c) => [c.thread_id, c]));
  ok(by.get("quiet")?.quiet === true && by.get("red-wait")?.quiet === false && by.get("done-old")?.quiet === false, "quiet only on an open need silent for QUIET_MS");
  ok(by.has("quiet") && p.counts.needs_created === 6 && p.counts.to_check === 2, "sunk, never hidden, and still counted");
  const stale = project([created("c", NOW - 20 * 86_400_000)], new Map([["c", NOW - H]]), [], null, NOW);
  ok(stale.cards[0]?.quiet === false, "a client who wrote an hour ago keeps a card off quiet, however old the write");
  const W = 8 * 86_400_000;
  const reset = project([created("c", NOW - H), needsCreated("n"), needsCreated("q")], new Map([["c", NOW - W], ["n", NOW - W], ["q", NOW - W]]), [], null, NOW, new Map([["n", NOW - 2 * H]]));
  const rs = new Map(reset.cards.map((c) => [c.thread_id, c]));
  ok(rs.get("c")?.quiet === false, "an engine write after a week of silence takes the card off quiet (Ben, 2026-10-06)");
  ok(rs.get("n")?.quiet === false, "so does an email of ours");
  ok(rs.get("q")?.quiet === true, "a card nobody has touched for a week is still quiet");
}

console.log("\n[14] a need that resolves without an engine write turns green instead of vanishing");
{
  const inbound = new Map([["a", NOW - 2 * H]]);
  const key = `needs-created:a:0:${NOW - 2 * H}`;
  let p = project([needsCreated("a")], inbound, [], null, NOW);
  ok(p.remember.length === 1 && p.remember[0].mark === "open" && p.remember[0].item_key === key, "a need on screen is remembered as open");
  const open = mark(key, "a", NOW - H, "open");
  ok(project([needsCreated("a")], inbound, [open], null, NOW).remember.length === 0, "and remembered once");
  const gone = st({ thread_id: "a", status: "ordered" });
  p = project([gone], inbound, [open], null, NOW);
  ok(p.cards.length === 0 && p.remember.length === 1 && p.remember[0].mark === "resolved" && p.remember[0].item_key === key, "when the thread stops yielding it, the projection asks for a resolved mark");
  const res: FeedMark = { item_key: key, thread_id: "a", mark: "resolved", by: null, evidence: p.remember[0].evidence, at: NOW - 60_000 };
  p = project([gone], inbound, [open, res], null, NOW);
  const c = p.cards[0];
  ok(c?.green === true && c.lane === "done" && c.items[0].kind === "needs-created" && c.colour === "red" && c.items[0].green?.mark === "resolved", "then it is a done card, as the need it was");
  ok(c?.items[0].green?.at === NOW - 60_000 && p.counts.done === 1 && p.counts.needs_created === 0, "green from when it resolved, and counted done");
  ok((c?.items[0].green?.evidence as { text?: string })?.text === "No order needed any more, per the system", "saying what happened");
  ok(project([gone], inbound, [open, { ...res, at: NOW - DONE_DWELL_MS - 1 }], null, NOW).cards.length === 0, "it leaves after a day like any done card");
  const naj = st({ thread_id: "a", classification: "not-a-job", status: "ordered" });
  ok((project([naj], inbound, [open], null, NOW).remember[0]?.evidence as { text?: string })?.text === "Read as not a job by the system", "a reclassified thread says so");
  p = project([created("a", NOW - 5 * H)], inbound, [open], null, NOW);
  ok(p.remember[0]?.mark === "resolved" && (p.remember[0].evidence as { text?: string }).text === "Linked to an order by the system", "a thread left holding only a write OLDER than the need resolved it");
  p = project([created("a", NOW - 30 * 60_000)], inbound, [open], null, NOW);
  ok(p.remember.length === 0 && p.cards[0]?.items[0].kind === "created-check" && !p.cards[0].green, "a write AFTER the need is the engine doing it: a check, not resolved");
  const twice = project([created("a", NOW - 30 * 60_000)], inbound, [open, mark(`created-check:901:${NOW - 30 * 60_000}`, "a", NOW - 10 * 60_000, "open")], null, NOW);
  ok(twice.remember.length === 0 && twice.cards[0]?.items[0].kind === "created-check" && !twice.cards[0].green, "a check never resolves itself");
  ok(project([gone], inbound, [], null, NOW).cards.length === 0, "a thread the TV never showed as a need stays off: no backfill");
  ok(project([gone], inbound, [open, res, { item_key: dismissKey("a"), thread_id: "a", mark: "dismissed", by: "x", evidence: null, at: NOW }], null, NOW).cards.length === 0, "a dismissed thread stays gone");
  const ticked = mark(key, "a", NOW - 30 * 60_000);
  p = project([gone], inbound, [open, ticked], null, NOW);
  ok(p.remember.length === 0 && p.cards[0]?.items[0].green?.mark === "checked", "a need ticked before it resolved stays in done as ticked");
}

console.log("\n[15] the rebuild's decisions reach ops on the TV and nowhere else (Ben, 2026-10-10)");
{
  const row = (thread: string, over: Partial<V2Row>): V2Row => ({
    thread_id: thread, message_id: `m-${thread}`, sent_at: new Date(NOW - H).toISOString(), kind: "handoff",
    grounded: { intent: "change", requests: [], problems: [] }, decision: { kind: "handoff", reasons: ["the request is unclear"] },
    executed: null, company_id: 343, company: "Impact Collective", from_address: "sam@impact.example", subject: "Re: R11475 Monday", ...over,
  });
  const quote = row("q", { grounded: { intent: "quote_request", requests: [], problems: [] }, decision: { kind: "handoff", reasons: ["the client asked for a quote"] }, subject: "Crew prices" });
  const change = row("c", { grounded: { intent: "change", requests: [{ action: "change_crew", date: "2026-10-12", crew: 6, problems: [] }], problems: [] }, decision: { kind: "handoff", reasons: ["R11475 shift 7: the email says 6 crew, the shift has 5"] } });
  const ops = [{ source: "m-w#0", op: { kind: "set_position_times" as const, order_id: 950, slot_id: 5, date: "2026-10-10", start: "11:00", end: "15:00" } }];
  const shadow = row("w", { kind: "write", decision: { kind: "write", ops, why: ["R11275 shift 41719: times to 11:00-15:00"] }, subject: "Saturday" });
  const written = row("x", { kind: "write", decision: { kind: "write", ops, why: ["R11275 shift 41719: times to 11:00-15:00"] }, executed: [{ op_key: "k", status: "verified", reasons: [] }] });
  const p = project([], new Map(), [], null, NOW, new Map(), v2Sources([quote, change, shadow, written], NOW));
  const by = new Map(p.cards.map((c) => [c.thread_id, c]));
  ok(by.get("q")?.items[0].kind === "needs-created" && by.get("q")?.note === "The client asked for a quote" && by.get("q")?.company === "Impact Collective", "a quote is a new job for a person, with the system's reason on the card");
  ok(by.get("c")?.items[0].kind === "needs-updated" && by.get("c")?.r_number === "R11475" && by.get("c")?.dates[0] === "2026-10-12" && by.get("c")?.crew === 6, "a change it could not make reads needs updated, on the order the reason names");
  ok(p.wants.get("c")?.r_numbers[0] === "11475", "and the verifier looks for that order, so a staff edit there closes it");
  ok(by.get("w")?.items[0].kind === "needs-updated" && by.get("w")?.order_id === 950 && /^Not written yet \(shadow\): R11275/.test(by.get("w")?.note ?? ""), "a planned write not yet made is still a person's job, saying what the system would do");
  ok(by.get("x")?.items[0].kind === "updated-check" && !by.get("x")?.green && p.counts.to_check === 1, "a write the system made is a check, never an automatic green");
  ok(p.counts.needs_created === 1 && p.counts.needs_updated === 2, "counted with the rest");

  const later = row("c", { message_id: "m-c2", sent_at: new Date(NOW - 30 * 60_000).toISOString(), decision: { kind: "handoff", reasons: ["no venue in the email"] }, grounded: { intent: "booking", requests: [], problems: [] }, subject: "Another" });
  const both = v2Sources([change, later], NOW);
  ok(both.length === 1 && both[0].note === "No venue in the email", "a thread shows its newest decision that needs a person");
  const state = needsUpdated("c");
  const merged = project([state], new Map(), [], null, NOW, new Map(), v2Sources([change], NOW));
  ok(merged.cards.length === 1 && /6 crew/.test(merged.cards[0].note ?? ""), "the rebuild's decision replaces the paused engine's state for the same thread");
  ok(project([state], new Map(), [], null, NOW).cards[0]?.note === null, "the paused engine's own cards carry no note");
  const past = row("old", { grounded: { intent: "change", requests: [{ action: "change_times", date: "2026-09-30", problems: [] }], problems: [] } });
  ok(project([], new Map(), [], null, NOW, new Map(), v2Sources([past], NOW)).cards.length === 0, "a job that is over leaves the TV");
}

console.log(fails ?`\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
