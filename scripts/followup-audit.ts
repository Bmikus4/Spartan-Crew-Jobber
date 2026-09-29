// ============================================================================
// Read what the follow-up clock decided about REAL threads, and judge it by hand.
// ----------------------------------------------------------------------------
// test/followupClock.ts proves the rules do what I designed them to do. It cannot
// prove the design is right, because every string in it was written by the same hand
// that wrote the regex. This prints the clock's verdict beside the actual last words
// of real conversations so a person can disagree with it.
//
// THE EXPENSIVE ERROR IS "NOBODY IS WAITING". A thread wrongly called finished is an
// unanswered client nobody will ever see again — the silence the whole feature exists
// to surface. So that bucket is sampled hardest, and it is sampled from threads whose
// LAST message is the client's, where a wrong "finished" is most likely.
//
// Read-only. One SELECT, no model calls.
//   npx tsx scripts/followup-audit.ts [--bucket none|us|them] [-n 8]
// ============================================================================
import { sql } from "./_q.mjs";
import { waitingPeriod, needsResponse, closureOnly, substantive } from "../app/lib/followup/clock";
import type { ThreadMessage } from "../app/lib/engine/types";

const BUCKET = process.argv.includes("--bucket")
  ? String(process.argv[process.argv.indexOf("--bucket") + 1] || "none")
  : "none";
const N = process.argv.includes("-n") ? Number(process.argv[process.argv.indexOf("-n") + 1] || 8) : 8;

type Row = {
  thread_id: string; message_id: string; from_address: string; date_iso: string;
  subject: string; body: string | null; is_from_spartan: boolean;
};

const clip = (s: string, n = 150) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

async function main() {
  const rows = (await sql`
    SELECT thread_id, message_id, from_address, date_iso, subject, body, is_from_spartan
    FROM thread_messages ORDER BY thread_id, date_iso ASC`) as unknown as Row[];

  const threads = new Map<string, ThreadMessage[]>();
  for (const r of rows) {
    const m: ThreadMessage = {
      message_id: r.message_id, from: r.from_address, to: [], date_iso: r.date_iso,
      subject: r.subject ?? "", body: r.body ?? "", is_from_spartan: r.is_from_spartan,
    };
    const l = threads.get(r.thread_id);
    if (l) l.push(m); else threads.set(r.thread_id, [m]);
  }

  const picked: Array<[string, ThreadMessage[]]> = [];
  for (const [id, msgs] of threads) {
    const w = waitingPeriod(msgs);
    const live = msgs.filter(substantive);
    if (!live.length) continue;
    const last = live[live.length - 1];
    if (BUCKET === "none" && w === null && !last.is_from_spartan) picked.push([id, msgs]);
    if (BUCKET === "us" && w?.owed_by === "us") picked.push([id, msgs]);
    if (BUCKET === "them" && w?.owed_by === "them") picked.push([id, msgs]);
  }

  // Newest first: recent threads are the ones a person can still remember.
  picked.sort((a, b) => (b[1].at(-1)?.date_iso ?? "").localeCompare(a[1].at(-1)?.date_iso ?? ""));

  console.log(`\nbucket=${BUCKET}  matching=${picked.length}  showing=${Math.min(N, picked.length)}`);
  console.log(`${"=".repeat(78)}`);

  for (const [id, msgs] of picked.slice(0, N)) {
    const live = msgs.filter(substantive);
    const last = live[live.length - 1];
    const w = waitingPeriod(msgs);
    console.log(`\n${id}   ${clip(last.subject, 62)}`);
    console.log(`  verdict: ${w ? `${w.owed_by} owes, since ${w.since_iso.slice(0, 16)}` : "NOBODY IS WAITING"}`);
    for (const m of live.slice(-2)) {
      console.log(`  ${m.is_from_spartan ? "SPARTAN" : "client "} ${m.date_iso.slice(0, 16)}  ${clip(m.body, 130)}`);
      console.log(`          needsResponse=${needsResponse(m)}  closureOnly=${closureOnly(m)}`);
    }
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
