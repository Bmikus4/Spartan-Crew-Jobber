// ============================================================================
// The loop's truth store keeps OnSinch's booking timeline whole, read forward by id (ADDENDUM §12.2, P2.1).
// ----------------------------------------------------------------------------
// A fake OnSinch serves timeline rows of every action and a company list. Pinned: the store starts at 29 Jul
// and keeps only the eight booking actions, while its cursor passes the rest; a run reads at most its pages and
// the next goes on from there, storing nothing twice; each row reaches its order by a create's path, an order's
// number or a delete's part, and a part older than the store by an order read whole; a failed read throws and
// keeps every row already stored; contacts are read once a day, lowercased, and a failed read keeps yesterday's.
// npx tsx --require ./test/fixtures/pg.ts test/loopTruth.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { pullTimeline, refreshContacts, rememberOrder, TIMELINE_FROM_ID } from "../app/lib/v2/loop/truth";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const F = TIMELINE_FROM_ID;
const row = (id: number, action: string, data: unknown, creator = 413, created = "2026-10-20T09:00:00+00:00") => ({ id, action, creator, created, data: JSON.stringify(data) });
let rows: any[] = [];
let companies: any[] = [];
let down = false, shuffled = false;
const t = (async (_m: string, path: string) => {
  if (down) return { status: 500, data: null };
  const u = new URL("http://x" + path);
  const page = Number(u.searchParams.get("page") ?? 1);
  if (u.pathname === "/timelineAudits") {
    const after = Number(u.searchParams.get("id[gt]"));
    let hit = rows.filter((r) => r.id > after).sort((a, b) => a.id - b.id);
    const out = hit.slice((page - 1) * 100, page * 100);
    if (shuffled) out.reverse();
    return { status: 200, data: { data: out, pagination: { pageCount: Math.ceil(hit.length / 100), count: hit.length } } };
  }
  if (u.pathname === "/companies") return { status: 200, data: { data: companies.slice((page - 1) * 100, page * 100), pagination: { pageCount: Math.ceil(companies.length / 100), count: companies.length } } };
  return { status: 404, data: null };
}) as any;
const stored = async () => (await sql`SELECT id, action, part, parent, order_id, created FROM onsinch_timeline ORDER BY id`) as any[];
const cursorNow = async () => Number(((await sql`SELECT value FROM v2_loop_meta WHERE key = 'timeline_cursor'`) as any[])[0]?.value);

