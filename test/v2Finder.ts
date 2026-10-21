// ============================================================================
// Release 2 (Ben approved 10-20, Q1a + Q2a): the planner finds a thread's order by evidence and
// keeps its cards current. Every case is an open TV card of 10-21 whose order was in OnSinch
// while the card showed no R or J (handoff 0b, appendix D1), on a fake OnSinch shaped like it.
//
// Offline.  npx tsx test/v2Finder.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { plan, type World, type Message } from "../app/lib/v2/interpret/plan";
import type { Interpretation, Request } from "../app/lib/v2/interpret/interpret";
import type { ThreadMsg } from "../app/lib/v2/threadState";
import { v2Source, type V2Row } from "../app/lib/feed/v2";
import { linkFound } from "../app/lib/v2/links";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const STAFF = 2850;
const team = (id: number, name: string, created: string, slots: any[]) => ({ id, name, creator: STAFF, created, modifier: STAFF, modified: created, Slot: slots });
const pos = (id: number, b: string, e: string, size: number, place = 500) => ({ id, beginning: b, end: e, size, role: 0, profession_id: 1, slotlocation_id: 700 + place, created: "", modified: "", cancelled: false, SlotLocation: { place_id: place } });
const order = (id: number, number: string, company_id: number, name: string, created: string, teams: any[]) => ({ id, number, company_id, status: 1, intern_name: "", name, created, creator: STAFF, modifier: STAFF, modified: created, Job: [{ id: id + 1000, SlotTeam: teams }] });

// Bearded Kitten (300): R11507 "Bearded Kitten - 250430 TikTok @ Southbank", 3 crew on Fri 16 Oct.
const R11507 = order(16624, "11507", 300, "Bearded Kitten - 250430 TikTok @ Southbank", "2026-10-09T10:00:00Z", [team(1, "Crew", "2026-10-09T10:00:00Z", [pos(11, "2026-10-16T07:00:00Z", "2026-10-16T15:00:00Z", 3)])]);
// Icon Events (310): R11442 holds Fri 23 Oct from 18:00.
const R11442 = order(16551, "11442", 310, "Icon @ London Marriott", "2026-10-07T10:00:00Z", [team(2, "Crew", "2026-10-07T10:00:00Z", [pos(21, "2026-10-23T17:00:00Z", "2026-10-23T23:00:00Z", 6)])]);
// Full Tilt: the sender's domain is on two companies (501 and 635); staff built R11750 for 635
// two hours after the email, 4 crew from 08:00 on Fri 23 Oct.
const R11750 = order(16877, "11750", 635, "Full Tilt @ Marshall Arena", "2026-10-19T13:00:00Z", [team(3, "Crew", "2026-10-19T13:00:00Z", [pos(31, "2026-10-23T07:00:00Z", "2026-10-23T15:00:00Z", 4)])]);
// Subfrantic (320): a three-option quote, booked by staff 3-9 minutes after the email.
const R11698 = order(16820, "11698", 320, "Subfrantic @ Dorchester", "2026-10-16T12:05:00Z", [team(4, "Crew", "2026-10-16T12:05:00Z", [pos(41, "2026-11-20T08:00:00Z", "2026-11-20T16:00:00Z", 6)])]);
// A client running two jobs on one day (330): R20001 was there BEFORE the email, at another venue.
const R20001 = order(20001, "20001", 330, "Two Jobs @ Olympia", "2026-10-01T09:00:00Z", [team(5, "Crew", "2026-10-01T09:00:00Z", [pos(51, "2026-10-28T09:00:00Z", "2026-10-28T17:00:00Z", 4, 31)])]);

