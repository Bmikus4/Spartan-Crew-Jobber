// ============================================================================
// The fold is pure, chunkable, and its transitions do what the design says.
// ----------------------------------------------------------------------------
// Pinned: same events, same state, byte for byte; folding in chunks equals folding whole (the
// associativity property); a restated ask merges instead of duplicating; a cancel withdraws its
// target; a staff act marks open asks acted with proof; an acted ask asked again reopens; expiry
// is computed at a stated time, never the wall clock. fold-v2: an act naming its days acts only
// asks on those days (dayless acts keep v1's everything); a restated date supersedes the old ask
// only when exactly one same-kind ask on the same named order matches, never a sibling from the
// same email. Offline, no database.
// npx tsx test/fold.ts
// ============================================================================
import { emptyState, foldAll, foldEvent, expired, type FoldEvent } from "../app/lib/v2/fold/fold";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const ask = (key: string, kind: string, date?: string, extra: Record<string, unknown> = {}) => ({
  key, kind, ...extra,
  values: { ...(date ? { date: { value: date, tier: "given", proof: "day" } } : {}), ...(extra.crew ? { crew: { value: extra.crew, tier: "given" } } : {}) },
  problems: [],
});
const reading = (t: string, id: string, asks: any[]): FoldEvent => ({ t, kind: "reading", id, ask: { version: "ask-v1", message_id: id, intent: "booking", asks, problems: [] } as any });
const mail = (t: string, id: string, from: "client" | "spartan"): FoldEvent => ({ t, kind: "mail", id, from });
const act = (t: string, id: string, order_id: number, row_id: number, days?: string[]): FoldEvent => ({ t, kind: "act", id, order_id, row_id, creator: 7, ...(days ? { days } : {}) });

const events: FoldEvent[] = [
  mail("2026-11-02T09:00Z", "m1", "client"),
  reading("2026-11-02T09:01Z", "m1", [ask("m1:0", "new_shift", "2026-11-10", { crew: 4 })]),
  mail("2026-11-02T10:00Z", "s1", "spartan"),
  mail("2026-11-03T09:00Z", "m2", "client"),
  reading("2026-11-03T09:01Z", "m2", [ask("m2:0", "new_shift", "2026-11-10", { crew: 6 })]),
  act("2026-11-03T12:00Z", "a1", 500, 9001),
  mail("2026-11-04T09:00Z", "m3", "client"),
  reading("2026-11-04T09:01Z", "m3", [ask("m3:0", "cancel_shift", "2026-11-10")]),
];

console.log("\n[pure] same events, same state");
const s1 = foldAll("t1", events);
const s2 = foldAll("t1", events);
ok(JSON.stringify(s1) === JSON.stringify(s2), "byte-identical on a replay");

console.log("\n[chunked] folding in parts equals folding whole");
for (const cut of [1, 3, 5, 7]) {
  const part = events.slice(cut).reduce(foldEvent, events.slice(0, cut).reduce(foldEvent, emptyState("t1")));
  ok(JSON.stringify(part) === JSON.stringify(s1), `split at ${cut} gives the same state`);
}

console.log("\n[transitions]");
ok(s1.asks.length === 2, "after staff acted, a cancel is new work: the acted ask stays, a cancel ask opens", s1.asks.map((a) => `${a.akind}:${a.status}`));
ok(s1.asks[0].values.crew === 6, "the newest given value wins", s1.asks[0].values);
ok(s1.asks[0].merged.includes("m2:0"), "the merged keys are kept", s1.asks[0].merged);
ok(s1.asks[0].status === "acted" && s1.asks[1].akind === "cancel_shift" && s1.asks[1].status === "open", "acted stands; the cancel waits for OnSinch", s1.asks.map((a) => a.status));
const noAct = foldAll("t1b", [...events.slice(0, 5), ...events.slice(6)]);
ok(noAct.asks.length === 1 && noAct.asks[0].status === "withdrawn" && noAct.asks[0].merged.includes("m3:0"),
  "with no staff act yet, the cancel withdraws the ask it names", noAct.asks.map((a) => `${a.akind}:${a.status}`));
ok(s1.waiting === "spartan", "a client mail leaves the ball with spartan", s1.waiting);
ok(s1.last_event === "m3" && s1.events === events.length, "stamped with the last event folded", { last: s1.last_event, n: s1.events });

const mid = foldAll("t1", events.slice(0, 6));
ok(mid.asks[0].status === "acted" && mid.asks[0].proof.includes(9001), "a staff act marks the open ask acted, with the row as proof", mid.asks[0]);
const reopened = foldEvent(mid, reading("2026-11-03T15:00Z", "m2b", [ask("m2b:0", "new_shift", "2026-11-10", { crew: 8 })]));
ok(reopened.asks[0].status === "open" && reopened.asks[0].values.crew === 8, "an acted ask asked again reopens with the new value", reopened.asks[0]);

console.log("\n[expiry] computed at a stated time, not the wall clock");
const open = foldAll("t2", [reading("2026-11-02T09:00Z", "m9", [ask("m9:0", "new_shift", "2026-11-05")])]);
ok(expired(open, "2026-11-04T00:00Z").length === 0 && expired(open, "2026-11-06T00:00Z").length === 1, "a day passed is expired only after the day");

console.log("\n[orderless] an ask naming no order is acted by any linked act; one naming another is not");
const two = foldAll("t3", [
  reading("2026-11-02T09:00Z", "m4", [ask("m4:0", "new_shift", "2026-11-12"), { ...ask("m4:1", "change_times", "2026-11-13"), order_id: 600 }]),
  act("2026-11-02T10:00Z", "a2", 500, 9002),
]);
ok(two.asks[0].status === "acted" && two.asks[1].status === "open", "order-named asks wait for their own order", two.asks.map((a) => a.status));

