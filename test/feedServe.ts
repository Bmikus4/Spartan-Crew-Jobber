// ============================================================================
// GET /api/feed: a broken read is a 500, never an empty feed.
// ----------------------------------------------------------------------------
// An empty list on the office TV reads as "all clear". Intake was down for 53 hours on
// 2026-10-01..03 with nothing on any screen saying so, so failure has to be loud here.
// Run: npx tsx test/feedServe.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { serveFeed, type FeedDeps } from "../app/lib/feed/serve";
import type { ConversationState } from "../app/lib/engine/types";
import type { FeedCard, FeedMark } from "../app/lib/feed/project";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NOW = Date.parse("2026-10-05T10:00:00Z"); // a Monday, inside working hours
const H = 3_600_000;
const created = {
  thread_id: "c", subject: "s", participants: [], last_message_id: "m", last_processed_epoch: NOW,
  classification: "new-job", facts: { requests: [] }, desired_order: null, priority: "medium", status: "ordered", notes: [],
  onsinch_order_id: 901, order_action_log: [{ ts: NOW - H, kind: "create", order_id: 901, ok: true }],
} as unknown as ConversationState;

function deps(over: Partial<FeedDeps> = {}): FeedDeps {
  return {
    states: async () => [created],
    inbound: async () => ({ byThread: new Map(), latest: NOW - 10 * 60_000 }),
    marks: async () => [],
    replies: null,
    ...over,
  };
}
const boom = async (): Promise<never> => { throw new Error("connection refused"); };

void (async () => {
  console.log("\n[1] a failing read is a 500, never an empty list");
  for (const which of ["states", "inbound", "marks"] as const) {
    const r = await serveFeed(deps({ [which]: boom }), NOW);
    ok(r.status === 500 && r.body.ok === false && !("items" in r.body), `${which} fails -> 500, ok:false, no items`);
  }
  {
    const r = await serveFeed(deps({ replies: boom }), NOW);
    ok(r.status === 500, "the reply lane failing, when it is on, is a failure too");
  }

  console.log("\n[2] a healthy read");
  {
    const r = await serveFeed(deps(), NOW);
    const items = r.body.items as { thread_id: string }[];
    ok(r.status === 200 && r.body.ok === true && items.length === 1, "200 with the item");
    const h = r.body.health as Record<string, unknown>;
    ok(h.minutes_since_email === 10 && h.intake_stale === false, "email age reported, not stale at 10 minutes");
    const quiet = await serveFeed(deps({ inbound: async () => ({ byThread: new Map(), latest: NOW - 3 * H }) }), NOW);
    ok((quiet.body.health as Record<string, unknown>).intake_stale === true, "quiet for 3 hours on a Monday morning is stale");
    const never = await serveFeed(deps({ inbound: async () => ({ byThread: new Map(), latest: null }) }), NOW);
    ok((never.body.health as Record<string, unknown>).intake_stale === true, "no mail ever is stale, not calm");
  }

  console.log("\n[3] the reply lane exists only when the feature is on");
  {
    const off = await serveFeed(deps(), NOW);
    ok((off.body.health as Record<string, unknown>).replies_enabled === false, "off: reported off");
    const on = await serveFeed(deps({ replies: async () => [{ thread_id: "r", since_iso: new Date(NOW - 30 * H).toISOString(), company: null, contact: null, subject: "s" }] }), NOW);
    ok((on.body.counts as Record<string, number>).needs_reply === 1, "on: replies counted");
    const src = readFileSync("app/lib/feed/live.ts", "utf8");
    ok(/replies: followupsEnabled\(\) \? replies : null/.test(src), "production wires the lane through followupsEnabled()");
  }

  console.log("\n[4] verification is extra evidence: its failure never costs the feed");
  {
    const r = await serveFeed(deps({ verify: boom }), NOW);
    ok(r.status === 200 && (r.body.items as unknown[]).length === 1, "verifier throws -> feed still served");
    ok(/verify failed: connection refused/.test(String(((r.body.health as Record<string, unknown>).verify as Record<string, unknown>).note)), "and the failure is reported");
    const marks: FeedMark[] = [];
    const need = { ...created, classification: "update", status: "error", order_action_log: [] } as unknown as ConversationState;
    const g = await serveFeed(deps({
      states: async () => [need],
      marks: async () => marks,
      verify: async () => { marks.push({ item_key: "needs-updated:c:901:0", thread_id: "c", mark: "staff-edit", by: null, evidence: null, at: NOW }); return { ran: true, wrote: 1, note: "ok" }; },
    }), NOW);
    ok((g.body.items as { green: boolean }[])[0]?.green === true, "marks it writes show on the same refresh");
  }

  console.log("\n[6] the feed remembers a need, so one that resolves without a write turns green");
  {
    const marks: FeedMark[] = [];
    const remember = async (ms: Array<Omit<FeedMark, "at">>) => { for (const m of ms) if (!marks.some((x) => x.item_key === m.item_key && x.mark === m.mark)) marks.push({ ...m, at: NOW }); };
    const need = { ...created, thread_id: "n", status: "needs-info", onsinch_order_id: undefined, order_action_log: [] } as unknown as ConversationState;
    await serveFeed(deps({ states: async () => [need], marks: async () => [...marks], remember }), NOW);
    ok(marks.length === 1 && marks[0].mark === "open", "first refresh: the need is remembered");
    const gone = { ...need, status: "ordered" } as ConversationState;
    const r = await serveFeed(deps({ states: async () => [gone], marks: async () => [...marks], remember }), NOW + 60_000);
    const items = r.body.items as FeedCard[];
    ok(items.length === 1 && items[0].green && items[0].items[0].green?.mark === "resolved", "resolved: green on the same refresh, not gone");
    const failing = await serveFeed(deps({ states: async () => [need], remember: boom }), NOW);
    ok(failing.status === 200 && (failing.body.items as unknown[]).length === 1, "a failed memory write never costs the feed");
    ok(/remember: async/.test(readFileSync("app/lib/feed/live.ts", "utf8")), "production wires memory to addMark");
  }

  console.log("\n[5] the route is guarded and serves through serveFeed");
  {
    const src = readFileSync("app/api/feed/route.ts", "utf8");
    const get = src.slice(src.indexOf("export async function GET"));
    ok(get.indexOf("authorizeAction") >= 0 && get.indexOf("authorizeAction") < get.indexOf("serveFeed"), "authorizeAction before anything is read");
    ok(/status: 401/.test(get) && /status: r\.status/.test(get), "401 when refused, serveFeed's status otherwise");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
