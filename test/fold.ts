// ============================================================================
// The fold is pure, chunkable, and its transitions do what the design says.
// ----------------------------------------------------------------------------
// Pinned: same events, same state, byte for byte; folding in chunks equals folding whole (the
// associativity property); a restated ask merges instead of duplicating; a cancel withdraws its
// target; a staff act marks open asks acted with proof; an acted ask asked again reopens; expiry
// is computed at a stated time, never the wall clock. Offline, no database.
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
const act = (t: string, id: string, order_id: number, row_id: number): FoldEvent => ({ t, kind: "act", id, order_id, row_id, creator: 7 });

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

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exitCode = fails ? 1 : 0;
