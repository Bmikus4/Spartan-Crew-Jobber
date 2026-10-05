// ============================================================================
// The feed's verifier closes a need only on a person's edit after the client's email.
// ----------------------------------------------------------------------------
// Fixtures are shaped like the live rows read on 2026-10-03: /timelineAudits sorted
// oldest-first (newest on the LAST page), `common_change` carrying
// data.diffChanges.{Model}.{field}: {old, new}; Order rows naming the order NUMBER, Job
// rows the job id, Slot and SlotTeam rows only themselves.
//
// NEGATIVE CONTROLS for [10] (each applied to app/lib/feed/verify.ts, run, confirmed red, reverted, 2026-10-04):
//   - holdsAll counting the engine's own blocks       : "blocks the engine wrote are not evidence"
//   - holdsAll without the no-extra-day check         : "a block on a day the thread does not ask for"
//   - no sender-name filter for a client with no company : "no company: the sender's surname"
//   - the venue score removed                         : "three orders that day" and both that follow
// Run: npx tsx test/feedVerify.ts
// ============================================================================
import { verify, changeOf, readOnly, __resetVerifyCache, type VerifyDeps } from "../app/lib/feed/verify";
import { project, type FeedMark } from "../app/lib/feed/project";
import type { Transport } from "../app/lib/engine/onsinch";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NOW = Date.parse("2026-10-05T12:00:00Z");
const H = 3_600_000;
const ENGINE = 2257;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "+00:00");

const base = { subject: "s", participants: [], last_message_id: "m", last_processed_epoch: NOW, facts: { requests: [{ date: "2026-10-16" }] }, desired_order: null, priority: "medium", notes: [] };
/** An update the engine could not make: a need on an order, dated by the client's email. */
const needUpdate = (id: string, oid: number, num: string, job: number) => ({ ...base, thread_id: id, classification: "update", status: "error", onsinch_order_id: oid, onsinch_order_number: num, onsinch_job_id: job, order_action_log: [] }) as unknown as ConversationState;
const needCreated = (id: string, company: number) => ({ ...base, thread_id: id, classification: "new-job", status: "needs-info", company_id: company, order_action_log: [] }) as unknown as ConversationState;

const change = (id: number, model: string, ref: string, diff: Record<string, { old: unknown; new: unknown }>, at: number, creator = 1164) =>
  ({ id, action: "common_change", creator, created: iso(at), data: JSON.stringify({ id: ref, model, diffChanges: { [model]: diff } }) });
const create = (id: number, model: string, ref: string, path: string, at: number) =>
  ({ id, action: "common_create", creator: 1164, created: iso(at), data: JSON.stringify({ id: ref, model, data: { path } }) });

/** A fake OnSinch: a two-page timeline, one nested order, one company's orders. Records every call. */
function fakeOnsinch(pages: unknown[][], opts: { timelineDown?: boolean; orders?: Record<string, unknown[]>; nested?: Record<number, unknown> } = {}) {
  const calls: string[] = [];
  const t: Transport = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path === "/users/profile") return { status: 200, data: { data: { id: ENGINE } } };
    const tl = /^\/timelineAudits\?limit=100&page=(\d+)$/.exec(path);
    if (tl) {
      if (opts.timelineDown) return { status: 503, data: {} };
      const p = Number(tl[1]);
      return { status: 200, data: { pagination: { pageCount: pages.length }, data: pages[p - 1] ?? [] } };
    }
    const nest = /^\/orders\?id%5Beq%5D=(\d+)&with=Job__SlotTeam__Slot__SlotLocation/.exec(path);
    if (nest) return { status: 200, data: { data: opts.nested?.[Number(nest[1])] ? [opts.nested[Number(nest[1])]] : [] } };
    const co = /^\/orders\?company_id=(\d+)/.exec(path);
    if (co) return { status: 200, data: { data: opts.orders?.[co[1]] ?? [], pagination: { pageCount: 1 } } };
    if (/^\/orders\?limit=100&page=1&with=Job$/.test(path)) return { status: 200, data: { data: opts.orders?.recent ?? [] } };
    return { status: 404, data: {} };
  };
  return { t, calls };
}

function deps(t: Transport, cursor: number | null = null) {
  const marks: FeedMark[] = [];
  const saved: Array<{ id: number | null; note: string }> = [];
  const d: VerifyDeps = {
    transport: t,
    claim: async () => ({ timeline_last_id: cursor }),
    save: async (id, note) => { saved.push({ id, note }); },
    addMark: async (m) => { marks.push({ ...m, at: NOW }); },
  };
  return { d, marks, saved };
}

