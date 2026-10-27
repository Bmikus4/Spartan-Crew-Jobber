// ============================================================================
// GET /api/feed: a broken read is a 500, never an empty feed.
// ----------------------------------------------------------------------------
// An empty list on the office TV reads as "all clear". Intake was down for 53 hours on
// 2026-10-01..03 with nothing on any screen saying so, so failure has to be loud here.
// Run: npx tsx test/feedServe.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { serveFeed, type FeedDeps, type HeldLink } from "../app/lib/feed/serve";
import type { ConversationState } from "../app/lib/onsinch/types";
import type { FeedCard, FeedMark } from "../app/lib/feed/project";
import { fromStates } from "./fixtures/stateSource";

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
    sources: async (inb, at) => fromStates([created], inb, at),
    inbound: async () => ({ byThread: new Map(), latest: NOW - 10 * 60_000 }),
    marks: async () => [],
    replies: null,
    ...over,
  };
}
const boom = async (): Promise<never> => { throw new Error("connection refused"); };

void (async () => {
  console.log("\n[1] a failing read is a 500, never an empty list");
  for (const which of ["sources", "inbound", "marks"] as const) {
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
    ok(r.status === 200 && r.body.ok === true && items.length === 0 && (r.body.counts as Record<string, number>).done_by_system === 1, "200; an order the system created is counted, not shown (Ben 10-13: the TV shows only what the system could not do)");
    // Ben, 10-20 and 10-21: "delete the everything tab completely". The labels still need every card.
    ok(!("everything" in r.body), "no Everything list is sent to the TV");
    const every = r.all ?? [];
    ok(every.length === 1 && every[0].thread_id === "c", "the labels' cards still carry the order the system created", JSON.stringify(every.map((c) => c.thread_id)));
    const ticked = await serveFeed(deps({ marks: async () => [{ item_key: (every[0] as any).items[0].item_key, mark: "checked", by: null, evidence: null, at: NOW - 60_000 } as any] }), NOW);
    ok((ticked.all ?? [])[0]?.green === true && (ticked.body.items as unknown[]).length === 0, "a ticked success stays off the Needs Action list: it was never a failure", JSON.stringify((ticked.body.items as any[]).map((c) => c.thread_id)));
    const route = readFileSync("app/api/bot/labels/route.ts", "utf8");
    ok(/feed\.all/.test(route) && !/body\.everything|body\.items/.test(route), "the Gmail labels read every card, not the TV's list");
    const h = r.body.health as Record<string, unknown>;
    ok(h.minutes_since_email === 10 && h.intake_stale === false, "email age reported, not stale at 10 minutes");
    const quiet = await serveFeed(deps({ inbound: async () => ({ byThread: new Map(), latest: NOW - 3 * H }) }), NOW);
    ok((quiet.body.health as Record<string, unknown>).intake_stale === true, "quiet for 3 hours on a Monday morning is stale");
    const never = await serveFeed(deps({ inbound: async () => ({ byThread: new Map(), latest: null }) }), NOW);
    ok((never.body.health as Record<string, unknown>).intake_stale === true, "no mail ever is stale, not calm");
    // Ben paused intake 2026-10-21: the silence is on purpose, so the TV must not call it a fault.
    const paused = await serveFeed(deps({ inbound: async () => ({ byThread: new Map(), latest: NOW - 3 * H }), intakePaused: async () => true }), NOW);
    const ph = paused.body.health as Record<string, unknown>;
    ok(ph.intake_stale === false && ph.intake_paused === true, "intake paused in Settings: the silence is not stale, and the TV is told it is paused", JSON.stringify(ph));
    const unread = await serveFeed(deps({ inbound: async () => ({ byThread: new Map(), latest: NOW - 3 * H }), intakePaused: boom }), NOW);
    ok((unread.body.health as Record<string, unknown>).intake_stale === true, "a settings read that fails judges the silence as usual: an outage is never hidden by a failed read");
    ok(/intakePaused: \(\) => getSettings\(\)/.test(readFileSync("app/lib/feed/live.ts", "utf8")), "production reads the pause from Settings");
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
    ok(r.status === 200 && (r.body.counts as Record<string, number>).done_by_system === 1, "verifier throws -> feed still served");
    ok(/verify failed: connection refused/.test(String(((r.body.health as Record<string, unknown>).verify as Record<string, unknown>).note)), "and the failure is reported");
    const marks: FeedMark[] = [];
    const need = { ...created, classification: "update", status: "error", order_action_log: [] } as unknown as ConversationState;
    const g = await serveFeed(deps({
      sources: async (inb, at) => fromStates([need], inb, at),
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
    await serveFeed(deps({ sources: async (inb, at) => fromStates([need], inb, at), marks: async () => [...marks], remember }), NOW);
    ok(marks.length === 1 && marks[0].mark === "open", "first refresh: the need is remembered");
    const gone = { ...need, status: "ordered" } as ConversationState;
    const r = await serveFeed(deps({ sources: async (inb, at) => fromStates([gone], inb, at), marks: async () => [...marks], remember }), NOW + 60_000);
    const items = r.body.items as FeedCard[];
    ok(items.length === 1 && items[0].green && items[0].items[0].green?.mark === "resolved", "resolved: green on the same refresh, not gone");
    const failing = await serveFeed(deps({ sources: async (inb, at) => fromStates([need], inb, at), remember: boom }), NOW);
    ok(failing.status === 200 && (failing.body.items as unknown[]).length === 1, "a failed memory write never costs the feed");
    ok(/remember: async/.test(readFileSync("app/lib/feed/live.ts", "utf8")), "production wires memory to addMark");
  }

  console.log("\n[7] every job is listed, with the R and J of its own order (Ben, 10-21)");
  {
    const numbered = { ...created, thread_id: "n", classification: "update", status: "error", order_action_log: [], onsinch_order_number: "11029", onsinch_job_id: 16100 } as unknown as ConversationState;
    const bare = { ...created, thread_id: "b", classification: "update", status: "error", order_action_log: [], onsinch_order_id: undefined } as unknown as ConversationState;
    const lastIn = new Map([["n", NOW - 30 * H], ["b", NOW - 30 * H]]);
    const held: HeldLink[] = [
      { thread_id: "h", r_number: "11562", company: "EMS Events", subject: "J46434", since: new Date(NOW - 2 * H).toISOString(), note: null, days: ["2026-10-02"] },
      { thread_id: "h2", r_number: "11600", company: "Later", subject: "x", since: new Date(NOW - 2 * H).toISOString(), note: null, days: ["2026-10-09"] },
    ];
    const r = await serveFeed(deps({ sources: async (inb, at) => fromStates([numbered, bare], inb, at), inbound: async () => ({ byThread: lastIn, latest: NOW - 10 * 60_000 }), held: async () => held }), NOW);
    const items = r.body.items as FeedCard[];
    const counts = r.body.counts as Record<string, number>;
    ok(items.some((c) => c.thread_id === "n") && items.some((c) => c.thread_id === "b"), "the job with its numbers and the one still without are both listed: no job is hidden for lacking them", items.map((c) => c.thread_id).join());
    ok(counts.needs_follow_up === 2 && !("unlinked" in counts), "Needs Follow Up counts the list, and nothing is counted as hidden", JSON.stringify(counts));
    const h2 = items.find((c) => c.thread_id === "h2");
    ok(!items.some((c) => c.thread_id === "h") && !!h2 && h2.r_number === null && /R11600 is no longer in OnSinch/.test(h2.note ?? ""), "a held link's job that is over leaves; one still to come shows no R: the number is a gone order's, and may be reused", JSON.stringify(h2));
    // The jobs board's tiles: numbers from the thread's live link, or no tile.
    const tickets = [{ thread_id: "p1", classification: "new-job", status: "ordered", order_id: 1, order_number: "999", job_id: 5, dates: [], subject: "s" }, { thread_id: "p2", classification: "new-job", status: "ordered", order_id: 2, order_number: "11029", job_id: 6, dates: [], subject: "s" }] as any[];
    const p = await serveFeed(deps({ sources: async (inb, at) => fromStates([], inb, at), jobs: async () => tickets, links: async () => new Map([["p2", { order_id: 16100, r_number: "11777", job_id: 16200 }]]) }), NOW);
    const tiles = (p.body.items as FeedCard[]).filter((c) => /^ported:/.test(c.items[0].item_key));
    ok(tiles.length === 1 && tiles[0].thread_id === "p2" && tiles[0].r_number === "R11777" && tiles[0].j_number === "J16200", "a carried-over tile shows its order's numbers as OnSinch has them now, and one with no live order is not shown", JSON.stringify(tiles.map((c) => [c.thread_id, c.r_number, c.j_number])));
    const live = readFileSync("app/lib/feed/live.ts", "utf8");
    ok(!/states:/.test(live) && /portedStates: pausedStates/.test(live) && /\blinks,/.test(live), "production draws nothing from the paused engine (approved 10-20, Q4) and gives the tiles the live links");
  }

  console.log("\n[5] the route is guarded and serves through serveFeed");
  {
    const src = readFileSync("app/api/feed/route.ts", "utf8");
    const get = src.slice(src.indexOf("export async function GET"));
    ok(get.indexOf("authorizeAction") >= 0 && get.indexOf("authorizeAction") < get.indexOf("serveFeed"), "authorizeAction before anything is read");
    ok(/status: 401/.test(get) && /status: r\.status/.test(get), "401 when refused, serveFeed's status otherwise");
    // 10-21: the office screen kept drawing the deleted Everything tab until reloaded by hand.
    const screen = readFileSync("app/components/LiveFeedScreen.tsx", "utf8");
    ok(/build/.test(get) && /build\.current !== body\.build\) \{ window\.location\.reload\(\)/.test(screen), "the feed says which build answered, and a screen that sees it change reloads itself");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
