// ============================================================================
// A follow-up that changes nothing leaves a booking at a created venue alone.
// ----------------------------------------------------------------------------
// When the tenant does not hold the venue, the composed order carries place_id 0 and
// an instruction to create it, and the real id only exists after the post. The thread
// used to fingerprint that pre-write shape. The next email composed against a tenant
// that now held the venue, the fingerprints differed, and a PO-only reply DELETED the
// order and re-posted it under a new R number (audit #1, scenario S9; about 24% of
// composed orders create a venue).
//
// Offline. No model, no network.  npx tsx test/createdVenueFollowUp.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { createOrderWithPlace } from "../app/lib/deps";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// A tenant that holds no venues until the engine creates one.
const places: Array<{ id: number; name: string; address?: string }> = [];
const wire: string[] = [];
const transport: Transport = async (method, path, body) => {
  wire.push(`${method} ${path.split("?")[0]}`);
  if (method === "POST" && path === "/places") {
    const p = (body as Array<{ name: string; address?: string }>)[0];
    const row = { id: 777 + places.length, ...p };
    places.push(row);
    return { status: 201, data: { data: [{ id: row.id }] } };
  }
  if (method === "GET" && path.startsWith("/places"))
    return { status: 200, data: { data: places, pagination: { count: places.length, pageCount: 1, nextPage: false } } };
  return mockTransport(method, path, body);
};
const onsinch = new OnsinchClient(transport);

const BOOKING = "Please book 4 crew on 9 March 08:00-18:00 at The Glass House, 1 Nowhere Road, London N1 1AA. Pier, RedBeast Energy";
const FACTS: ConversationFacts = {
  company_name: "RedBeast Energy",
  contact_email: "pier@redbeast.co.uk",
  location_text: "The Glass House, 1 Nowhere Road, London N1 1AA",
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "18:00", size: 4, task: "Stand build" }],
};
const reasoner: Reasoner = {
  async classifyAndExtract(latest) {
    const po = /PO (\d+)/.exec(latest.body)?.[1];
    return {
      classification: po ? "update" : "new-job", priority: "medium", job_summary: "crew request",
      facts: { ...FACTS, ...(po ? { customer_reference: po } : {}) },
    } as ClassifyResult & { facts: ConversationFacts };
  },
  async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "medium", job_summary: "x" }; },
  async extractFacts() { return FACTS; },
  async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
};

const rebuilds: number[] = [];
const executor: Executor = {
  async createReplyDraft() { return "draft"; },
  async createOrder(order) { return createOrderWithPlace(onsinch, order); },
  async patchOrder() { return []; },
  async replaceOrder(p) { rebuilds.push(p.order_id); return { deleted: false, refused: "test: a rebuild is the failure" }; },
};
const store = new InMemoryStore();
let clock = Date.parse("2026-03-01T09:00:00Z");
const deps: PipelineDeps = {
  reasoner, onsinch, store, executor,
  now: () => ++clock,
  metrics: new InMemoryMetrics(),
  settings: { ...DEFAULT_SETTINGS },
  hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
};

async function main() {
  const first = msg({ message_id: "v1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: BOOKING });

  console.log("\n[1] the booking creates the venue and records the id it got");
  const s1 = await handleThread({ thread_id: "t-venue", messages: [first] }, deps);
  const created = places.length;
  ok(Number(s1.onsinch_order_id) === 9001, "the order is written", String(s1.onsinch_order_id));
  ok(created === 1, "one venue created for it", JSON.stringify(places));
  ok((s1.last_ordered_teams ?? []).length > 0 && (s1.last_ordered_teams ?? []).every((t) => t.place_id === places[0]?.id),
    "the thread records the venue's real id, never 0", JSON.stringify((s1.last_ordered_teams ?? []).map((t) => t.place_id)));
  ok(s1.place_id === places[0]?.id, "and holds it as the thread's venue", String(s1.place_id));

  console.log("\n[2] a PO-only follow-up leaves the order where it is");
  const second = msg({ message_id: "v2", date_iso: "2026-03-02T09:00:00Z", subject: "Re: Crew", body: "Our PO 5521 for this one." });
  const s2 = await handleThread({ thread_id: "t-venue", messages: [first, second] }, deps);
  ok(rebuilds.length === 0, "no rebuild is attempted", JSON.stringify(rebuilds));
  ok(!wire.some((w) => w.startsWith("DELETE")), "nothing is deleted", wire.filter((w) => w.startsWith("DELETE")).join(","));
  ok(Number(s2.onsinch_order_id) === 9001, "the thread keeps its order and R number", String(s2.onsinch_order_id));
  ok(places.length === created, "and no second venue is created", String(places.length));

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
