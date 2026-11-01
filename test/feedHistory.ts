// ============================================================================
// The TV's history (lib/feed/history.ts; the owner, 1 Nov: "a history button which lets the team view the list from
// different times in history"), and done clearing after 24 hours.
// ----------------------------------------------------------------------------
// Pinned: a list is kept when it differs from the last kept and 15 minutes have passed; the list at a moment is the
// newest kept at or before it; 30 days are kept; the route is guarded and a failed read is a 500; the minute sync keeps
// the list it builds; the TV shows a kept list read-only and goes back to live by itself.
// npx tsx --require ./test/fixtures/pg.ts test/feedHistory.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { sql } from "./fixtures/pg";
import { keepList, keptTimes, listAt } from "../app/lib/feed/history";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const T = Date.parse("2026-11-01T09:00:00Z"), MIN = 60_000;
const card = (id: string, green = false) => ({ thread_id: id, green, dates: ["2026-11-03"], check: null, ask: null, items: [{ item_key: `needs-created:${id}:0:m`, green: green ? { at: T } : null }] }) as any;

(async () => {
  console.log("\n[1] a list is kept when it changed and 15 minutes have passed");
  {
    ok(await keepList(sql as any, { items: [card("a")], counts: { done: 0 } }, T) === "kept", "the first list is kept");
    ok(await keepList(sql as any, { items: [card("a")] }, T + 30 * MIN) === "same", "the same list is not kept again");
    ok(await keepList(sql as any, { items: [card("a"), card("b")] }, T + 35 * MIN) === "kept", "a changed list 35 minutes on is kept");
    ok(await keepList(sql as any, { items: [card("b")] }, T + 40 * MIN) === "too soon", "a change 5 minutes after the last kept waits");
    ok(await keepList(sql as any, { items: [card("b", true)] }, T + 51 * MIN) === "kept", "a card going green is a change");
    ok((await keptTimes(sql as any)).length === 3, "three moments kept");
  }

  console.log("\n[2] the list at a moment is the newest kept at or before it");
  {
    ok(await listAt(sql as any, T - MIN) === null, "before the first, nothing");
    const at = await listAt(sql as any, T + 34 * MIN);
    ok(at?.items.length === 1 && at.items[0].thread_id === "a" && at.at === new Date(T).toISOString(), "34 minutes on, the first list", at);
    const later = await listAt(sql as any, T + 45 * MIN);
    ok(later?.items.map((c) => c.thread_id).join() === "a,b", "45 minutes on, the second (the waiting change was not kept)", later?.items.map((c) => c.thread_id));
  }

  console.log("\n[3] 30 days are kept");
  {
    ok(await keepList(sql as any, { items: [card("c")] }, T + 31 * 864e5) === "kept", "a list a month on is kept");
    ok((await keptTimes(sql as any)).length === 1, "and the lists older than 30 days are gone");
  }

  console.log("\n[4] the route, the sync and the screen");
  {
    const route = readFileSync("app/api/feed/history/route.ts", "utf8");
    const get = route.slice(route.indexOf("export async function GET"));
    ok(get.indexOf("authorizeAction") >= 0 && get.indexOf("authorizeAction") < get.indexOf("keptTimes") && /status: 401/.test(get), "guarded before anything is read");
    ok(/status: 500/.test(get) && !/INSERT|DELETE|UPDATE/.test(route), "a failed read is a 500, and the route writes nothing");
    const sync = readFileSync("app/api/bot/sync/route.ts", "utf8");
    ok(/keepList\(sql, tv\.body, Date\.now\(\)\)/.test(sync), "the minute sync keeps the list the cards step builds");
    const screen = readFileSync("app/components/LiveFeedScreen.tsx", "utf8");
    ok(/past \? past\.items : data\?\.items/.test(screen) && /onTick=\{past \? noTick : tick\}/.test(screen), "the TV shows a kept list in place of the live one, with nothing to tick");
    ok(/setTimeout\(\(\) => setPast\(null\), HISTORY_VIEW_MS\)/.test(screen) && /Back to live/.test(screen), "it goes back to live by itself, or on Back to live");
    const serve = readFileSync("app/lib/feed/serve.ts", "utf8");
    ok(/now - doneAt\(c\) > DONE_DWELL_MS/.test(serve), "done clears 24 hours after it went green, every card alike (the owner, 1 Nov)");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
