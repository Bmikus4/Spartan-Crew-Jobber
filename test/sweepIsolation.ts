// ============================================================================
// The sweep corpus must stay out of production.
// ----------------------------------------------------------------------------
// Ben: "for our testing, we'll keep this data separate". A 12-month sweep of
// bookings@ is thousands of threads. If any of it reached `inbound_raw` or
// `tickets` it would bury the work Spartan is actually doing today under last
// autumn's mail and make the Jobs Board useless — the opposite of a validation
// pass.
//
// So this asserts the separation rather than trusting it: storing a swept thread
// writes sweep_threads and NOTHING else, and re-sweeping keeps the fullest copy
// rather than the last one, because a date-paged sweep meets the same thread more
// than once.
//
// Runs against the real database with tagged rows, and removes them.
//
// Run: npx tsx test/sweepIsolation.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { storeSweptThread, sweepStats } from "../app/lib/sweepDb";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `sweeptest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const thread = (id: string, n: number) => ({
  thread_id: id,
  messages: Array.from({ length: n }, (_, i) => ({
    message_id: `${id}-m${i}`,
    from: i % 2 ? "bookings@spartancrew.co.uk" : "someone@client.example",
    to: ["bookings@spartancrew.co.uk"],
    date_iso: new Date(Date.UTC(2025, 8, 10 + i, 9)).toISOString(),
    subject: "Crew for an old job",
    body: `message ${i}: we need 4 crew`,
    is_from_spartan: i % 2 === 1,
  })),
});

async function counts() {
  const [a] = (await sql`SELECT count(*)::int AS n FROM inbound_raw`) as any[];
  const [b] = (await sql`SELECT count(*)::int AS n FROM tickets`) as any[];
  const [c] = (await sql`SELECT count(*)::int AS n FROM conversation_state`) as any[];
  return { inbound_raw: a.n, tickets: b.n, conversation_state: c.n };
}

async function main() {
  const before = await counts();
  console.log(`\nproduction before: ${JSON.stringify(before)}`);

  console.log("\n[1] a swept thread is stored");
  const r1 = await storeSweptThread(thread(`${TAG}-a`, 3));
  ok(r1.ok && r1.stored, "stored", JSON.stringify({ ok: r1.ok, stored: r1.stored, err: r1.error }));
  ok(r1.message_count === 3, "message count recorded", String(r1.message_count));

  console.log("\n[2] production tables are untouched");
  const after = await counts();
  ok(after.inbound_raw === before.inbound_raw, "inbound_raw unchanged", `${before.inbound_raw} -> ${after.inbound_raw}`);
  ok(after.tickets === before.tickets, "tickets unchanged", `${before.tickets} -> ${after.tickets}`);
  ok(after.conversation_state === before.conversation_state, "conversation_state unchanged", `${before.conversation_state} -> ${after.conversation_state}`);

  console.log("\n[3] re-sweeping keeps the FULLEST copy, not the last one");
  const thin = await storeSweptThread(thread(`${TAG}-a`, 1));
  ok(thin.ok && !thin.stored, "a thinner copy is declined", `stored=${thin.stored}`);
  let [row] = (await sql`SELECT message_count FROM sweep_threads WHERE thread_id = ${TAG + "-a"}`) as any[];
  ok(row.message_count === 3, "still 3 messages", String(row.message_count));

  const fuller = await storeSweptThread(thread(`${TAG}-a`, 7));
  ok(fuller.ok && fuller.stored && fuller.enriched, "a fuller copy replaces it", `stored=${fuller.stored} enriched=${fuller.enriched}`);
  [row] = (await sql`SELECT message_count FROM sweep_threads WHERE thread_id = ${TAG + "-a"}`) as any[];
  ok(row.message_count === 7, "now 7 messages", String(row.message_count));

  console.log("\n[4] the row carries what the analysis needs");
  const [full] = (await sql`SELECT mailbox, subject, participants, first_date, last_date FROM sweep_threads WHERE thread_id = ${TAG + "-a"}`) as any[];
  ok(full.mailbox === "bookings@spartancrew.co.uk", "mailbox", full.mailbox);
  ok(Array.isArray(full.participants) && full.participants.includes("someone@client.example"), "participants", JSON.stringify(full.participants));
  ok(!!full.first_date && !!full.last_date, "date span", `${String(full.first_date).slice(4, 16)} .. ${String(full.last_date).slice(4, 16)}`);
  ok(Date.parse(String(full.first_date)) < Date.parse(String(full.last_date)), "first is before last",
    `${Date.parse(String(full.first_date))} < ${Date.parse(String(full.last_date))}`);

  console.log("\n[5] a payload with no thread_id is refused, not stored blank");
  const bad = await storeSweptThread({ messages: [] });
  ok(!bad.ok && /thread_id/.test(bad.error ?? ""), "refused with a reason", bad.error);

  console.log("\n[6] stats report the corpus");
  const s = await sweepStats();
  ok(s.threads >= 1 && s.messages >= 7, "threads and messages counted", `${s.threads} threads / ${s.messages} messages`);

  const d = await sql`DELETE FROM sweep_threads WHERE thread_id LIKE ${TAG + "%"} RETURNING thread_id`;
  console.log(`\ncleanup: removed ${d.length} swept thread(s)`);
  const end = await counts();
  ok(JSON.stringify(end) === JSON.stringify(before), "production identical at the end", JSON.stringify(end));

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