void (async () => {
  const wrote = NOW - 5 * H;
  const states = [needUpdate("a", 16345, "11312", 13925), needUpdate("b", 16400, "11400", 14001), needUpdate("c", 16500, "11500", 14100)];
  const inbound = new Map(states.map((s) => [s.thread_id, wrote]));
  const cards = project(states, inbound, [], null, NOW).cards;
  // Every item's history already read, so a case can isolate the timeline.
  const historyRead: FeedMark[] = cards.map((c) => ({ item_key: c.items[0].item_key, thread_id: c.thread_id, mark: "stamps", by: null, evidence: null, at: NOW }));

  console.log("\n[1] reading a row");
  {
    const po = changeOf(change(1, "Order", "11312", { intern_name: { old: "PO-1", new: "PO-2" } }, NOW) as never, ENGINE);
    ok(po?.text === "PO PO-1 → PO-2" && po.ref === "11312", "an Order PO change, by order number", po?.text);
    const noise = changeOf(change(2, "Slot", "58886", { hidden: { old: false, new: "1" } }, NOW) as never, ENGINE);
    ok(noise === null, "Slot.hidden is noise, not a decision");
    const mine = changeOf(change(3, "Slot", "1", { size: { old: 2, new: 1 } }, NOW, ENGINE) as never, ENGINE);
    ok(mine === null, "the engine's own API user is never a staff edit");
    const crew = changeOf(change(4, "Slot", "1", { size: { old: 2, new: 1 } }, NOW) as never, ENGINE);
    ok(crew?.text === "crew 2 → 1", "crew 2 → 1", crew?.text);
  }

  console.log("\n[2] a staff edit after the client's email turns the card green");
  {
    __resetVerifyCache();
    const pages = [
      [change(10, "Order", "11500", { intern_name: { old: "A", new: "B" } }, wrote - H)],          // before the write: not evidence
      [change(20, "Order", "11312", { intern_name: { old: "A", new: "B" } }, wrote + H),            // order a, by number
       change(21, "Job", "14001", { name: { old: "x", new: "y" } }, wrote + H),                      // Job.name is not a decision field
       change(22, "Slot", "777", { size: { old: 2, new: 1 } }, wrote + 2 * H),                       // slot of order b, via the nested read
       change(23, "Order", "11500", { intern_name: { old: "B", new: "C" } }, wrote + H, ENGINE)],   // the engine itself
    ];
    const nested = { 16400: { id: 16400, Job: [{ id: 14001, SlotTeam: [{ id: 555, Slot: [{ id: 777 }] }] }] } };
    const on = fakeOnsinch(pages, { nested });
    const { d, marks, saved } = deps(on.t);
    const r = await verify(cards, NOW, d);
    const keys = new Map(marks.map((m) => [m.thread_id, m]));
    ok(keys.get("a")?.mark === "staff-edit" && (keys.get("a")?.evidence as { text: string }).text === "PO A → B", "order a: green on its PO change", JSON.stringify(keys.get("a")?.evidence));
    ok((keys.get("b")?.evidence as { text: string } | undefined)?.text === "crew 2 → 1", "order b: green on a Slot change found through its blocks");
    ok(!keys.has("c"), "order c: an edit before the client's email and the engine's own edit are not evidence");
    ok(r.wrote === 2 && saved[0]?.id === 23, "the cursor moves to the newest row read", JSON.stringify(saved));
    const after = project(states, inbound, marks, null, NOW).cards;
    ok(after.filter((c) => c.green).length === 2, "and the projection shows two green cards");
  }

  console.log("\n[3] the cursor: only rows newer than the last one seen");
  {
    __resetVerifyCache();
    const pages = [[change(5, "Order", "11312", { intern_name: { old: "A", new: "B" } }, wrote + H)], [change(30, "Order", "11400", { name: { old: "A", new: "B" } }, wrote + H)]];
    const on = fakeOnsinch(pages);
    const { d, marks } = deps(on.t, 20);
    await verify(cards, NOW, d, historyRead);
    ok(marks.length === 1 && marks[0].thread_id === "b", "row 5 is behind the cursor and is not re-read as new");
    ok(on.calls.filter((c) => c.startsWith("GET /timelineAudits")).length === 2, "page 1 for the count, then back from the last page until the cursor (page 1 is not fetched twice)", on.calls.join(" | "));
    ok(!on.calls.some((c) => c.includes("Job__SlotTeam")), "no nested read when no Slot or SlotTeam row needs one");
  }

  console.log("\n[4] a block added by hand is found by its path");
  {
    __resetVerifyCache();
    const on = fakeOnsinch([[create(40, "SlotTeam", "999", "Order:16500/Job:14100/SlotTeam:999", wrote + H)]]);
    const { d, marks } = deps(on.t);
    await verify(cards, NOW, d, historyRead);
    ok(marks.length === 1 && marks[0].thread_id === "c" && (marks[0].evidence as { text: string }).text === "block added", "order c: block added");
  }

  console.log("\n[5] timeline down: the order's own stamps, ignoring the engine's");
  {
    __resetVerifyCache();
    const stamped = (id: number, by: number, at: number) => ({ id, modifier: by, modified: iso(at), Job: [] });
    const on = fakeOnsinch([], { timelineDown: true, nested: { 16345: stamped(16345, 1164, wrote + H), 16400: stamped(16400, ENGINE, wrote + H), 16500: stamped(16500, 1164, wrote - H) } });
    const { d, marks, saved } = deps(on.t, 50);
    await verify(cards, NOW, d);
    ok(marks.length === 1 && marks[0].thread_id === "a", "only the order a person stamped after the client's email", marks.map((m) => m.thread_id).join(","));
    ok(!marks.some((m) => m.mark === "stamps"), "and no history is recorded as read while the timeline is down");
    ok(saved[0]?.id === null && /timeline unreadable/.test(saved[0].note), "the cursor is left where it was, and the note says why");
  }

  console.log("\n[6] a needed order somebody raised by hand");
  {
    __resetVerifyCache();
    const need = project([needCreated("n", 77), needCreated("undated", 78)], new Map(), [], null, NOW).cards;
    need[1].dates = [];
    const on = fakeOnsinch([[]], { orders: { "77": [{ id: 16600, number: "11081", happening: "2026-10-16T08:00:00+01:00", Job: [{ id: 14200 }] }] } });
    const { d, marks } = deps(on.t);
    await verify(need, NOW, d);
    ok(marks.length === 1 && marks[0].mark === "order-found" && (marks[0].evidence as { text: string }).text === "order R11081 is in OnSinch", "found by company and date", JSON.stringify(marks[0]?.evidence));
    ok(!on.calls.some((c) => c.includes("company_id=78")), "an undated need is not matched");
  }

  console.log("\n[7] history: edits from before the cursor existed are read once per item");
  {
    __resetVerifyCache();
    const stamped = (id: number, by: number, at: number) => ({ id, modifier: by, modified: iso(at), Job: [{ id: 1, modifier: ENGINE, modified: iso(wrote - H), SlotTeam: [{ id: 41608, modifier: by, modified: iso(at) }] }] });
    const on = fakeOnsinch([[]], { nested: { 16345: stamped(16345, 413, wrote + H), 16400: stamped(16400, ENGINE, wrote + H), 16500: stamped(16500, 413, wrote - H) } });
    const { d, marks } = deps(on.t, 99);
    await verify(cards, NOW, d);
    const edit = marks.filter((m) => m.mark === "staff-edit");
    ok(edit.length === 1 && edit[0].thread_id === "a", "order a: a person edited it after the client's email", edit.map((m) => m.thread_id).join(","));
    ok((edit[0]?.evidence as { text: string } | undefined)?.text === "order, a block edited after the client's email", "and the evidence says what", JSON.stringify(edit[0]?.evidence));
    ok(marks.filter((m) => m.mark === "stamps").length === 3, "all three are recorded as read");
    __resetVerifyCache();
    const again = fakeOnsinch([[]], { nested: {} });
    const second = deps(again.t, 99);
    await verify(cards, NOW, second.d, [...historyRead]);
    ok(!again.calls.some((c) => c.includes("Job__SlotTeam")), "an item whose history was read is not read again");
  }

  console.log("\n[8] not due: nothing is read");
  {
    const on = fakeOnsinch([[]]);
    const r = await verify(cards, NOW, { transport: on.t, claim: async () => null, save: async () => {}, addMark: async () => {} });
    ok(!r.ran && on.calls.length === 0, "another screen verified within the window");
  }

  console.log("\n[9] readOnly refuses anything but GET before it reaches the network");
  {
    const seen: string[] = [];
    const t = readOnly(async (m, p) => { seen.push(`${m} ${p}`); return { status: 200, data: {} }; });
    let refused = 0;
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) await t(m, "/orders", [{}]).catch(() => refused++);
    await t("GET", "/orders");
    ok(refused === 4 && seen.length === 1 && seen[0] === "GET /orders", "four refusals, one GET", seen.join(","));
  }

  // Shaped like the live cases of 2026-10-04: three Blackout orders on one day at three
  // venues, a roadshow named by its R number, a client with no company, and two orders
  // whose blocks staff built before the engine touched them.
  console.log("\n[10] a need the engine never bound: the order staff booked by hand");
  {
    const day = "2026-10-16";
    const sent = Date.parse("2026-09-17T12:00:00Z");
    const before = iso(sent - 30 * 24 * H), after = iso(sent + 24 * H);
    const unbound = (id: string, kind: "update" | "new-job", over: Record<string, unknown> = {}) =>
      ({ ...base, thread_id: id, classification: kind, status: "needs-info", company_id: 61, place_id: 24, order_action_log: [], facts: { requests: [{ date: day }] }, ...over }) as unknown as ConversationState;
    const order = (id: number, number: string, place: number, b: string, e: string, o: { by?: number; made?: string; editor?: number; edited?: string; name?: string } = {}) => {
      const stamp = { creator: o.by ?? 102, created: o.made ?? before, modifier: o.editor ?? 102, modified: o.edited ?? before };
      return {
        id, number, happening: b, name: o.name ?? `Blackout @ venue ${place}`, ...stamp,
        Job: [{ id: id + 1, min_beginning: b, max_end: e, ...stamp, SlotTeam: [{ id: id + 2, ...stamp, Slot: [{ id: id + 3, beginning: b, end: e, SlotLocation: { place_id: place } }] }] }],
      };
    };
    const run = async (states: ConversationState[], orders: Record<string, unknown[]>, marks: FeedMark[] = [], at = sent) => {
      __resetVerifyCache();
      const p = project(states, new Map(states.map((s) => [s.thread_id, at])), marks, null, NOW);
      const nestedById: Record<number, unknown> = {};
      for (const list of Object.values(orders)) for (const o of list as Array<{ id: number }>) nestedById[o.id] = o;
      const on = fakeOnsinch([[]], { orders, nested: nestedById });
      const { d, marks: wrote } = deps(on.t);
      await verify(p.cards, NOW, d, marks, 60_000, p.wants);
      return wrote;
    };
    // An undated thread is dated by its email: older than a fortnight it leaves the list
    // before the verifier sees it, so those cases are written two days ago.
    const ev = (m: FeedMark | undefined) => (m?.evidence as { text?: string } | null)?.text;

    const blackout = [
      order(15947, "10954", 24, "2026-10-16T09:00:00+00:00", "2026-10-16T17:00:00+00:00", { edited: after }),
      order(16093, "11081", 853, "2026-10-16T06:00:00+00:00", "2026-10-16T12:00:00+00:00", { edited: after }),
      order(16081, "11069", 49, "2026-10-16T06:00:00+00:00", "2026-10-16T12:00:00+00:00", { edited: after }),
    ];
    let w = await run([unbound("move", "update"), unbound("po", "new-job")], { "61": blackout });
    const move = w.filter((m) => m.thread_id === "move");
    ok(move.some((m) => m.mark === "matched" && ev(m) === "R10954, found by venue"), "three orders that day: the one at the thread's venue", move.map((m) => `${m.mark}:${ev(m)}`).join(" | "));
    ok(ev(move.find((m) => m.mark === "staff-edit")) === "order, job, a block edited after the client's email", "an update goes green only on a person's edit after the email");
    ok(ev(w.find((m) => m.thread_id === "po" && m.mark === "order-found")) === "order R10954 is in OnSinch", "a needed order that already exists is found");
    const shown = project([unbound("move", "update"), unbound("po", "new-job")], new Map([["move", sent], ["po", sent]]), w, null, NOW).cards;
    ok(shown.every((c) => c.r_number === "R10954" && c.order_id === null), "the screen shows the found numbers; the binding stays the engine's", shown.map((c) => `${c.r_number}/${c.order_id}`).join(","));

    w = await run([unbound("vague", "new-job", { company_id: 62, place_id: null })], { "62": [order(1, "1", 24, "2026-10-16T09:00:00+00:00", "2026-10-16T17:00:00+00:00"), order(2, "2", 49, "2026-10-16T09:00:00+00:00", "2026-10-16T17:00:00+00:00")] });
    ok(w.length === 0, "two orders that day and nothing to tell them apart: refused, the card stays open", w.map((m) => m.mark).join(","));

    w = await run([unbound("waf", "update", { company_id: 324, place_id: null, subject: "Re: Price quote - R11029 WAF", facts: { requests: [] } })], { "324": [order(16035, "11029", 1188, "2026-10-13T09:00:00+00:00", "2026-10-22T15:00:00+00:00")] }, [], NOW - 2 * 24 * H);
    ok(ev(w.find((m) => m.mark === "matched")) === "R11029, found by its reference", "an undated thread found by the R number in its subject");
    ok(!w.some((m) => m.mark === "staff-edit"), "and not green: nobody touched it after the email");

    w = await run([unbound("eav", "update", { company_id: 354, place_id: null, subject: "EAV6695 GTT", facts: { requests: [] } })], { "354": [order(16247, "11220", 127, "2026-09-30T15:00:00+00:00", "2026-09-30T17:00:00+00:00", { name: "Essential AV - EAV6695 GTT @ Shangri-La", edited: after })] }, [], NOW - 2 * 24 * H);
    ok(ev(w.find((m) => m.mark === "matched")) === "R11220, found by its reference", "a client's own reference in the order name");

    const recent = [order(16352, "11319", 7, "2026-10-10T08:00:00+00:00", "2026-10-10T14:00:00+00:00", { name: "Barnery Meek  @ Private residence" }), order(16361, "11328", 8, "2026-10-10T08:00:00+00:00", "2026-10-10T14:00:00+00:00", { name: "Divine Musiq @ Banham Park" })];
    w = await run([unbound("barney", "new-job", { company_id: null, place_id: 7032, sender_email: "barney.meek@hotmail.co.uk", facts: { requests: [{ date: "2026-10-10" }] } }),
      unbound("desk", "new-job", { company_id: null, place_id: null, sender_email: "info@somewhere.co.uk", facts: { requests: [{ date: "2026-10-10" }] } })], { recent });
    ok(ev(w.find((m) => m.thread_id === "barney")) === "order R11319 is in OnSinch", "no company: the sender's surname on that day's order", w.map((m) => ev(m)).join(" | "));
    ok(!w.some((m) => m.thread_id === "desk"), "a desk address names nobody and matches nothing");

    // Bound orders: the stamps read once, with the engine's wanted shifts.
    const wanted = (shifts: Array<[string, string]>) => ({ slot_teams: shifts.map(([b, e]) => ({ beginning: b, end: e, size: 2, place_id: 1446 })) });
    const bound = (id: string, oid: number, shifts: Array<[string, string]>) => ({ ...needUpdate(id, oid, String(oid), oid + 1), desired_order: wanted(shifts), facts: { requests: shifts.map(([b]) => ({ date: b.slice(0, 10) })) } }) as unknown as ConversationState;
    const nov = (h: number) => `2026-11-19T${String(h).padStart(2, "0")}:00:00+00:00`;
    const spark = order(13726, "13726", 1446, nov(8), nov(12));
    const byEngine = order(13800, "13800", 1446, nov(8), nov(12), { by: ENGINE, editor: ENGINE });
    const extra = order(13900, "13900", 1446, nov(8), nov(12));
    (extra.Job[0].SlotTeam as unknown[]).push({ id: 1, creator: ENGINE, Slot: [{ id: 2, beginning: "2026-11-18T08:00:00+00:00", end: "2026-11-18T12:00:00+00:00", SlotLocation: { place_id: 1446 } }] });
    const built = order(14000, "14000", 1446, nov(8), nov(12), { made: after, editor: ENGINE, edited: iso(sent + 2 * 24 * H) });
    w = await run([bound("spark", 13726, [[nov(8), nov(12)]]), bound("engine", 13800, [[nov(8), nov(12)]]), bound("extra", 13900, [[nov(8), nov(12)]]), bound("built", 14000, [[nov(9), nov(13)]])],
      { "0": [spark, byEngine, extra, built] });
    const green = (id: string) => ev(w.find((m) => m.thread_id === id && m.mark === "staff-edit"));
    ok(green("spark") === "every shift asked for" && (w.find((m) => m.thread_id === "spark" && m.mark === "staff-edit")?.evidence as { held?: boolean }).held === true, "every shift asked for is on a block a person made", String(green("spark")));
    ok(green("engine") === undefined, "blocks the engine wrote are not evidence");
    ok(green("extra") === undefined, "a block on a day the thread does not ask for keeps it open (Lux R11359)");
    ok(green("built") === "order, a block made by staff after the client's email", "an order a person built after the email, though the engine edited it last", String(green("built")));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
