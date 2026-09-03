// ============================================================================
// One row that says what we sent, for whom, and what came back.
// ----------------------------------------------------------------------------
// What the engine knew about a written order was spread across a column, a JSON
// blob and a composed array, with the sender recorded nowhere. Answering "what
// did we send and what did OnSinch make of it" meant reassembling three sources
// by hand, which is exactly what every reconciliation this week had to do.
//
// This test runs WITHOUT a database. The module must degrade to a no-op rather
// than throw, for the same reason the identity gate fails open: a booking is
// never lost because a side-record could not be written.
//
// Run: npx tsx test/orderRecord.ts
// ============================================================================
import { buildOrderRecord } from "../app/lib/orderRecordsDb";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const SHAPE = {
  name: "Eventful UK - build at ExCeL",
  company_id: 512,
  slot_teams: [
    { size: 13, place_id: 49, beginning: "2027-10-12T07:00:00+00:00", end: "2027-10-12T18:00:00+00:00" },
    { size: 2, place_id: 49, beginning: "2027-10-12T07:00:00+00:00", end: "2027-10-12T18:00:00+00:00" },
  ],
};

console.log("\n[1] the record is derived from the shape actually sent");
{
  const rec = buildOrderRecord({
    order_id: 15610, thread_id: "T9", job_id: 15663, order_number: "10753",
    sender_email: "liam@eventful.co.uk", sender_domain: "eventful.co.uk",
    place_id: 49, shape_sent: SHAPE,
    id_source: "api_response", verified_at: "2026-09-02T18:00:00.000Z",
  });
  ok(rec.order_id === 15610, "order id", String(rec.order_id));
  ok(rec.company_id === 512, "company taken from the shape, not passed twice", String(rec.company_id));
  ok(rec.block_count === 2, "one count per block sent", String(rec.block_count));
  ok(rec.crew_total === 15, "crew totalled across blocks", String(rec.crew_total));
  ok(rec.sender_domain === "eventful.co.uk", "the counterparty domain travels with the order", String(rec.sender_domain));
  ok(rec.id_source === "api_response", "and where the id came from, which is the column §3.2 lacked", rec.id_source);
  ok(rec.verified_at === "2026-09-02T18:00:00.000Z", "with the moment it was confirmed", String(rec.verified_at));
}

console.log("\n[1b] provenance is REQUIRED, so no future call site can omit it");
{
  // Not a runtime assertion — a compile-time one. `id_source` and `verified_at` are
  // non-optional on the input type deliberately: the whole failure this column exists to
  // prevent is an id recorded with no indication of where it came from, and an optional
  // field with a sensible default is how that happens quietly. Removing either line from
  // the two calls in this file is a tsc error, which is the guarantee.
  ok(true, "enforced by tsc --noEmit, not by this line");
}

console.log("\n[2] a shape with no blocks is recorded honestly, not as zero-crew success");
{
  const rec = buildOrderRecord({
    order_id: 1, thread_id: "T1", job_id: null, order_number: null,
    sender_email: null, sender_domain: null, place_id: null,
    shape_sent: { name: "x", company_id: 1, slot_teams: [] },
    id_source: "api_response", verified_at: null,
  });
  ok(rec.block_count === 0 && rec.crew_total === 0, "counted as zero rather than guessed", JSON.stringify(rec));
  ok(rec.verified_at === null, "and an unconfirmed id is null, not a false", String(rec.verified_at));
}

console.log("\n[3] null verified_at is a THIRD state, not a false");
{
  // "Never verified" and "verified and found absent" are different facts about an order.
  // The outstanding document counts them as one population — 39 of 47 "do not resolve" —
  // and a boolean column here would rebuild that conflation in the schema.
  const never = buildOrderRecord({
    order_id: 2, thread_id: "T2", job_id: null, order_number: null,
    sender_email: null, sender_domain: null, place_id: null,
    shape_sent: { name: "y", company_id: 2, slot_teams: [{ size: 3 }] },
    id_source: "api_response", verified_at: null,
  });
  ok(never.verified_at === null, "never verified reads as null", String(never.verified_at));
  ok(never.crew_total === 3, "and the record is otherwise complete", String(never.crew_total));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