console.log("\n[days] an act naming its days acts only asks on those days (fold-v2)");
const monTue = reading("2026-11-02T09:00Z", "m5", [ask("m5:0", "new_shift", "2026-11-12"), ask("m5:1", "new_shift", "2026-11-13")]);
const dayed = foldAll("t4", [monTue, act("2026-11-02T10:00Z", "a3", 500, 9003, ["2026-11-12"])]);
ok(dayed.asks[0].status === "acted" && dayed.asks[1].status === "open", "the act's day is acted, the other day waits", dayed.asks.map((a) => `${a.date}:${a.status}`));
const moved = foldAll("t4b", [monTue, act("2026-11-02T10:00Z", "a4", 500, 9004, ["2026-11-13", "2026-11-14"])]);
ok(moved.asks[0].status === "open" && moved.asks[1].status === "acted", "a move names both its days; the old day's ask is among them", moved.asks.map((a) => `${a.date}:${a.status}`));
const dayless = foldAll("t4c", [monTue, act("2026-11-02T10:00Z", "a5", 500, 9005)]);
ok(dayless.asks.every((a) => a.status === "acted"), "an act with no recoverable day keeps v1: never less acted", dayless.asks.map((a) => a.status));
const dateless = foldAll("t4d", [reading("2026-11-02T09:00Z", "m6", [ask("m6:0", "change_crew")]), act("2026-11-02T10:00Z", "a6", 500, 9006, ["2026-11-20"])]);
ok(dateless.asks[0].status === "acted", "an ask naming no day cannot be day-gated", dateless.asks[0]);

console.log("\n[supersede] a restated date replaces the old ask; ambiguity and siblings never do");
const dated = (key: string, date: string, order_id = 600, kind = "new_shift") => ({ ...ask(key, kind, date), order_id });
const sup = foldAll("t5", [
  reading("2026-11-02T09:00Z", "m7", [dated("m7:0", "2026-11-12")]),
  reading("2026-11-03T09:00Z", "m8", [dated("m8:0", "2026-11-14")]),
]);
ok(sup.asks[0].status === "superseded" && sup.asks[0].merged.includes("m8:0") && sup.asks[1].status === "open",
  "same kind, same order, new date: the old ask is superseded with the new key in merged", sup.asks.map((a) => `${a.date}:${a.status}`));
const acted = foldAll("t5b", [
  reading("2026-11-02T09:00Z", "m7", [dated("m7:0", "2026-11-12")]),
  act("2026-11-02T10:00Z", "a7", 600, 9007),
  reading("2026-11-03T09:00Z", "m8", [dated("m8:0", "2026-11-14")]),
]);
ok(acted.asks[0].status === "superseded" && acted.asks[0].acted_at !== undefined, "an acted ask is superseded too, keeping its acted_at as history", acted.asks[0]);
const siblings = foldAll("t5c", [reading("2026-11-02T09:00Z", "m9", [dated("m9:0", "2026-11-12"), dated("m9:1", "2026-11-13")])]);
ok(siblings.asks.every((a) => a.status === "open"), "two dates in one email are two shifts, never a restatement", siblings.asks.map((a) => a.status));
const ambiguous = foldAll("t5d", [
  reading("2026-11-02T09:00Z", "m9", [dated("m9:0", "2026-11-12"), dated("m9:1", "2026-11-13")]),
  reading("2026-11-03T09:00Z", "m10", [dated("m10:0", "2026-11-14")]),
]);
ok(ambiguous.asks.filter((a) => a.status === "open").length === 3, "two standing dates match: which is replaced is a guess, so neither is", ambiguous.asks.map((a) => `${a.date}:${a.status}`));
const otherOrder = foldAll("t5e", [
  reading("2026-11-02T09:00Z", "m7", [dated("m7:0", "2026-11-12", 600)]),
  reading("2026-11-03T09:00Z", "m8", [dated("m8:0", "2026-11-14", 700)]),
]);
ok(otherOrder.asks.every((a) => a.status === "open"), "another order never supersedes", otherOrder.asks.map((a) => a.status));
const noOrder = foldAll("t5f", [
  reading("2026-11-02T09:00Z", "m7", [ask("m7:0", "new_shift", "2026-11-12")]),
  reading("2026-11-03T09:00Z", "m8", [ask("m8:0", "new_shift", "2026-11-14")]),
]);
ok(noOrder.asks.every((a) => a.status === "open"), "no named order on the new ask: no supersede", noOrder.asks.map((a) => a.status));
const back = foldEvent(sup, reading("2026-11-04T09:00Z", "m11", [dated("m11:0", "2026-11-12")]));
ok(back.asks[0].status === "open" && back.asks[0].merged.includes("m11:0"), "a superseded ask restated identically reopens", back.asks.map((a) => `${a.date}:${a.status}`));
const noCancel = foldEvent(sup, reading("2026-11-04T09:00Z", "m12", [dated("m12:0", "2026-11-12", 600, "cancel_shift")]));
ok(noCancel.asks[0].status === "superseded" && noCancel.asks[2].akind === "cancel_shift" && noCancel.asks[2].status === "open",
  "a cancel never withdraws a superseded ask: it opens its own", noCancel.asks.map((a) => `${a.akind}:${a.status}`));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exitCode = fails ? 1 : 0;
