// ============================================================================
// A job the client has called off, never booked yet, books nothing.
// ----------------------------------------------------------------------------
// 2026-09-30, first live night: Creative8 asked for 4 crew on 30 Sep, Tracy declined the
// day and quoted Thursday, and the client wrote "We managed to get agency in ... it won't
// be needed." The engine first saw the thread 46 seconds later and created order 16324
// for the 30th. The model read no cancellation; one it does read is already held by the
// pipeline (case [3] pins that), so the words themselves are the backstop.
//
// Over 807 stored threads the phrase rule marks 7 latest client emails: 6 are the job
// being called off, 1 (Solotech, "the previous 2 dates have gone away") also names a live
// date. Holding costs that one a Needs Built tag instead of an automatic order.
//
// Offline.  npx tsx test/calledOffBooksNothing.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, cannotBeBooked, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { callsItOff } from "../app/lib/engine/triage";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts, type ConversationState } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const FACTS: ConversationFacts = {
  company_name: "RedBeast Energy", contact_email: "pier@redbeast.co.uk", location_text: "2 Savoy Place London WC2R 0BL",
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "16:00", size: 4, task: "load/unload" }],
};

function rig(modelCancels = false) {
  let creates = 0;
  const tags: Array<{ label: string; state: string }> = [];
  const reasoner: Reasoner = {
    async classifyAndExtract() {
      return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS, ...(modelCancels ? { cancellation: true } : {}) } as ClassifyResult & { facts: ConversationFacts };
    },
    async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "high", job_summary: "x" }; },
    async extractFacts() { return FACTS; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  const onsinch = new OnsinchClient(mockTransport);
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { creates++; return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    flagForManual: async (t: any) => { tags.push({ label: t.label, state: t.state }); },
  };
  return { deps, creates: () => creates, tags };
}

const ask = msg({ message_id: "c1", date_iso: "2026-03-01T09:00:00Z", subject: "Labour required", body: "We need 4x labour crew on 9 March 08:00-16:00 at 2 Savoy Place London WC2R 0BL. RedBeast Energy" });
const reply = (body: string) => msg({ message_id: "c2", date_iso: "2026-03-02T09:00:00Z", subject: "RE: Labour required", body });

async function main() {
  console.log("\n[1] the rule, on the words that were live");
  ok(!!callsItOff("Hi Tracy,\nWe managed to get agency in today so need to for tomorrow.\nThank you for this though but it won't be needed."), "Creative8");
  ok(!!callsItOff("I haven't heard anything, it's probably safe to assume it's not going ahead."), "not going ahead");
  ok(!!callsItOff("No that's very expensive, leave this please cancel."), "please cancel");
  ok(!callsItOff("Please book 4 crew for the 9th, PO to follow."), "a booking is not a call-off");
  ok(!callsItOff("Looks good.\nFrom: Bookings Spartan Crew\nSent: 29 September 2026 17:33\nIf the job is cancelled, it won't be needed to pay."), "words in the quoted reply below are not the client's");

  console.log("\n[2] the client calls it off before any order: nothing is booked, ops are tagged");
  {
    const r = rig();
    const s = await handleThread({ thread_id: "t-off", messages: [ask, reply("We managed to get agency in today. Thank you for this though but it won't be needed.")] }, r.deps);
    ok(r.creates() === 0, "no order", String(r.creates()));
    ok(s.status === "needs-info" && s.notes.some((n) => /NOT BOOKED/.test(n)), "held with the reason", `${s.status} :: ${s.notes.slice(-1)[0]}`);
    ok(r.tags.some((t) => t.state === "manual" && t.label === "Order Needs Built"), "and tagged Order Needs Built", JSON.stringify(r.tags));
  }

  console.log("\n[3] a cancellation the model DID read still stops a first create");
  {
    const r = rig(true);
    await handleThread({ thread_id: "t-mc", messages: [ask, reply("Sorry, the event is off.")] }, r.deps);
    ok(r.creates() === 0, "no order", String(r.creates()));
  }

  console.log("\n[4] an ordinary enquiry still books");
  {
    const r = rig();
    await handleThread({ thread_id: "t-ok", messages: [ask] }, r.deps);
    ok(r.creates() === 1, "one order", String(r.creates()));
  }

  console.log("\n[5] a BOOKED job called off, the model reading it as nothing special");
  {
    // Verified 2026-10-01: this stayed `ordered`, untagged, and a changed composition was
    // patched straight in. Booked first, then called off; the fake model flags nothing.
    const r = rig();
    let patches = 0;
    r.deps.executor.patchOrder = async () => { patches++; return []; };
    await handleThread({ thread_id: "t-bk", messages: [ask] }, r.deps);
    const before = r.tags.length;
    const s = await handleThread({ thread_id: "t-bk", messages: [ask, reply("We have decided to go with another supplier, so we no longer need the crew.")] }, r.deps);
    ok(s.cancellation === true && patches === 0, "read as a cancellation, nothing written", `cancellation=${s.cancellation} patches=${patches}`);
    ok(r.tags.slice(before).some((t) => t.state === "manual" && t.label === "Order Needs Updated"), "and tagged Order Needs Updated", JSON.stringify(r.tags.slice(before)));
  }

  console.log("\n[6] a partial change is not a call-off");
  ok(!callsItOff("No longer need the crew to stay till 10pm and go to our yard"), "shorter hours");
  ok(!callsItOff("Will confirm as soon as possible, the previous 2 dates have gone away now"), "other dates gone, this one live");
  ok(!!callsItOff("Sorry to say, this job has gone away"), "but the job itself gone away is");

  console.log("\n[7] a booked thread with only a review note is not a failure; an unbooked one still is");
  {
    const base = { classification: "update", needs_human: true, review_only: true, status: "needs-info" } as unknown as ConversationState;
    ok(!cannotBeBooked({ ...base, onsinch_order_id: 9001 }), "booked: no Needs label over Order Built");
    ok(cannotBeBooked(base), "unbooked: it held, so it is tagged");
    ok(cannotBeBooked({ ...base, classification: "not-a-job", cancellation: true, onsinch_order_id: 9001 } as never),
      "a cancellation of a booking is tagged whatever it was classified as");
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
