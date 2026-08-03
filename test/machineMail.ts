// ============================================================================
// Machine mail must never reach the order path.
// ----------------------------------------------------------------------------
// Measured on the 102 payloads the live workflow has delivered: 48 of them came
// from an address that is not a client writing to Spartan. The costly one is
// OnSinch's own notifier. Live thread 19fb8b3d094fa9a1 is "Client created new
// order" from no-reply@sinch.cz, and the engine staged a PATCH of OnSinch order
// 13642 built from it - renaming the order to the notification's subject,
// setting the rate card to 315 when the real job carries 342, and inventing
// 10:00-18:00 hours over a real 09:00-13:00 job. Confirming that would have
// corrupted a correct order using an email that only announced it existed.
//
// Offline. No model, no network.  npx tsx test/machineMail.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { isMachineSender, isAutoReply, selectLatest, normalizeThread } from "../app/lib/engine/normalize";
import { handleThread, type Executor } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type HydratedThread } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// Verbatim from live inbound_raw row 70 (thread 19fb8b3d094fa9a1).
const ONSINCH_NOTIFICATION = `Client created new order

Order:
Lock Warehouse Event - https://spartancrew.onsinch.com/admin/orders/view/10558

Company:
Just Smile Ltd - https://spartancrew.onsinch.com/admin/companies/view/401

Created by:
Crispian Robinson - https://spartancrew.onsinch.com/admin/clients/view/964

New job:
Lock Warehouse Event - https://spartancrew.onsinch.com/admin/jobs/view/13922

Job beginning:
Sat 8.8. 10:00

Number of shifts:
1

Staff amount:
2`;

async function main() {
console.log("1. sender classification");
for (const a of [
  "no-reply@sinch.cz",
  "noreply@handshq.com",
  "noreply@payments.crezco.com",
  "messaging-service@post.xero.com",
  "DoNotReply@someportal.com",
  "mailer-daemon@googlemail.com",
])
  ok(isMachineSender(a), `machine: ${a}`);
for (const a of [
  "natalie@wackerglobalevents.com",
  "kieron@presentcommunications.com",
  "bookings@spartancrew.co.uk",
  "replyto@client.com", // "reply", not "no-reply"
  "",
])
  ok(!isMachineSender(a), `not machine: ${a || "(empty)"}`);

console.log("2. out-of-office from a real person's address");
ok(isAutoReply("Automatic reply: Crew Quote", "I am away."), "subject form");
ok(isAutoReply("Re: Automatic reply: Crew", "x"), "subject behind a Re:");
ok(isAutoReply("Crew", "Thanks for your email, I'm out of the office until Monday."), "body form");
ok(!isAutoReply("Crew Quote", "Can I have 4 crew Sunday night?"), "a real enquiry is not an auto-reply");

console.log("3. an out-of-office does not hide the enquiry under it");
{
  const thread: HydratedThread = {
    thread_id: "t-ooo",
    messages: [
      msg({ message_id: "m1", date_iso: "2026-08-01T10:00:00Z", body: "Can I have 4 crew Sunday night at Brighton?" }),
      msg({ message_id: "m2", date_iso: "2026-08-01T11:00:00Z", subject: "Automatic reply: Crew", body: "I am on annual leave." }),
    ],
  };
  const { latest, machine } = normalizeThread(thread);
  ok(latest.message_id === "m1", "acts on the enquiry, not the auto-reply", latest.message_id);
  ok(!machine, "thread is not written off as machine mail");
}

console.log("4. the OnSinch notification composes no order");
{
  const thread: HydratedThread = {
    thread_id: "19fb8b3d094fa9a1",
    messages: [
      msg({
        message_id: "n1",
        from: "no-reply@sinch.cz",
        to: ["jenny@spartancrew.co.uk"],
        subject: "Client created new order",
        body: ONSINCH_NOTIFICATION,
      }),
    ],
  };
  const store = new InMemoryStore();
  const metrics = new InMemoryMetrics();
  const onsinch = new OnsinchClient(mockTransport);
  let modelCalls = 0;
  const counting = {
    classify: (...a: Parameters<typeof mockReasoner.classify>) => { modelCalls++; return mockReasoner.classify(...a); },
    extractFacts: (...a: Parameters<typeof mockReasoner.extractFacts>) => { modelCalls++; return mockReasoner.extractFacts(...a); },
    composeReply: (...a: Parameters<typeof mockReasoner.composeReply>) => { modelCalls++; return mockReasoner.composeReply(...a); },
  };
  const executor: Executor = {
    async createReplyDraft() { throw new Error("must not draft a reply to a notifier"); },
    async createOrder() { throw new Error("must not create an order from a notification"); },
    async patchOrder() { throw new Error("must not patch an order from a notification"); },
  };
  const state = await handleThread(thread, {
    reasoner: counting, onsinch, now: () => 1_700_000_000_000,
    store, metrics, executor, settings: { ...DEFAULT_SETTINGS, order_mode: "auto" }, hashOrder: JSON.stringify,
  });
  ok(state.classification === "not-a-job", "classified not-a-job", state.classification);
  ok(state.status === "ignored", "status ignored", state.status);
  ok(!state.desired_order, "no desired order");
  ok(!state.pending_order, "nothing staged for confirm");
  ok(modelCalls === 0, "no model calls spent", String(modelCalls));
  ok((await metrics.all()).some((e) => e.type === "filtered_out"), "counted as filtered_out, not a job");
}

console.log("5. prior linkage survives a notification arriving later");
{
  const store = new InMemoryStore();
  await store.put({
    thread_id: "t-link", subject: "Crew", participants: [], last_message_id: "old",
    last_processed_epoch: 1, classification: "new-job", facts: { requests: [] },
    company_id: 401, user_id: 964, onsinch_order_id: 13642, desired_order: null,
    priority: "high", needs_human: false, status: "ordered", notes: [], order_action_log: [],
  });
  const prior = await store.get("t-link");
  const { state } = await compile(
    { thread_id: "t-link", messages: [msg({ message_id: "n2", from: "no-reply@sinch.cz", subject: "Client created new order", body: ONSINCH_NOTIFICATION })] },
    prior,
    { reasoner: mockReasoner, onsinch: new OnsinchClient(mockTransport), now: () => 2 }
  );
  ok(state.onsinch_order_id === 13642, "order linkage kept", String(state.onsinch_order_id));
  ok(state.company_id === 401, "company kept", String(state.company_id));
  ok(state.status === "ignored", "still ignored", state.status);
}

console.log("6. the idempotency key and the compiler pick the same message");
{
  const messages = [
    msg({ message_id: "m1", date_iso: "2026-08-01T10:00:00Z", body: "4 crew Sunday please" }),
    msg({ message_id: "m2", date_iso: "2026-08-01T12:00:00Z", from: "bookings@spartancrew.co.uk", is_from_spartan: true, body: "On it." }),
    msg({ message_id: "m3", date_iso: "2026-08-01T13:00:00Z", from: "noreply@payments.crezco.com", subject: "Payment received", body: "A payment has been received." }),
  ];
  const picked = selectLatest(messages)!;
  const { latest } = normalizeThread({ thread_id: "t", messages });
  ok(picked.latest.message_id === "m1", "pipeline key skips both our reply and the notifier", picked.latest.message_id);
  ok(latest.message_id === picked.latest.message_id, "compiler agrees with the pipeline key");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
}

main();
