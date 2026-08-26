// ============================================================================
// The posture every order this engine creates is written in.
// ----------------------------------------------------------------------------
// THE ENGINE SENDS NEITHER `provisional` NOR `quote`, AND THAT IS THE POINT.
//
// This test used to assert the opposite — `provisional: true, quote: false` — on
// the reasoning that `provisional` carried the draft and would land the order in
// To Confirm. Its own header admitted it could not prove that: "Nothing in the
// OnSinch API describes the tabs ... The next order the engine creates confirms or
// refutes it in one glance at the OnSinch board."
//
// It was refuted. Ben, 2026-08-25: "im not seeing any jobs appear ... in Orders to
// Confirm." An order carrying `provisional: true` is filed as PROVISIONAL and never
// reaches To Confirm, so every order this engine ever raised was invisible to the
// people meant to action it.
//
// What settled it, in order:
//   1. Ben raised order 14868 by hand in the UI. It read back provisional=false,
//      quote=false, request_approval="1".
//   2. He supplied the exact create body the UI sends. It carries `request_approval`
//      and Job/SlotTeam — and NEITHER `provisional` NOR `quote`.
//   3. Orders 14869 and 14870 were posted to TEST 515 omitting both. Both read back
//      provisional=false, quote=false, status=0, and Ben confirmed both appeared in
//      To Confirm.
//
// So OnSinch's defaults ARE the wanted posture and the engine must not overwrite
// them. Note the deliberate asymmetry with the rate card: 14869 was posted without
// one and drifted to card 341 instead of the house 315, which is exactly the silent
// default I1 exists to prevent. Omission is right here and wrong there, because
// OnSinch's default posture is what Spartan wants and its default rate card is not.
//
// Run: npx tsx test/draftPosture.ts
// ============================================================================
import { composeOrder } from "../app/lib/engine/compose";
import { buildOrderBody } from "../app/lib/engine/format";
import type { ConversationFacts } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const facts: ConversationFacts = {
  company_name: "Event Concept",
  location_text: "Tobacco Dock, London",
  requests: [{ date: "2026-09-12", size: 4, start_time: "08:00", end_time: "18:00", task: "Local crew" }],
};

const composed = composeOrder({
  facts,
  company_id: 501,
  user_id: 9001,
  place_id: 304,
  pricelist_category_id: 197,
  orderName: "Event Concept @ Tobacco Dock",
  jobName: "4 at Tobacco Dock on 2026-09-12",
});

console.log("\n[1] compose leaves the posture to OnSinch");
{
  const o = composed.order! as unknown as Record<string, unknown>;
  ok(!("provisional" in o), "provisional is not set — setting it true is what hid the orders");
  ok(!("quote" in o), "quote is not set either");
  ok(o.request_approval === true, "request_approval IS set — Ben's own hand-raised body carries it");
}

console.log("\n[2] and neither reaches the wire");
{
  const [body] = buildOrderBody(composed.order!);
  const b = body as unknown as Record<string, unknown>;
  ok(!("provisional" in b), "provisional is absent from the create body");
  ok(!("quote" in b), "quote is absent from the create body");
  ok(b.request_approval === true, "request_approval reaches the wire");
}

console.log("\n[3] the rate card is still explicit — the asymmetry is deliberate");
{
  const [body] = buildOrderBody(composed.order!);
  ok(body.Job.pricelist_category_id === 197,
    "the card is stated, never left to OnSinch's default (I1)",
    String(body.Job.pricelist_category_id));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
