// ============================================================================
// A 201 is not a booking. OnSinch's own audit row says what the call made.
// ----------------------------------------------------------------------------
// The engine recorded "ordered" on the strength of a status code for its whole
// life, which is how 99 orders were written blockless across five days while
// every check passed. OnSinch publishes an independent record of what each API
// create produced - `order_created_via_api`, carrying created.SlotTeam and
// created.Slot - and that is vendor-authored evidence rather than our own.
//
// Measured on live data: order 15610 sent six blocks and its audit row reads
// SlotTeam 6, Slot 6. The blockless creates read 0 and 0.
//
// Unverifiable is NOT the same as failed. The audit row can lag, and an order
// that exists must never be deleted because a log had not caught up - so an
// absent row is reported as unverified and handed on, never treated as absence
// of the order.
//
// Run: npx tsx test/verifyWrite.ts
// ============================================================================
import { verifyCreate } from "../app/lib/engine/verifyWrite";
import { OnsinchClient } from "../app/lib/engine/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

console.log("\n[1] the audit agreeing with intent is the only success");
{
  const v = verifyCreate({ teams: 6, slots: 6 }, 6);
  ok(v.verified, "six blocks sent, six recorded", JSON.stringify(v));
}

console.log("\n[2] a blockless create is a failure, whatever the status code was");
{
  const v = verifyCreate({ teams: 0, slots: 0 }, 6);
  ok(!v.verified, "refused");
  ok(/0 of 6|no crew/i.test(String(v.reason)), "and says what was missing", String(v.reason));
}

console.log("\n[3] a short create is a failure too - a partial order is not an order");
{
  const v = verifyCreate({ teams: 4, slots: 4 }, 6);
  ok(!v.verified, "four of six refused", JSON.stringify(v));
}

console.log("\n[4] an absent audit row is UNVERIFIED, not failed");
{
  const v = verifyCreate(null, 6);
  ok(!v.verified, "not claimed as verified");
  ok(/could not|unverified|no audit/i.test(String(v.reason)),
    "and says it could not be checked rather than that it failed", String(v.reason));
}

async function main() {
console.log("\n[5] the client reads the row for one order out of the log");
{
  // 250 rows in the log so limit=1 and limit=100 disagree about pageCount
  // (250 vs 3) - a probe at the wrong limit lands on a page that does not
  // exist at the read limit, and the real audit row is never seen. Placing
  // the matching row on the LAST page at limit=100 means only a probe that
  // also used limit=100 finds it.
  const TOTAL = 250;
  const audit = {
    id: 1, action: "order_created_via_api",
    data: JSON.stringify({
      id: "15610", name: "Innovate Events", model: "Order",
      created: { Order: 1, Job: 1, SlotTeam: 6, Slot: 6, Attendance: 0, workers: 24 },
      data: { path: "Order:15610", number: 10753 },
    }),
  };
  const client = new OnsinchClient((async (_m: string, path: string) => {
    if (path.startsWith("/timelineAudits")) {
      const q = new URL("http://x" + path).searchParams;
      const limit = Number(q.get("limit")) || 1;
      const page = Number(q.get("page")) || 1;
      const pageCount = Math.ceil(TOTAL / limit);
      const data = page === pageCount ? [audit] : [];
      return { status: 200, data: { data, pagination: { pageCount } } };
    }
    return { status: 200, data: { data: [], pagination: { pageCount: 1 } } };
  }) as never);
  const got = await client.createAuditFor(15610);
  ok(got?.teams === 6 && got?.slots === 6, "counts read from the payload", JSON.stringify(got));
  const miss = await client.createAuditFor(99999);
  ok(miss === null, "an order with no row returns null, not zero", JSON.stringify(miss));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
}

main();
