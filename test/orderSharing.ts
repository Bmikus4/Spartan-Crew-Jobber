// ============================================================================
// Several email threads may own the SAME OnSinch order.
// ----------------------------------------------------------------------------
// Ben, 2026-08-03: "both threads should own it, its the same job."
//
// A client raises one job and then emails about it more than once - a fresh
// thread for the crew change, another for the invoice query. Order dedup matches
// on company + happening date, so all of those correctly resolve to one order.
// That is right: there is one job, so there should be one order.
//
// tickets carried a UNIQUE index on onsinch_order_id, which enforced one TICKET
// per ORDER and so refused the second thread's link. Live: 19fb8a6d756a916b lost
// to 19fb421845dd47b4 over order 13639 and ended up with no ticket at all.
//
// Note the index never matched its own comment - "a second draft order can never
// link to the same ticket twice" is the reverse relation, and is enforced anyway
// by thread_id being the primary key. The invariant that actually matters, never
// CREATE a duplicate order for one job, lives in resolve.matchExistingOrder and
// is untouched by this.
//
// Runs against the real database with tagged rows, and removes them.
//
// Run: npx tsx test/orderSharing.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { upsertTicketFromState } from "../app/lib/ticketsDb";
import type { ConversationState } from "../app/lib/engine/types";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `sharetest-${process.pid}`;
const ORDER = 99987654; // not a real order id

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const threadOn = (id: string, subject: string): ConversationState => ({
  thread_id: id,
  subject,
  participants: ["sam.crowe@presentcommunications.com"],
  last_message_id: `${id}-m1`,
  last_processed_epoch: Date.now(),
  classification: "update",
  facts: { requests: [{ date: "2026-08-03", size: 2 }] },
  company_id: 723,
  onsinch_order_id: ORDER,
  onsinch_order_number: String(ORDER),
  desired_order: null,
  priority: "medium",
  needs_human: false,
  status: "drafted",
  notes: [],
  order_action_log: [],
});

async function main() {
  const a = `${TAG}-first`;
  const b = `${TAG}-second`;

  console.log("\n[1] two threads about the same job both keep the order link");
  await upsertTicketFromState(threadOn(a, "Presser Monday 3rd August"));
  await upsertTicketFromState(threadOn(b, "RE: Presser — crew change"));

  const rows = (await sql`
    SELECT thread_id, onsinch_order_id, needs_human, notes
    FROM tickets WHERE thread_id LIKE ${TAG + "%"} ORDER BY thread_id`) as any[];
  console.log(`      tickets: ${rows.map((r) => `${r.thread_id}->${r.onsinch_order_id}`).join(", ")}`);

  ok(rows.length === 2, "both threads have a ticket", String(rows.length));
  ok(rows.every((r) => Number(r.onsinch_order_id) === ORDER),
    "BOTH tickets keep the order link", rows.map((r) => String(r.onsinch_order_id)).join("/"));
  ok(rows.every((r) => !r.needs_human),
    "neither is flagged needs_human — sharing an order is normal, not a problem");
  ok(rows.every((r) => !(r.notes ?? []).some((n: string) => /already linked/i.test(n))),
    "no 'already linked to another thread' note");

  console.log("\n[2] the order is still findable from either thread");
  const byOrder = (await sql`
    SELECT thread_id FROM tickets WHERE onsinch_order_id = ${ORDER} AND thread_id LIKE ${TAG + "%"}`) as any[];
  ok(byOrder.length === 2, "a lookup by order id returns both threads", String(byOrder.length));

  console.log("\n[3] one thread still cannot hold two orders (thread_id is the PK)");
  await upsertTicketFromState({ ...threadOn(a, "Presser Monday 3rd August"), onsinch_order_id: ORDER + 1, onsinch_order_number: String(ORDER + 1) });
  const again = (await sql`SELECT count(*)::int AS n FROM tickets WHERE thread_id = ${a}`) as any[];
  ok(again[0].n === 1, "still exactly one ticket for that thread", String(again[0].n));

  const d1 = await sql`DELETE FROM tickets WHERE thread_id LIKE ${TAG + "%"} RETURNING thread_id`;
  const d2 = await sql`DELETE FROM ticket_events WHERE thread_id LIKE ${TAG + "%"} RETURNING id`;
  console.log(`\ncleanup: tickets=${d1.length} events=${d2.length}`);

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