(async () => {
  console.log("\n[1] from 29 Jul, the booking actions only; the cursor passes the rest");
  rows = [
    row(F - 5, "common_change", { model: "Slot", id: "1", diffChanges: { Slot: { size: { old: 1, new: 2 } } } }),
    row(F, "order_create", { id: "500", model: "Order", data: { number: 11500, path: "Order:500" } }),
    row(F + 1, "common_create", { id: "9001", model: "Slot", data: { path: "Order:500/Job:600/SlotTeam:700/Slot:9001" } }),
    row(F + 2, "worker_login", { id: "3" }),
    row(F + 3, "common_change", { id: "9001", model: "Slot", diffChanges: { Slot: { size: { old: 2, new: 4 } } } }),
    row(F + 4, "common_change", { id: "11500", model: "Order", diffChanges: { Order: { intern_name: { old: "", new: "PO1" } } } }),
    row(F + 5, "common_delete", { id: "700", model: "SlotTeam", data: { model: "Slot", id: "9001" } }),
    row(F + 6, "common_change", { id: "4242", model: "Slot", diffChanges: { Slot: { size: { old: 1, new: 3 } } } }, 573, "2026-10-21 07:30:00"),
    row(F + 7, "attendance_change", { id: "8" }),
  ];
  const a = await pullTimeline(sql, t);
  const s = await stored();
  ok(!s.some((r) => Number(r.id) < F), "nothing before 29 Jul is read", s.map((r) => r.id));
  ok(s.length === 6 && !s.some((r) => /login|attendance/.test(r.action)), "the 6 booking rows are kept, the other actions are not", s.map((r) => r.action));
  ok(a.cursor === F + 7 && (await cursorNow()) === F + 7 && !a.behind, "the cursor stands on the last row read, kept or not", a);
  const complete = ((await sql`SELECT value FROM v2_loop_meta WHERE key = 'timeline_complete_at'`) as any[])[0]?.value;
  ok(!!complete && Date.parse(complete) <= Date.now(), "caught up, it says when the stored timeline is complete to", complete);

  console.log("\n[2] each row reaches its order, or waits for it");
  const by = new Map(s.map((r) => [Number(r.id), r]));
  ok(Number(by.get(F + 3)!.order_id) === 500, "a position edit, by the create path that made the position", by.get(F + 3));
  ok(by.get(F + 4)!.part === "OrderNo:11500" && Number(by.get(F + 4)!.order_id) === 500, "an order edit, keyed by its number, by the order create's number", by.get(F + 4));
  ok(by.get(F + 5)!.part === "Slot:9001" && by.get(F + 5)!.parent === "SlotTeam:700" && Number(by.get(F + 5)!.order_id) === 500, "a delete, by the part it deleted", by.get(F + 5));
  ok(by.get(F + 6)!.order_id == null, "a position made before the store began has no order yet", by.get(F + 6));
  await rememberOrder(sql, { id: 77, number: 11077, Job: [{ id: 1, SlotTeam: [{ id: 2, Slot: [{ id: 4242 }] }] }] });
  ok(Number((await stored()).find((r) => Number(r.id) === F + 6)!.order_id) === 77, "and gets it once its order is read whole");
  ok(new Date(by.get(F + 6)!.created).toISOString() === "2026-10-21T07:30:00.000Z", "a time with no zone is stored as UTC", by.get(F + 6)!.created);

  console.log("\n[3] a run reads at most its pages; the next goes on; nothing is stored twice");
  rows.push(...Array.from({ length: 250 }, (_, k) => row(F + 10 + k, k % 2 ? "common_change" : "login", { id: String(k), model: "Slot", diffChanges: {} })));
  await sql`DELETE FROM v2_loop_meta WHERE key = 'timeline_complete_at'`;
  const b = await pullTimeline(sql, t, { pages: 2 });
  const notYet = ((await sql`SELECT 1 FROM v2_loop_meta WHERE key = 'timeline_complete_at'`) as any[]).length;
  ok(b.read === 200 && b.behind && !notYet, "two pages: 200 read, still behind, and not called complete", b);
  const c = await pullTimeline(sql, t, { pages: 2 });
  ok(c.read === 50 && !c.behind && c.cursor === F + 259, "the next run reads the 50 left and is caught up", c);
  await sql`DELETE FROM v2_loop_meta WHERE key = 'timeline_cursor'`;
  await pullTimeline(sql, t, { pages: 10 });
  ok((await stored()).length === 6 + 125, "read again from the start, every row is still stored once", (await stored()).length);

  console.log("\n[4] a failed read throws and keeps what was stored; rows out of order are refused");
  const before = await cursorNow();
  rows.push(row(F + 300, "common_change", { id: "1", model: "Slot", diffChanges: {} }));
  down = true;
  const err = await pullTimeline(sql, t).then(() => "no throw", (e) => String(e.message));
  down = false;
  ok(/answered 500/.test(err) && (await cursorNow()) === before && (await stored()).length === 131, "a 500 is an error, never an empty timeline", err);
  rows.push(row(F + 301, "common_change", { id: "1", model: "Slot", diffChanges: {} }));
  shuffled = true;
  const err2 = await pullTimeline(sql, t).then(() => "no throw", (e) => String(e.message));
  shuffled = false;
  ok(/rising id order/.test(err2) && (await cursorNow()) === before, "a page whose ids fall is refused before anything moves", err2);

  console.log("\n[5] contacts: once a day, lowercased, never an empty list");
  companies = [{ id: 10, Client: [{ email: " Ops@North.example " }, { email: "" }] }, { id: 11, Client: [{ email: "ops@north.example" }] }, { id: 12, Client: [] }];
  const day1 = Date.parse("2026-10-28T06:00:00Z");
  const r1 = await refreshContacts(sql, t, day1);
  const list = async () => ((await sql`SELECT email, company_id FROM onsinch_contacts ORDER BY company_id`) as any[]).map((r) => `${r.email}>${r.company_id}`);
  ok(r1.refreshed && JSON.stringify(await list()) === JSON.stringify(["ops@north.example>10", "ops@north.example>11"]), "every contact, lowercased; one address on two companies is two rows", await list());
  companies = [{ id: 10, Client: [{ email: "new@north.example" }] }];
  ok(!(await refreshContacts(sql, t, day1 + 3600e3)).refreshed, "not again within the day");
  down = true;
  const err3 = await refreshContacts(sql, t, day1 + 25 * 3600e3).then(() => "no throw", (e) => String(e.message));
  down = false;
  ok(/answered 500/.test(err3) && (await list()).length === 2, "a failed read keeps yesterday's list", err3);
  await refreshContacts(sql, t, day1 + 26 * 3600e3);
  ok(JSON.stringify(await list()) === JSON.stringify(["new@north.example>10"]), "the next day's list replaces it", await list());

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
