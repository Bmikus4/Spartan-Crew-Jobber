// ============================================================================
// SP-06: a venue judge that fails holds the email; code never picks the building.
// ----------------------------------------------------------------------------
// The adjudicator used to take the search's top hit when the model timed out. 8 bookings
// were made that way, at least 3 at the wrong building ("Level 50, 8 Bishopsgate" became
// 100 Bishopsgate, #16308). Now an exact match (postcode and name) still books, anything
// else holds with retry_pending "venue-judge", and the hourly sweep asks again, at most
// MAX_ATTEMPTS held passes in all.
//
// Offline.  npx tsx test/venueRetry.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { retryHeld, MAX_ATTEMPTS, type RetryIO } from "../app/lib/engine/retryHeld";
import { OnsinchClient, __resetListCache } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import type { VenueJudge } from "../app/lib/engine/venueAdjudicate";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

process.env.SPARTAN_VENUE_V3 = "1";

function rig(locationText: string) {
  const facts: ConversationFacts = {
    company_name: "RedBeast Energy", contact_email: "pier@redbeast.co.uk", location_text: locationText,
    requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "16:00", size: 4, task: "load/unload" }],
  };
  const book = msg({ message_id: "v1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: `Please book 4 crew on 9 March 08:00-16:00 at ${locationText}. RedBeast Energy` });
  let creates = 0, judgeCalls = 0;
  let judgeUp = false;
  const reasoner: Reasoner = {
    async classifyAndExtract() { return { classification: "new-job", priority: "high", job_summary: "crew", facts } as ClassifyResult & { facts: ConversationFacts }; },
    async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "high", job_summary: "x" }; },
    async extractFacts() { return facts; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  const venueJudge: VenueJudge = {
    async adjudicate() {
      judgeCalls++;
      if (!judgeUp) throw new Error("venue judge (gemini) timed out after 30000ms");
      return { decision: "match", place_id: 88, confidence: 0.9, reason: "Savoy Place is the IET building on the Strand" };
    },
  };
  const onsinch = new OnsinchClient(mockTransport);
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { creates++; return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const store = new InMemoryStore();
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store, metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS }, venueJudge,
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    flagForManual: async () => {},
  };
  const io: RetryIO = {
    listsReadable: async () => true,
    run: async (id) => handleThread({ thread_id: id, messages: [book] }, deps),
  };
  return {
    deps, io, store, book, creates: () => creates, judgeCalls: () => judgeCalls,
    judgeBack: () => { judgeUp = true; },
  };
}

async function main() {
  console.log("\n[1] judge down, no exact match: held and tagged, nothing booked");
  __resetListCache();
  const r = rig("Savoy Place, on the Strand");
  const held = await handleThread({ thread_id: "t-j", messages: [r.book] }, r.deps);
  ok(held.retry_pending === "venue-judge", "held for the venue judge", String(held.retry_pending));
  ok(r.creates() === 0, "createOrder was never called", String(r.creates()));
  ok(held.needs_human === true, "and a person is told");
  ok(held.retry_attempts === 1, "first held pass counted", String(held.retry_attempts));
  ok(held.notes.some((n) => /searched \d+ venues, model-unavailable/.test(n)), "the note keeps the shape the verification counts",
    held.notes.find((n) => /venue/.test(n)) ?? "");
  ok(!held.notes.some((n) => /created as a new venue/.test(n)), "and no venue is created from the client's words");

  console.log("\n[2] the sweep asks again, and stops after MAX_ATTEMPTS held passes");
  let s = held;
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    await retryHeld([s], r.io);
    s = (await r.store.get("t-j"))!;
  }
  ok(s.retry_attempts === MAX_ATTEMPTS, `held passes stop at ${MAX_ATTEMPTS}`, String(s.retry_attempts));
  ok(r.judgeCalls() === MAX_ATTEMPTS, "so the model was asked that many times and no more", String(r.judgeCalls()));
  ok(s.retry_pending === "venue-judge" && s.needs_human === true && r.creates() === 0, "still held, still flagged, still nothing booked");

  console.log("\n[3] once the judge answers, the next re-run books it");
  {
    __resetListCache();
    const q = rig("Savoy Place, on the Strand");
    const h = await handleThread({ thread_id: "t-k", messages: [q.book] }, q.deps);
    q.judgeBack();
    await retryHeld([h], q.io);
    const after = (await q.store.get("t-k"))!;
    ok(q.creates() === 1 && !after.retry_pending && after.retry_attempts === undefined, "booked, and no longer held",
      `creates=${q.creates()} retry=${after.retry_pending} attempts=${after.retry_attempts}`);
  }

  console.log("\n[4] judge down but postcode and name match exactly: books");
  {
    __resetListCache();
    const q = rig("2 Savoy Place London WC2R 0BL");
    const st = await handleThread({ thread_id: "t-x", messages: [q.book] }, q.deps);
    ok(q.creates() === 1 && !st.retry_pending, "an exact match is not held", `creates=${q.creates()} retry=${st.retry_pending}`);
    ok(st.place_id === 88, "and it is the building the client named", String(st.place_id));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