const orders = [R11507, R11442, R11750, R11698, R20001];
const world: World = {
  companies: async () => [
    { id: 300, name: "Bearded Kitten", Client: [{ id: 1, email: "ops@beardedkitten.co.uk" }] },
    { id: 310, name: "Icon Events", Client: [{ id: 2, email: "crew@iconevents.co.uk" }] },
    { id: 501, name: "MK Crew", Client: [{ id: 3, email: "old@fulltilt.london" }] },
    { id: 635, name: "Full Tilt", Client: [{ id: 4, email: "tom@fulltilt.london" }] },
    { id: 320, name: "Subfrantic", Client: [{ id: 5, email: "jobs@subfrantic.com" }] },
    { id: 330, name: "Two Jobs", Client: [{ id: 6, email: "pm@twojobs.co.uk" }] },
  ],
  placesNamed: async (n) => (/^excel$/i.test(n.trim()) ? [{ id: 49, name: "ExCeL" }] : []),
  companyOrders: async (c) => orders.filter((o) => o.company_id === c),
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
};
const msg = (from: string, subject: string, text: string, sentIso: string): Message => ({ message_id: "m1", from, subject, sentIso, text });
const tm = (from: string, at: string, body: string, ours = false): ThreadMsg => ({ message_id: at, from, to: [], at: Date.parse(at), subject: "", body, ours });
const r = (x: Partial<Request>): Request => ({ action: "new_shift", problems: [], ...x });
const NOW = Date.parse("2026-10-20T09:00:00Z");

