// ============================================================================
// An order this engine built says so, in the field for saying so.
//
// Spartan could not tell an AI-built job from a hand-built one at a glance. The
// order's `creator` was already right — 2257 on every engine order against 2620 or
// 413 on a human's — but the name they read in the list is the order's CONTACT.
// On the TEST company that is "Alexa Accs", accounts@spartancrew.co.uk, which the
// engine fell back to because the sender is unknown to OnSinch; on a real enquiry
// it is the client's own contact. Neither says anything about who built the job.
//
// `order_manager_id` is the field for that and it was null on every order this
// engine has ever made. Ben, 2026-08-25: fill it, leave the contact alone.
//
// The CONTACT is the property this file mostly exists to protect. It is who the
// booking is FOR, and an order without one cannot be posted at all.
//
// Run: npx tsx test/orderManager.ts
// ============================================================================
import { composeOrder } from "../app/lib/engine/compose";
import { buildOrderBody } from "../app/lib/engine/format";
import { carryForward } from "../app/lib/engine/replaceOrder";
import type { ConversationFacts, DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const facts: ConversationFacts = {
  location_text: "Olympia London",
  requests: [{ date: "2027-03-01", start_time: "08:00", end_time: "16:00", size: 4 }],
};
const compose = (order_manager_id?: number) =>
  composeOrder({
    facts, company_id: 515, user_id: 1591, place_id: 57, pricelist_category_id: 197,
    orderName: "Crew for Olympia", jobName: "4 at Olympia London on 2027-03-01",
    order_manager_id,
  }).order!;

console.log("\n[1] the manager reaches the OnSinch body");
{
  const body = buildOrderBody(compose(2257))[0];
  ok(body.order_manager_id === 2257, "order_manager_id is sent", String(body.order_manager_id));
  ok(body.user_id === 1591, "and the CONTACT is untouched — it is who the booking is for", String(body.user_id));
}

console.log("\n[2] no manager, no field — an unset id is never sent as 0 or null");
{
  const body = buildOrderBody(compose(undefined))[0];
  ok(!("order_manager_id" in body), "the key is absent, not empty");
  ok(body.user_id === 1591, "contact still set");
}

console.log("\n[3] a human who takes the job over KEEPS it through a rebuild");
{
  // The stamp is a default, not a reading of the email. A rebuild that put SamurAI
  // back over a name somebody chose would quietly hand the job to nobody.
  const desired = compose(2257) as DesiredOrder;
  const live = { order_manager_id: 413, intern_name: "PO-9", reverse_charge: false };
  const { desired: out, carried } = carryForward(live, desired);
  ok(out.order_manager_id === 413, "Tracy keeps it, not SamurAI", String(out.order_manager_id));
  ok(carried.includes("order_manager_id"), "and it is reported as carried");
  ok(out.intern_name === "PO-9", "the other carried fields still carry");
}

console.log("\n[4] an order nobody has taken over keeps the stamp");
{
  const desired = compose(2257) as DesiredOrder;
  const { desired: out } = carryForward({ order_manager_id: null }, desired);
  ok(out.order_manager_id === 2257, "still SamurAI", String(out.order_manager_id));
  // OnSinch's own emptiness is not somebody's intent: 0 is not a manager.
  const { desired: zero } = carryForward({ order_manager_id: 0 }, compose(2257) as DesiredOrder);
  ok(zero.order_manager_id === 2257, "and a 0 on the live order is not a takeover either", String(zero.order_manager_id));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
