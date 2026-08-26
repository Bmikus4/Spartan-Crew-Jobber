// ============================================================================
// The n8n -> engine seam, proven end to end without n8n and without a credential.
//
// Runs the REAL n8n Code node body (n8n/nodes/build-engine-payload.js) against a
// realistic Gmail thread, feeds its exact output through the REAL intake coercion,
// and then through the REAL pipeline. If this passes, the only thing standing
// between a client email and a staged OnSinch draft order is the disconnected
// Gmail credential.
//
// Run: npx tsx test/seam.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { coerceThread } from "../app/lib/engine/intake";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import { mockReasoner, mockTransport } from "./mocks";

let fails = 0;
const assert = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// ---------------------------------------------------------------- the node body
const nodeSrc = readFileSync(join(process.cwd(), "n8n", "nodes", "build-engine-payload.js"), "utf8");

function runNodeBody(nodes: Record<string, unknown>, json: Record<string, unknown>): { json: Record<string, unknown> }[] {
  const $ = (name: string) => {
    if (!(name in nodes)) throw new Error(`no node "${name}"`);
    const v = nodes[name];
    const list = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
    return { item: { json: list[0] }, all: () => list.map((j) => ({ json: j })) };
  };
  const fn = new Function("$", "$json", "Buffer", nodeSrc) as (
    $: unknown, $json: unknown, Buffer: unknown
  ) => { json: Record<string, unknown> }[];
  return fn($, json, Buffer);
}

const b64 = (s: string) =>
  Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A real-shaped client enquiry that must produce a draft order.
const gmailThread = {
  id: "thr_seam_1",
  messages: [
    {
      id: "msg_seam_1",
      internalDate: "1786000000000",
      payload: {
        headers: [
          { name: "From", value: "Jane Doe <jane@bigevents.com>" },
          { name: "To", value: "bookings@spartancrew.co.uk" },
          { name: "Subject", value: "Crew required 12 August - ExCeL London" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: b64(
                "Hello,\n\nWe need 6 crew at ExCeL London on 12 August 2026, 08:00 to 18:00, for an exhibition build.\n\nBest,\nJane Doe\nBig Events Ltd\n07700 900123"
              ),
            },
          },
        ],
      },
    },
  ],
};

const normalizeData = {
  original_email: {
    email_id: "msg_seam_1",
    thread_id: "thr_seam_1",
    from: "jane@bigevents.com",
    subject: "Crew required 12 August - ExCeL London",
    body: "We need 6 crew at ExCeL London on 12 August 2026, 08:00 to 18:00, for an exhibition build.",
  },
  thread_history: { messages: [] },
};

// ---------------------------------------------------------------- 1. node output
console.log("\n[1] n8n Code node emits the engine contract");
const emitted = runNodeBody(
  {
    "Normalize Data": normalizeData,
    "Get a thread2": gmailThread,
    "Conversational Renderer": { client_information: { name: "Jane Doe" }, metadata: { render_hash: "h1" } },
    "Determine if Order": { message: { content: '{"is_order":true}' } },
    Merge1: [],
  },
  { found: false, thread_first_seen: true, thread_message_count: 1 }
);
const payload = emitted[0].json;
assert(emitted.length === 1, "one item emitted");
assert(typeof payload.thread_id === "string" && payload.thread_id === "thr_seam_1", "thread_id", String(payload.thread_id));
assert(Array.isArray(payload.messages) && (payload.messages as unknown[]).length === 1, "one message");

// ---------------------------------------------------------------- 2. the seam
console.log("\n[2] intake accepts that payload verbatim (the seam)");
// Round-trip through JSON exactly as the HTTP hop would.
const overWire = JSON.parse(JSON.stringify(payload));
const thread = coerceThread(overWire);
assert(thread !== null, "coerceThread accepted it (NOT parked in inbound_raw)");
assert(thread?.thread_id === "thr_seam_1", "thread_id survived", thread?.thread_id);
assert(thread?.messages.length === 1, "message count survived", String(thread?.messages.length));
assert(thread?.messages[0].from === "jane@bigevents.com", "from survived", thread?.messages[0].from);
assert(/6 crew at ExCeL/.test(thread?.messages[0].body ?? ""), "body survived");
assert(thread?.messages[0].is_from_spartan === false, "client not flagged as spartan");

// ---------------------------------------------------------------- 3. pipeline
console.log("\n[3] the pipeline turns it into a staged draft order");
let clock = 1_786_000_000_000;
const onsinch = new OnsinchClient(mockTransport);
const store = new InMemoryStore();
const executor: Executor = {
  async createReplyDraft() { return "draft-seam"; },
  async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
  async patchOrder(p) { await onsinch.patchOrder([{ id: p.order_id }]); },
};
const deps: PipelineDeps = {
  reasoner: mockReasoner,
  onsinch,
  now: () => ++clock,
  store,
  metrics: new InMemoryMetrics(),
  executor,
  settings: { ...DEFAULT_SETTINGS }, // replies off — launch defaults
  hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
};

async function main() {
const state = await handleThread(thread!, deps);
assert(state.thread_id === "thr_seam_1", "state keyed on the thread", state.thread_id);
assert(state.classification === "new-job", "classified new-job", state.classification);
// Ben, Q1: the order reaches OnSinch as To Confirm on the spot; the staging queue
// is the record, not a gate.
assert(state.onsinch_order_id != null, "an order was WRITTEN to OnSinch");
assert(state.status === "ordered", "status ordered", state.status);
assert(state.pending_order == null, "nothing left holding in the queue");
assert((state.desired_order?.slot_teams.length ?? 0) > 0, "the order has slot teams");
assert(!("provisional" in (state.desired_order ?? {})), "provisional is not set -> it IS a To Confirm order");

// ---------------------------------------------------------------- 4. idempotent
console.log("\n[4] the same payload again changes nothing (exactly-once)");
const again = await handleThread(coerceThread(JSON.parse(JSON.stringify(payload)))!, deps);
assert(again.thread_id === state.thread_id, "same state row, not a second one");
assert((await store.all()).length === 1, "one row in the store, not two");
assert(again.order_action_log.length === state.order_action_log.length, "no extra order action");

// ---------------------------------------------------------------- 5. junk
console.log("\n[5] an unrecognised payload is parked, never crashed on");
assert(coerceThread({ hello: "world" }) === null, "junk -> null (stored in inbound_raw)");
assert(coerceThread(null) === null, "null -> null");
assert(coerceThread({ thread_id: "t", messages: [] }) === null, "no usable messages -> null");
assert(
  coerceThread({ original_email: { email_id: "m", thread_id: "t", from: "a@b.com", body: "need 4 crew" } }) !== null,
  "the workflow's older single-email shape is still accepted"
);

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
