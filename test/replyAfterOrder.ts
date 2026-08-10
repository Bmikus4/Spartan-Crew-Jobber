// ============================================================================
// The reply is written AFTER the order, and knows what came of it.
// ----------------------------------------------------------------------------
// compile() used to compose the reply at step 2 and do the order work at step 3,
// so the reply was written knowing nothing about whether the booking could be
// made — and promised one either way. Live thread 19fadd4ff8152dea, a needs-info
// ticket whose company never resolved and which has no order at all, drafted
// "both dates are now booked in".
//
// Ben, 2026-08-09: "fix the commitment problem, compose the reply after the
// order... if there is missing information that impedes on the systems ability to
// create an order, then we should ask for it in our reply."
//
// The wording itself is the model's job and cannot be unit-tested. What CAN be
// tested is that the model is told the truth: this pins the ReplyContext the
// compiler hands it, because if that is wrong or absent the prompt has nothing to
// be honest with.
//
// Run: npx tsx test/replyAfterOrder.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { __resetListCache } from "../app/lib/engine/onsinch";
import { mockReasoner, mockTransport, msg, lastReplyContext, resetReplyContext } from "./mocks";
import type { HydratedThread } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const onsinch = new OnsinchClient(mockTransport);
const deps = { reasoner: mockReasoner, onsinch, now: () => 1, seededRateCard: async () => 197 };

const thread = (id: string, body: string): HydratedThread => ({
  thread_id: id,
  messages: [msg({ message_id: "m1", body })],
});

