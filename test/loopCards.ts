// ============================================================================
// Every need the TV shows leaves with a recorded way out (ADDENDUM §12.2, "per card", P2.5).
// ----------------------------------------------------------------------------
// The Part 1 audit found 97 of 275 needs with no exit: a day passing and a later email wrote nothing. On PGlite,
// TV snapshots minute by minute. Pinned: an open need is kept with when it was first and last seen; green, its
// mark is the exit, with the person or the OnSinch user; gone while its thread has another need open, superseded;
// gone with its days past, its day passed; gone after the thread was dismissed, dismissed; otherwise "left the TV";
// each exit is written once.
// npx tsx --require ./test/fixtures/pg.ts test/loopCards.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { recordCardExits } from "../app/lib/v2/loop/cards";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const NOW = Date.parse("2026-10-28T10:00:00Z");
const item = (key: string, green: any = null) => ({ item_key: key, kind: "needs-updated", status: "x", at: NOW - 3600e3, green });
const card = (thread: string, items: any[], dates = ["2026-10-30"]) => ({ thread_id: thread, items, dates } as any);
const exits = async () => new Map(((await sql`SELECT item_key, exit, exit_by, opened_at, last_seen_at FROM v2_card_exits`) as any[]).map((r) => [r.item_key, r]));

(async () => {
  await ensureSchema(sql as any);
  await recordCardExits(sql as any, [card("t1", [item("a")]), card("t2", [item("b")]), card("t3", [item("c")], ["2026-10-27"]), card("t4", [item("d")]), card("t5", [item("e")]), card("t6", [item("f")])], NOW);
  ok([...(await exits()).values()].every((r) => r.exit === null), "six open needs, none exited");

  const tick = { mark: "checked", by: "paz@spartancrew.co.uk", evidence: null, at: NOW + 60e3 };
  const edit = { mark: "staff-edit", by: null, evidence: { creator: 573 }, at: NOW + 60e3 };
  await sql`INSERT INTO feed_marks (item_key, thread_id, mark, by) VALUES ('dismiss:t5', 't5', 'dismissed', 'paz@spartancrew.co.uk')`;
  await recordCardExits(sql as any, [card("t1", [item("a", tick)]), card("t2", [item("b", edit)]), card("t4", [item("g")]), card("t6", [item("f")])], NOW + 120e3);
  const e = await exits();
  ok(e.get("a")?.exit === "a person's tick" && e.get("a")?.exit_by === "paz@spartancrew.co.uk", "ticked: the person", e.get("a"));
  ok(e.get("b")?.exit === "staff's edit found" && e.get("b")?.exit_by === "onsinch:573", "the verifier's find: the OnSinch user who edited", e.get("b"));
  ok(e.get("c")?.exit === "its day passed", "gone with its day past", e.get("c"));
  ok(e.get("d")?.exit === "superseded by a later email" && e.get("g")?.exit === null, "gone while a newer need on its thread is open: superseded", e.get("d"));
  ok(e.get("e")?.exit === "dismissed" && e.get("e")?.exit_by === "paz@spartancrew.co.uk", "the thread dismissed: dismissed, by whom", e.get("e"));
  ok(e.get("f")?.exit === null && Date.parse(e.get("f")?.last_seen_at) === NOW + 120e3, "still open: last seen now", e.get("f"));

  await recordCardExits(sql as any, [card("t4", [item("g")])], NOW + 180e3);
  const e2 = await exits();
  ok(e2.get("f")?.exit === "left the TV", "gone with no mark, no newer need, its day to come: left the TV, counted", e2.get("f"));
  ok(e2.get("a")?.exit === "a person's tick" && e2.get("c")?.exit === "its day passed", "an exit is written once", { a: e2.get("a"), c: e2.get("c") });

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
