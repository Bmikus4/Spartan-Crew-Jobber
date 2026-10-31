// ============================================================================
// Every need the TV shows leaves with a recorded way out (ADDENDUM §12.2, "per card", P2.5; §13.2 change 1).
// ----------------------------------------------------------------------------
// The Part 1 audit found 97 of 275 needs with no exit, and by 30 Oct 45 of 68 exits were "left the TV": 29 the
// re-plan settling, 15 a later email answering the need. On PGlite, TV snapshots minute by minute. Pinned: an open
// need is kept with when it was first and last seen; green, its mark is the exit, with the person or the OnSinch
// user; gone because its email is no longer on the cards, answered by a later email; gone with its days past, its
// day passed; gone with no day after 14 quiet days; gone after the thread was dismissed, dismissed; otherwise "left
// the TV"; each exit is written once.
// npx tsx --require ./test/fixtures/pg.ts test/loopCards.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { recordCardExits } from "../app/lib/v2/loop/cards";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const NOW = Date.parse("2026-10-28T10:00:00Z");
const key = (m: string) => `needs-updated:t:0:${m}`;
const item = (m: string, green: any = null, at = NOW - 3600e3) => ({ item_key: key(m), kind: "needs-updated", status: "x", at, green });
const card = (thread: string, items: any[], dates = ["2026-10-30"]) => ({ thread_id: thread, items, dates } as any);
const exits = async () => new Map(((await sql`SELECT item_key, exit, exit_by, opened_at, last_seen_at FROM v2_card_exits`) as any[]).map((r) => [r.item_key.split(":").pop(), r]));
const all = new Set(["a", "b", "c", "d", "e", "f", "g", "h"]);

(async () => {
  await ensureSchema(sql as any);
  await recordCardExits(sql as any, [card("t1", [item("a")]), card("t2", [item("b")]), card("t3", [item("c")], ["2026-10-27"]), card("t4", [item("d")]), card("t5", [item("e")]), card("t6", [item("f")]), card("t7", [item("h", null, NOW - 15 * 864e5)], [])], all, NOW);
  ok([...(await exits()).values()].every((r) => r.exit === null), "seven open needs, none exited");

  const tick = { mark: "checked", by: "paz@spartancrew.co.uk", evidence: null, at: NOW + 60e3 };
  const done = { mark: "done", by: null, evidence: { creator: 573, text: "R11853, staff changed the times" }, at: NOW + 60e3 };
  await sql`INSERT INTO feed_marks (item_key, thread_id, mark, by) VALUES ('dismiss:t5', 't5', 'dismissed', 'paz@spartancrew.co.uk')`;
  const later = new Set([...all].filter((m) => m !== "d"));
  await recordCardExits(sql as any, [card("t1", [item("a", tick)]), card("t2", [item("b", done)]), card("t4", [item("g")]), card("t6", [item("f")])], later, NOW + 120e3);
  const e = await exits();
  ok(e.get("a")?.exit === "a person's tick" && e.get("a")?.exit_by === "paz@spartancrew.co.uk", "ticked: the person", e.get("a"));
  ok(e.get("b")?.exit === "staff's work found in OnSinch" && e.get("b")?.exit_by === "onsinch:573", "done.ts's find: the OnSinch user who did it", e.get("b"));
  ok(e.get("c")?.exit === "its day passed", "gone with its day past", e.get("c"));
  ok(e.get("d")?.exit === "answered by a later email" && e.get("g")?.exit === null, "gone because its email is no longer on the cards: answered by a later email", e.get("d"));
  ok(e.get("e")?.exit === "dismissed" && e.get("e")?.exit_by === "paz@spartancrew.co.uk", "the thread dismissed: dismissed, by whom", e.get("e"));
  ok(e.get("h")?.exit === "no day, and quiet for 14 days", "gone with no day after 14 quiet days", e.get("h"));
  ok(e.get("f")?.exit === null && Date.parse(e.get("f")?.last_seen_at) === NOW + 120e3, "still open: last seen now", e.get("f"));

  await recordCardExits(sql as any, [card("t4", [item("g")])], later, NOW + 180e3);
  const e2 = await exits();
  ok(e2.get("f")?.exit === "left the TV", "gone with no mark, its email still on the cards, its day to come: left the TV, counted", e2.get("f"));
  ok(e2.get("a")?.exit === "a person's tick" && e2.get("c")?.exit === "its day passed", "an exit is written once", { a: e2.get("a"), c: e2.get("c") });

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
