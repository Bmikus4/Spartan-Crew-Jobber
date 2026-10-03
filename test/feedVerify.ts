// ============================================================================
// The feed's verifier turns a card green only on a person's edit after the engine's.
// ----------------------------------------------------------------------------
// Fixtures are shaped like the live rows read on 2026-10-03: /timelineAudits sorted
// oldest-first (newest on the LAST page), `common_change` carrying
// data.diffChanges.{Model}.{field}: {old, new}; Order rows naming the order NUMBER, Job
// rows the job id, Slot and SlotTeam rows only themselves.
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
const checkState = (id: string, oid: number, num: string, job: number, ts: number) => ({ ...base, thread_id: id, classification: "new-job", status: "ordered", onsinch_order_id: oid, onsinch_order_number: num, onsinch_job_id: job, order_action_log: [{ ts, kind: "create", order_id: oid, ok: true }] }) as unknown as ConversationState;
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
  const states = [checkState("a", 16345, "11312", 13925, wrote), checkState("b", 16400, "11400", 14001, wrote), checkState("c", 16500, "11500", 14100, wrote)];
  const cards = project(states, new Map(), [], null, NOW).cards;

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

  console.log("\n[2] a staff edit after the engine's write turns the card green");
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
    ok(!keys.has("c"), "order c: an edit before the engine's write and the engine's own edit are not evidence");
    ok(r.wrote === 2 && saved[0]?.id === 23, "the cursor moves to the newest row read", JSON.stringify(saved));
    const after = project(states, new Map(), marks, null, NOW).cards;
    ok(after.filter((c) => c.green).length === 2, "and the projection shows two green cards");
  }

  console.log("\n[3] the cursor: only rows newer than the last one seen");
  {
    __resetVerifyCache();
    const pages = [[change(5, "Order", "11312", { intern_name: { old: "A", new: "B" } }, wrote + H)], [change(30, "Order", "11400", { name: { old: "A", new: "B" } }, wrote + H)]];
    const on = fakeOnsinch(pages);
    const { d, marks } = deps(on.t, 20);
    await verify(cards, NOW, d);
    ok(marks.length === 1 && marks[0].thread_id === "b", "row 5 is behind the cursor and is not re-read as new");
    ok(on.calls.filter((c) => c.startsWith("GET /timelineAudits")).length === 2, "page 1 for the count, then back from the last page until the cursor (page 1 is not fetched twice)", on.calls.join(" | "));
    ok(!on.calls.some((c) => c.includes("Job__SlotTeam")), "no nested read when no Slot or SlotTeam row needs one");
  }

  console.log("\n[4] a block added by hand is found by its path");
  {
    __resetVerifyCache();
    const on = fakeOnsinch([[create(40, "SlotTeam", "999", "Order:16500/Job:14100/SlotTeam:999", wrote + H)]]);
    const { d, marks } = deps(on.t);
    await verify(cards, NOW, d);
    ok(marks.length === 1 && marks[0].thread_id === "c" && (marks[0].evidence as { text: string }).text === "block added", "order c: block added");
  }

  console.log("\n[5] timeline down: the order's own stamps, ignoring the engine's");
  {
    __resetVerifyCache();
    const stamped = (id: number, by: number, at: number) => ({ id, modifier: by, modified: iso(at), Job: [] });
    const on = fakeOnsinch([], { timelineDown: true, nested: { 16345: stamped(16345, 1164, wrote + H), 16400: stamped(16400, ENGINE, wrote + H), 16500: stamped(16500, 1164, wrote - H) } });
    const { d, marks, saved } = deps(on.t, 50);
    await verify(cards, NOW, d);
    ok(marks.length === 1 && marks[0].thread_id === "a", "only the order a person stamped after our write", marks.map((m) => m.thread_id).join(","));
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

  console.log("\n[7] not due: nothing is read");
  {
    const on = fakeOnsinch([[]]);
    const r = await verify(cards, NOW, { transport: on.t, claim: async () => null, save: async () => {}, addMark: async () => {} });
    ok(!r.ran && on.calls.length === 0, "another screen verified within the window");
  }

  console.log("\n[8] readOnly refuses anything but GET before it reaches the network");
  {
    const seen: string[] = [];
    const t = readOnly(async (m, p) => { seen.push(`${m} ${p}`); return { status: 200, data: {} }; });
    let refused = 0;
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) await t(m, "/orders", [{}]).catch(() => refused++);
    await t("GET", "/orders");
    ok(refused === 4 && seen.length === 1 && seen[0] === "GET /orders", "four refusals, one GET", seen.join(","));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
