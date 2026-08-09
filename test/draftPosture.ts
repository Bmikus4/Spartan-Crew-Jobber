// ============================================================================
// The posture every order this engine creates is written in.
// ----------------------------------------------------------------------------
// Ben, 2026-08-09: "Jobs will be added to To Confirm instead of Price Quotes."
//
// `quote: true` was what filed them under Price Quotes. It is now false, and
// `provisional` alone carries the draft, so an order lands in the queue Spartan
// actually works from rather than in a pricing list nobody actions.
//
// Pinned rather than left as a literal in compose.ts because it is a business
// decision about where a client's job appears to the people who staff it, and
// because it used to be read back as an identity check — see the custody note in
// replaceOrder.ts for why that was never sound and no longer happens.
//
// THE ONE THING THIS CANNOT PROVE. Nothing in the OnSinch API describes the tabs;
// publicapi.json types both fields as bare booleans with no description, and
// there is no endpoint that names a queue. The mapping is inferred from what the
// live tenant does — of the 100 most recent orders, 27 are provisional-without-
// quote and 8 carry both — plus Ben's description of where the engine's orders
// have been landing. The next order the engine creates confirms or refutes it in
// one glance at the OnSinch board.
//
// Run: npx tsx test/draftPosture.ts
// ============================================================================
import { composeOrder } from "../app/lib/engine/compose";
import { buildOrderBody, DRAFT_POSTURE } from "../app/lib/engine/format";
import type { ConversationFacts } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
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

console.log("\n[1] a composed order is To Confirm, not a price quote");
{
  ok(composed.order!.provisional === true, "provisional is set - it is a draft awaiting confirmation");
  ok(composed.order!.quote === false, "quote is NOT set - this is what moved it out of Price Quotes",
    String(composed.order!.quote));
  ok(composed.order!.request_approval === true, "request_approval is unchanged");
}

console.log("\n[2] the posture survives serialisation to the OnSinch body");
{
  const [body] = buildOrderBody(composed.order!);
  ok(body.provisional === true, "provisional reaches the wire");
  ok(body.quote === false, "and quote reaches the wire as false, not omitted",
    JSON.stringify({ quote: body.quote, present: "quote" in body }));
  // Omitting it would let OnSinch apply its own default, which is the same class of
  // mistake as omitting the rate card (I1): a silent default nobody chose.
  ok("quote" in body, "the field is sent explicitly rather than left to a default");
}

console.log("\n[3] one definition, so the write path cannot drift");
{
  ok(DRAFT_POSTURE.provisional === composed.order!.provisional, "compose uses the shared constant (provisional)");
  ok(DRAFT_POSTURE.quote === composed.order!.quote, "compose uses the shared constant (quote)");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
