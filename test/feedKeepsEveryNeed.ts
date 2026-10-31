// ============================================================================
// A need stays on the TV until it is answered, whatever arrives on the thread after it.
// ----------------------------------------------------------------------------
// The addendum's F2 (23 Oct): a thread's card was its newest decision, so "book Tuesday"
// (handed off) followed by "what's the rate?" (Needs Reply) left only the question, which the
// TV does not list, and once we answered it the booking was gone from the TV and the labels
// without anyone booking it. Its kind (PDF p6 #6): 12 of 33 Needs Reply threads were later
// booked by staff. A later email answers a need only when it is about one of its days or its
// order; a question answers none.
// npx tsx test/feedKeepsEveryNeed.ts
// ============================================================================
import { project, type FeedMark } from "../app/lib/feed/project";
import { v2Sources, rowsOnCard, type V2Row } from "../app/lib/feed/v2";
import { labelsFor } from "../app/lib/mail/threadLabels";
import { fromStates } from "./fixtures/stateSource";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const NOW = Date.parse("2026-10-03T12:00:00Z");
const H = 3_600_000;
const row = (id: string, hoursAgo: number, over: Partial<V2Row>): V2Row => ({
  thread_id: "T", message_id: id, sent_at: new Date(NOW - hoursAgo * H).toISOString(), kind: "handoff",
  grounded: { intent: "booking", requests: [], problems: [] }, decision: { kind: "handoff", reasons: ["a new client: a person books the first order"] },
  executed: null, company_id: 343, from_address: "sam@impact.example", sender: { address: "sam@impact.example", client: "Impact Collective" }, ...over,
});
const booking = (id: string, hoursAgo: number, date: string, crew: number) =>
  row(id, hoursAgo, { grounded: { intent: "booking", requests: [{ action: "new_shift", date, crew, problems: [] }], problems: [] } });
const question = (id: string, hoursAgo: number) =>
  row(id, hoursAgo, { grounded: { intent: "quote_request", requests: [], problems: [] }, decision: { kind: "handoff", reasons: ["the client asked for a quote"] } });
const card = (rows: V2Row[], out = new Map<string, number>(), marks: FeedMark[] = []) =>
  project(new Map(), marks, null, NOW, out, v2Sources(rows, NOW)).cards.find((c) => c.thread_id === "T");
const keyOf = (c: ReturnType<typeof card>, id: string) => c?.items.find((i) => i.item_key.endsWith(`:${id}`));

const A = booking("mA", 3, "2026-10-14", 4);
const B = question("mB", 2);

console.log("\n[1] a booking handed off, then a question on the same thread");
{
  const c = card([A, B]);
  ok(keyOf(c, "mA")?.kind === "needs-created" && !!c?.items[0].item_key.endsWith(":mA"), "the booking still leads the card", c?.items);
  ok(!!c?.items.some((i) => i.kind === "needs-reply"), "and the question is on it too", c?.items);
  ok(c?.lane === "need" && labelsFor(c!).order === "Order Needs Created", "so the TV lists it and the thread keeps its Needs Created label", { lane: c?.lane, label: c && labelsFor(c).order });
}

console.log("\n[2] we answer the question");
{
  const c = card([A, B], new Map([["T", NOW - H]]));
  ok(keyOf(c, "mA")?.kind === "needs-created", "the booking stays: our email answers questions, never a booking", c?.items);
  ok(!c?.items.some((i) => i.kind === "needs-reply"), "and only the question leaves", c?.items);
  ok(card([B], new Map([["T", NOW - H]])) === undefined, "a thread that only asked a question is done once we reply (control)");
}

console.log("\n[3] what does answer a need");
{
  const A5 = booking("mA5", 1, "2026-10-14", 5);
  const c = card([A, A5]);
  ok(!!keyOf(c, "mA5") && !keyOf(c, "mA"), "a later request on the same day replaces it: '4 crew Tuesday' then 'make it 5'", c?.items);
  const written = row("mW", 1, { kind: "write", decision: { kind: "write", ops: [{ source: "s", op: { kind: "set_position_times", order_id: 950, slot_id: 1, date: "2026-10-14", start: "10:00", end: "16:00" } }], why: [] }, executed: [{ op_key: "k", status: "verified", reasons: [] }] });
  ok(!keyOf(card([A, B, written]), "mA"), "a later write on its day answers it", card([A, B, written])?.items);
}

console.log("\n[4] two bookings for different days, both handed off");
{
  const C = booking("mC", 1, "2026-10-16", 2);
  const c = card([A, C]);
  ok(!!keyOf(c, "mA") && !!keyOf(c, "mC") && !!c?.items[0].item_key.endsWith(":mC"), "both are on the card, the newest leading as before", c?.items);
  const tick: FeedMark = { item_key: keyOf(c, "mC")!.item_key, thread_id: "T", mark: "checked", by: "ops", evidence: null, at: NOW - 60_000 };
  const after = card([A, C], new Map(), [tick]);
  ok(!!after?.items[0].item_key.endsWith(":mA") && !after?.green && !!keyOf(after, "mC")?.green, "ticking one leaves the other leading, open", after?.items);
  ok(JSON.stringify(rowsOnCard([A, B, C]).map((r) => r.message_id)) === '["mC","mA"]', "the re-plan reads every need the card holds, not only its lead", rowsOnCard([A, B, C]).map((r) => r.message_id));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