(async () => {
  console.log("Bearded Kitten R11507: the order is named by its project reference, not its R number");
  {
    const i: Interpretation = { intent: "change", requests: [r({ action: "change_crew", date: "2026-10-16", crew_add: 3 })], problems: [] };
    const thread = [tm("ops@beardedkitten.co.uk", "2026-10-12T13:21:00Z", "3 lifters for the 250430 job please, add 3 crew on the 16th")];
    const d = await plan(msg("ops@beardedkitten.co.uk", "3 llifters for Monday", "add 3 crew on the 16th", "2026-10-12T13:21:00Z"), i, world, null, { now: Date.parse("2026-10-12T14:00:00Z"), thread });
    const op = d.kind === "write" ? (d.ops[0].op as any) : null;
    ok(d.kind === "write" && op.order_id === 16624, "the change is planned on R11507, found by 250430 in its name", JSON.stringify(d).slice(0, 220));
  }

  console.log("Icon Events R11442: a card the reading checks stopped still names its order");
  {
    const i: Interpretation = { intent: "change", requests: [r({ action: "change_times", target: { quote: "the 6pm call", date: "2026-10-23" }, problems: ["request 1 date: \"1am later that same night\" reads as null, not \"2026-10-23\""] })], problems: [] };
    const d = await plan(msg("crew@iconevents.co.uk", "ethnicity awards - 15", "can they stay until 1am later that same night", "2026-10-19T14:08:00Z"), i, world, null, { now: NOW, raw: [{ date: "2026-10-23", start: "18:00" }] });
    ok(d.kind === "handoff" && d.order_id === 16551, "the hand-off carries R11442 (the day and its 18:00 start), so the TV shows its R and J", JSON.stringify(d));
  }

  console.log("MK Crew: a domain on two companies, and staff built the job two hours after the email");
  {
    const i: Interpretation = { intent: "booking", requests: [r({ date: "2026-10-23", start: "08:00", end: "16:00", crew: 4 })], problems: [] };
    const d = await plan(msg("tom@fulltilt.london", "MK Crew", "4 crew 8am-4pm Friday 23rd", "2026-10-19T10:49:00Z"), i, world, null, { now: NOW });
    ok(d.kind === "none" && /already booked: R11750/.test(d.reason) && JSON.stringify(d.found) === "[16877]", "not \"new client, not in OnSinch\": staff's R11750 holds it and the thread is linked to it", JSON.stringify(d));
  }

  console.log("Subfrantic: a quote whose dates the checks refused, booked by staff minutes later");
  {
    const i: Interpretation = { intent: "quote_request", requests: [r({ problems: ["request 1 date: \"20-Nov\" reads as null, not \"2026-11-20\""] })], problems: [] };
    const d = await plan(msg("jobs@subfrantic.com", "Crew Quote for Subfrantic", "Job 1: 20-Nov, 6 crew from 8am", "2026-10-16T11:58:00Z"), i, world, null, { now: NOW, raw: [{ date: "2026-11-20", start: "08:00", crew: 6 }] });
    ok(d.kind === "none" && /already booked: R11698/.test(d.reason), "every day asked is in an order staff made after the email: done, through the planner", JSON.stringify(d));
  }

  console.log("A second job on the same day is never the new booking");
  {
    const i: Interpretation = { intent: "booking", requests: [r({ date: "2026-10-28", start: "09:00", end: "17:00", crew: 4, venue: "ExCeL" })], problems: [] };
    const d = await plan(msg("pm@twojobs.co.uk", "Crew Wed 28th", "4 crew 9-5 at ExCeL on Wednesday 28th", "2026-10-20T08:00:00Z"), i, world, null, { now: NOW });
    ok(d.kind === "handoff" && /within 14 days/.test(d.reasons[0]) && !d.order_id, "R20001 at Olympia, there before the email, neither covers the ExCeL booking nor heads its card", JSON.stringify(d));
  }

  console.log("The card is the planner's current answer, keyed by the email's first decision");
  {
    const row: V2Row = {
      thread_id: "t1", message_id: "m1", sent_at: "2026-10-16T11:58:00Z", kind: "handoff",
      grounded: { intent: "quote_request", requests: [], problems: [] }, decision: { kind: "handoff", reasons: ["the client asked for a quote"], reply: true },
      executed: null, company_id: 320, company: "Subfrantic", from_address: "jobs@subfrantic.com", subject: "Crew Quote",
    };
    const was = v2Source(row, NOW);
    const done = v2Source({ ...row, replan: { kind: "none", reason: "already booked: R11698, R11701", found: [16820, 16821] } }, NOW);
    ok(was.item?.kind === "needs-reply" && done.item === null && done.resolvedText === "Already booked in OnSinch: R11698, R11701", "planned again to \"already booked\": the card has nothing open and goes green with the orders", JSON.stringify(done.resolvedText));
    const found = v2Source({ ...row, decision: { kind: "handoff", reasons: ["no order is named"] }, replan: { kind: "handoff", reasons: ["no order is named"], order_id: 16624 } }, NOW);
    const first = v2Source({ ...row, decision: { kind: "handoff", reasons: ["no order is named"] } }, NOW);
    ok(found.item?.kind === "needs-updated" && found.order_id === 16624 && found.item.item_key === first.item?.item_key, "an order found since makes it an update on that order, under the same key", `${found.item?.item_key} vs ${first.item?.item_key}`);
    const past = v2Source({ ...row, replan: { kind: "handoff", reasons: ["2026-10-13 is already over: a person adjusts it"], order_id: 16614 } }, NOW);
    ok(past.days.includes("2026-10-13"), "a day the planner says is over is the card's day, so the card leaves with its job (Encore, 10-21)", JSON.stringify(past.days));
  }

  console.log("A found order never displaces a live link (links.ts linkFound)");
  {
    const writes: string[] = [];
    const fake = (rows: any[]) => (async (strings: TemplateStringsArray) => { const q = strings.join("?").trim(); if (/^SELECT/.test(q)) return rows; if (/^(INSERT|DELETE|UPDATE)/.test(q)) writes.push(q.split(/\s+/).slice(0, 3).join(" ")); return []; }) as any;
    ok(await linkFound(fake([{ order_id: 5, state: "linked" }]), { thread_id: "t", order_id: 6, source: "finder" }) === "kept" && !writes.length, "a thread linked to another live order keeps it");
    ok(await linkFound(fake([{ order_id: 6, state: "relinked" }]), { thread_id: "t", order_id: 6, source: "finder" }) === "same" && !writes.length, "the same order is no change");
  }

  console.log("One source for a thread's order");
  {
    const src = readFileSync("app/lib/v2/threadOrder.ts", "utf8").replace(/\/\/.*$/gm, "");
    ok(!/conversation_state|feed_marks/.test(src), "the lookup reads neither the paused engine's bindings nor the TV verifier's screen finds (the Cytiva wrong write)");
    const rp = readFileSync("app/lib/v2/replan.ts", "utf8");
    ok(/run: null/.test(rp) && !/runOp|runWhenFree/.test(rp), "the minute re-plan never writes to OnSinch");
    const sync = readFileSync("app/api/bot/sync/route.ts", "utf8");
    ok(sync.indexOf("replanOpen(sql)") > sync.indexOf("sweepLinks(sql)"), "the minute sync plans the open cards again after the links are swept");
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log("\nall passed");
})();
