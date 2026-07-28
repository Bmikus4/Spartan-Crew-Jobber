// Prove the dedupe claim against the REAL Neon database, with no dev server:
// exercises first-claim, duplicate-claim, thread new-vs-update, and concurrency
// (20 simultaneous claims of one message must yield exactly one first_seen).
// Cleans up its own test rows. Run: node scripts/test-dedupe.mjs
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const T = `test-${process.pid}`;
let fails = 0;
const ok = (cond, label, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// Inline the same statements the lib runs, so this test needs no bundler.
async function ensure() {
  await sql`
    CREATE TABLE IF NOT EXISTS message_ledger (
      message_id    TEXT PRIMARY KEY,
      thread_id     TEXT,
      subject       TEXT,
      from_address  TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      seen_count    INT NOT NULL DEFAULT 1,
      note          TEXT
    )`;
}
async function claim(message_id, thread_id) {
  let prior = 0;
  if (thread_id) {
    const [r] = await sql`SELECT count(*)::int AS n FROM message_ledger WHERE thread_id = ${thread_id} AND message_id <> ${message_id}`;
    prior = r?.n ?? 0;
  }
  const rows = await sql`
    INSERT INTO message_ledger (message_id, thread_id, subject, from_address, note)
    VALUES (${message_id}, ${thread_id}, null, null, null)
    ON CONFLICT (message_id) DO UPDATE
      SET last_seen_at = now(),
          seen_count   = message_ledger.seen_count + 1,
          thread_id    = COALESCE(message_ledger.thread_id, EXCLUDED.thread_id)
    RETURNING seen_count, thread_id`;
  const seen_count = rows[0]?.seen_count ?? 1;
  return { found: seen_count !== 1, first_seen: seen_count === 1, seen_count, thread_first_seen: prior === 0, thread_message_count: prior + 1 };
}

await ensure();

console.log("1. first claim of a new message");
const a = await claim(`${T}-m1`, `${T}-t1`);
ok(a.first_seen === true, "first_seen true");
ok(a.found === false, "found false");
ok(a.thread_first_seen === true, "thread_first_seen true -> NEW JOB");

console.log("2. the same message again (duplicate poll)");
const b = await claim(`${T}-m1`, `${T}-t1`);
ok(b.first_seen === false, "first_seen false");
ok(b.found === true, "found true");
ok(b.seen_count === 2, "seen_count 2", `got ${b.seen_count}`);

console.log("3. a second message on the same thread");
const c = await claim(`${T}-m2`, `${T}-t1`);
ok(c.first_seen === true, "first_seen true (new message)");
ok(c.thread_first_seen === false, "thread_first_seen false -> UPDATE");
ok(c.thread_message_count === 2, "thread_message_count 2", `got ${c.thread_message_count}`);

console.log("4. concurrency: 20 simultaneous claims of one message");
const results = await Promise.all(Array.from({ length: 20 }, () => claim(`${T}-race`, `${T}-t2`)));
const firsts = results.filter((r) => r.first_seen).length;
ok(firsts === 1, "exactly one first_seen", `got ${firsts}`);
const [{ n: raceCount }] = await sql`SELECT seen_count AS n FROM message_ledger WHERE message_id = ${`${T}-race`}`;
ok(raceCount === 20, "seen_count 20 (no lost update)", `got ${raceCount}`);

console.log("5. a message with no thread_id still claims once");
const d1 = await claim(`${T}-m3`, null);
const d2 = await claim(`${T}-m3`, null);
ok(d1.first_seen && !d2.first_seen, "first then duplicate");

await sql`DELETE FROM message_ledger WHERE message_id LIKE ${T + "%"}`;
const [{ n: left }] = await sql`SELECT count(*)::int AS n FROM message_ledger WHERE message_id LIKE ${T + "%"}`;
console.log(`\ncleanup: ${left} test rows left`);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