async function main() {

console.log("\n[1] a job that CAN be booked tells the writer it is staged, not confirmed");
{
  __resetListCache(); resetReplyContext();
  const { state } = await compile(thread("t-ok", "We need 6 crew on 12 August at ExCeL London, 08:00-18:00."), undefined, deps);
  ok(!!state.desired_order, "an order was composed", JSON.stringify(state.notes));
  ok(lastReplyContext?.order_state === "staged",
    "order_state = staged", String(lastReplyContext?.order_state));
  ok((lastReplyContext?.ask_for ?? []).length === 0,
    "and nothing is asked of the client, because nothing is missing", JSON.stringify(lastReplyContext?.ask_for));
}

console.log("\n[2] a job that CANNOT be booked says so, and names what to ask for");
{
  __resetListCache(); resetReplyContext();
  // No crew size anywhere: the extractor returns requests with size undefined, so
  // no slot team can be built and no order exists.
  const noSize = {
    ...mockReasoner,
    async extractFacts(l: never, h: never) {
      const f = await mockReasoner.extractFacts(l, h);
      return { ...f, requests: [{ date: "2026-08-12", task: "Exhibition stand build" }] };
    },
  };
  // The body has to read as a job to the mock classifier ("booking"), or this
  // tests the not-a-job path instead of the blocked one.
  const { state, actions } = await compile(
    thread("t-nosize", "Making a booking for crew on 12 August at ExCeL London please."),
    undefined,
    { ...deps, reasoner: noSize as never }
  );
  ok(!actions.createOrder, "no order is staged");
  ok(state.needs_human === true, "a human is called");
  ok(lastReplyContext?.order_state === "blocked",
    "order_state = blocked - the reply must not claim a booking", String(lastReplyContext?.order_state));
  const asks = lastReplyContext?.ask_for ?? [];
  ok(asks.some((a) => /how many crew/i.test(a)), "it asks for the crew count", JSON.stringify(asks));
  ok(asks.some((a) => /start and finish/i.test(a)), "and the times");
}

console.log("\n[3] the client is NEVER asked who they are, or what to charge them");
{
  __resetListCache(); resetReplyContext();
  // A brand-new company blocks on the rate card, which is the most tempting thing
  // to ask about and the most absurd.
  // The sender must also be at a domain OnSinch holds no contact for. The mock
  // tenant's one company carries pier@redbeast.co.uk, and resolveCompany now falls
  // back to the sender's domain when the NAME does not match - so with the shared
  // fixture address this resolves to that company and never reaches the new-client
  // path at all. That is the domain matcher working, not a failure.
  const newCo = {
    ...mockReasoner,
    async extractFacts(l: never, h: never) {
      const f = await mockReasoner.extractFacts(l, h);
      return { ...f, company_name: "A Company OnSinch Has Never Heard Of", contact_email: "someone@never-heard-of.example" };
    },
  };
  const { state } = await compile(
    {
      thread_id: "t-newco",
      messages: [msg({
        message_id: "m1",
        from: "someone@never-heard-of.example",
        body: "We need 6 crew on 12 August at ExCeL London, 08:00-18:00.",
      })],
    },
    undefined,
    { ...deps, reasoner: newCo as never, seededRateCard: async () => null }
  );
  const asks = lastReplyContext?.ask_for ?? [];
  ok(!asks.some((a) => /compan|who you|your name/i.test(a)),
    "never asks the client to identify their own company", JSON.stringify(asks));
  ok(!asks.some((a) => /rate|price|charge|cost/i.test(a)),
    "never asks the client what to charge them", JSON.stringify(asks));
  ok((state.notes ?? []).some((n) => /rate card/i.test(n)),
    "the rate card is still recorded as the blocker, for a human");
}

console.log("\n[4] a thread with nothing to book gets no booking talk at all");
{
  __resetListCache(); resetReplyContext();
  const { state } = await compile(thread("t-chat", "Thanks, speak soon."), undefined, deps);
  ok(state.classification === "not-a-job", "classified not-a-job", state.classification);
  ok(lastReplyContext?.order_state === "not-a-job",
    "order_state = not-a-job", String(lastReplyContext?.order_state));
  ok((lastReplyContext?.ask_for ?? []).length === 0, "and nothing is asked for");
}

console.log("\n[5] the context reaches the writer at all");
{
  // The whole fix depends on this argument being passed. deps.ts and tiered.ts
  // forward composeReply with a spread, which is why they did not have to change -
  // but a future hand-written wrapper could drop it exactly as one dropped
  // classifyAndExtract, and this is the assertion that would catch it.
  __resetListCache(); resetReplyContext();
  await compile(thread("t-ctx", "We need 6 crew on 12 August at ExCeL London, 08:00-18:00."), undefined, deps);
  ok(lastReplyContext !== null, "composeReply received a ReplyContext, not undefined");
}

console.log("\n[6] reply_scope decides WHICH threads get one");
{
  // Ben, 2026-08-09: "make it a settings thing, to toggle between send to all or
  // send to new enquiries only." Over a 10-thread sample across all
  // classifications, 7 were confirmation-only or not-a-job and produced correct
  // but low-value drafts. "all" is the default he chose; this is the other half.
  __resetListCache(); resetReplyContext();
  const chat = thread("t-scope-chat", "Thanks, speak soon.");

  const all = await compile(chat, undefined, { ...deps, replyScope: "all" });
  ok(!!all.state.reply_body_html, "scope=all replies to a not-a-job thread");

  __resetListCache(); resetReplyContext();
  const enq = await compile(chat, undefined, { ...deps, replyScope: "enquiries" });
  ok(!enq.state.reply_body_html, "scope=enquiries does not");
  ok(!enq.actions.createReplyDraft, "and stages no draft");
  ok(lastReplyContext === null, "the model was never asked to write one - the call is saved too");

  // A real request still gets a reply under either scope.
  __resetListCache(); resetReplyContext();
  const job = await compile(
    thread("t-scope-job", "We need 6 crew on 12 August at ExCeL London, 08:00-18:00."),
    undefined,
    { ...deps, replyScope: "enquiries" }
  );
  ok(!!job.state.reply_body_html, "a crew request is replied to under scope=enquiries");
  ok(!!job.actions.createReplyDraft, "and the draft is staged");

  // The classification it keys on is the OVERRULED one, so a thread the classifier
  // called junk but which carries a dated crew request is still answered. Gating on
  // the raw verdict would reintroduce the miss that overrule exists to fix.
  __resetListCache(); resetReplyContext();
  const overruled = {
    ...mockReasoner,
    async classify() { return { classification: "not-a-job" as const, priority: "low" as const, job_summary: "N/A - nothing here" }; },
  };
  const rescued = await compile(
    thread("t-scope-overruled", "We need 6 crew on 12 August at ExCeL London, 08:00-18:00."),
    undefined,
    { ...deps, reasoner: overruled as never, replyScope: "enquiries" }
  );
  ok(rescued.state.classification === "new-job", "the extractor overruled the classifier", rescued.state.classification);
  ok(!!rescued.state.reply_body_html, "and the rescued thread is still replied to");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
