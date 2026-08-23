// ============================================================================
// A message body older than the retention window leaves; a recent one stays.
// ----------------------------------------------------------------------------
// The window is the only thing standing between a bounded table and the
// unbounded one this replaced, so it is asserted rather than trusted. The
// headers must survive: the board, the sender ledger and the ops scripts read
// them, and they are a few dozen bytes against a body's several kilobytes.
//
// Run: npx tsx test/bodyArchive.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
// test/all.ts runs files alphabetically, so this one runs before threadMessages.ts and
// cannot assume the table exists yet.
import { ensureThreadMessages } from "../app/lib/threadMessagesDb";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `archivetest-${process.pid}`;
const OUT = `data/archive/${TAG}.jsonl`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const put = (n: string, daysAgo: number) => sql`
  INSERT INTO thread_messages
    (message_id, thread_id, from_address, date_iso, subject, body, first_seen_at)
  VALUES (${TAG + n}, ${TAG}, 'c@example.com', '2026-01-01T00:00:00Z', 'subj',
          ${"body " + n}, now() - (${String(daysAgo)} || ' days')::interval)
  ON CONFLICT (message_id) DO NOTHING`;

async function main() {
  await ensureThreadMessages();
  await put("-old", 120);
  await put("-edge", 89);
  await put("-new", 3);

  execFileSync("node", ["scripts/archive-thread-bodies.mjs", "--apply", "--out", OUT],
    { stdio: "inherit" });

  const rows = (await sql`
    SELECT message_id, body, archived_at, subject, from_address
    FROM thread_messages WHERE thread_id = ${TAG} ORDER BY message_id`) as any[];
  const by = Object.fromEntries(rows.map((r) => [r.message_id, r]));

  ok(by[TAG + "-old"].body === null, "a 120-day-old body is gone");
  ok(by[TAG + "-old"].archived_at !== null, "and the row says when it went");
  ok(by[TAG + "-old"].subject === "subj", "its subject stayed");
  ok(by[TAG + "-old"].from_address === "c@example.com", "its sender stayed");
  ok(by[TAG + "-edge"].body !== null, "an 89-day-old body is inside the window and stays");
  ok(by[TAG + "-new"].body !== null, "a 3-day-old body stays");

  ok(existsSync(OUT), "the archive file was written");
  const lines = readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const mine = lines.filter((l) => String(l.message_id).startsWith(TAG));
  ok(mine.length === 1, "one line, for the one archived message", String(mine.length));
  ok(mine[0]?.message_id === TAG + "-old", "naming the message it archived");
  ok(mine[0]?.body === "body -old", "and carrying the body verbatim");

  rmSync(OUT, { force: true });
  await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG}`;
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}
main();
