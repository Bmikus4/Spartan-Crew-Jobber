// ============================================================================
// Rebuilding an order that OPS raised, and keeping the record of what was destroyed.
//
// Ben, 2026-08-18, two rulings that pull against each other and both have to hold:
//   Q7(b)  an amendment rebuilds an ops-raised DRAFT too — custody is no longer a gate
//   Q2     a CONFIRMED order is never touched, whoever raised it
// So `provisional` now carries the whole guarantee on its own.
//
// Q12 is what makes Q7(b) survivable: rebuilding an ops draft from the engine's own
// idea of the order would hand it back correct in crew and blank in every field a
// person typed. The live order is read first and its values carried onto the
// replacement, and anything a rebuild cannot preserve refuses rather than dropping it.
//
// Run: npx tsx test/orderArchive.ts
// ============================================================================
import { carryForward } from "../app/lib/engine/replaceOrder";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const desired = (over: Partial<DesiredOrder> = {}): DesiredOrder =>
  ({
    name: "Event Concept @ Tobacco Dock", company_id: 501, user_id: 7,
    request_approval: true, provisional: true, quote: false,
    pricelist_category_id: 342, job_name: "job",
    slot_teams: [{ name: "Crew", profession_id: 1, beginning: "2026-03-09T08:00:00+00:00", end: "2026-03-09T18:00:00+00:00", size: 4, place_id: 88 }],
    ...over,
  }) as DesiredOrder;

console.log("\n[1] what ops typed survives the rebuild");
{
  const live = {
    id: 13632, provisional: true, company_id: 501,
    order_manager_id: 102, agency_invoice_address_id: 55, reverse_charge: true,
    intern_name: "PO-9911", specification: "load in via the north gate, ask for Dave",
  };
  const { desired: out, carried, unsupported } = carryForward(live, desired());
  ok((out as any).order_manager_id === 102, "the order manager is kept", String((out as any).order_manager_id));
  ok((out as any).intern_name === "PO-9911", "the PO is kept", String((out as any).intern_name));
  ok(/north gate/.test(String((out as any).specification)), "and the note somebody wrote by hand");
  ok(carried.length === 5, "all five carried", carried.join(","));
  ok(unsupported.length === 0, "nothing blocks the rebuild");
}

console.log("\n[2] the amendment still wins where it actually said something");
{
  // The client's newest email is the newer truth. Carry-forward fills gaps; it must
  // never overwrite what the engine just read out of the thread.
  const live = { id: 13632, provisional: true, company_id: 501, intern_name: "PO-OLD", specification: "old note" };
  const { desired: out } = carryForward(live, desired({ intern_name: "PO-NEW" } as Partial<DesiredOrder>));
  ok((out as any).intern_name === "PO-NEW", "the new PO wins", String((out as any).intern_name));
  ok((out as any).specification === "old note", "but a field the email said nothing about is still carried");
}

console.log("\n[3] an empty value on the live order is not 'something ops typed'");
{
  const live = { id: 13632, provisional: true, company_id: 501, intern_name: "", specification: null, order_manager_id: 0 };
  const { desired: out, carried } = carryForward(live, desired());
  ok(!carried.includes("intern_name"), "an empty string is not carried");
  ok(!carried.includes("specification"), "nor a null");
  ok((out as any).order_manager_id === undefined, "nor a zero, which is not an id", String((out as any).order_manager_id));
}

console.log("\n[4] what a rebuild CANNOT preserve stops it");
{
  // DELETE /orders cascades. An attachment somebody uploaded is not recreatable from
  // anything the engine holds, so the order is left alone rather than quietly stripped.
  const live = { id: 13632, provisional: true, company_id: 501, Attachment: [{ id: 9, name: "site-plan.pdf" }] };
  const { unsupported } = carryForward(live, desired());
  ok(unsupported.length === 1 && /attachment/.test(unsupported[0]), "an attachment is reported as unsupported",
    unsupported.join(","));
  const none = carryForward({ id: 13632, provisional: true, Attachment: [] }, desired());
  ok(none.unsupported.length === 0, "an empty attachment list is not a blocker");
}

console.log("\n[5] the engine's own orders are unaffected by any of it");
{
  // Nothing but crew was ever on them, so there is nothing to carry and nothing to
  // block — the ops case must not make the common case refuse.
  const live = { id: 13632, provisional: true, company_id: 501 };
  const { carried, unsupported } = carryForward(live, desired());
  ok(carried.length === 0 && unsupported.length === 0, "nothing carried, nothing blocked",
    `${carried.length}/${unsupported.length}`);
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
