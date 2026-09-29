// ============================================================================
// Run the follow-up clock over the whole stored corpus and report what it finds.
// ----------------------------------------------------------------------------
// Read-only, local, free: one SELECT, no model calls, no Gmail, no OnSinch.
//
// TWO CLOCKS, AND THE SECOND IS THE POINT. Intake stopped 2026-09-18 13:33 and the
// corpus stops with it. Evaluated AT THE PAUSE, this says what the engine would have
// labelled had the feature existed. Evaluated TODAY, it says what will fire the
// moment intake resumes — because every thread that was waiting when the lights went
// out is still waiting, and they all become overdue at once. That burst is the number
// worth knowing before anything is switched on.
//
//   npx tsx scripts/followup-census.ts
//   npx tsx scripts/followup-census.ts --sample 12   # print candidates for review
// ============================================================================
import { sql } from "./_q.mjs";
import { waitingPeriod, isOverdue, isDormant, DORMANT_AFTER_DAYS, type WaitingPeriod } from "../app/lib/followup/clock";
import type { ThreadMessage } from "../app/lib/engine/types";

const PAUSE = new Date("2026-09-18T13:33:00.000Z");
const NOW = new Date();
const SAMPLE = process.argv.includes("--sample")
  ? Number(process.argv[process.argv.indexOf("--sample") + 1] || 12)
  : 0;

type Row = {
  thread_id: string; message_id: string; from_address: string; to_addresses: unknown;
  date_iso: string; subject: string; body: string | null; is_from_spartan: boolean;
};

async function main() {
  const rows = (await sql`
    SELECT thread_id, message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
    FROM thread_messages
    ORDER BY thread_id, date_iso ASC`) as Row[];

  const threads = new Map<string, ThreadMessage[]>();
  for (const r of rows) {
    const m: ThreadMessage = {
      message_id: r.message_id,
      from: r.from_address,
      to: Array.isArray(r.to_addresses) ? (r.to_addresses as string[]) : [],
      date_iso: r.date_iso,
      subject: r.subject ?? "",
      body: r.body ?? "",
      is_from_spartan: r.is_from_spartan,
    };
    const list = threads.get(r.thread_id);
    if (list) list.push(m); else threads.set(r.thread_id, [m]);
  }

  let noWait = 0;
  const open: Array<{ thread_id: string; w: WaitingPeriod; subject: string; msgs: number }> = [];
  for (const [thread_id, msgs] of threads) {
    const w = waitingPeriod(msgs);
    if (!w) { noWait++; continue; }
    open.push({ thread_id, w, subject: msgs[msgs.length - 1].subject, msgs: msgs.length });
  }

  const by = (owed: "us" | "them") => open.filter((o) => o.w.owed_by === owed);
  const overdueAt = (d: Date) => open.filter((o) => isOverdue(o.w, d));

  console.log(`\n${"=".repeat(64)}`);
  console.log(`threads with stored messages          ${threads.size}`);
  console.log(`  nobody waiting (closed or answered) ${noWait}`);
  console.log(`  an open wait                        ${open.length}`);
  console.log(`     client waiting for Spartan       ${by("us").length}`);
  console.log(`     Spartan waiting for client       ${by("them").length}`);
  console.log(`${"-".repeat(64)}`);
  const atPause = overdueAt(PAUSE);
  console.log(`overdue AT THE PAUSE (${PAUSE.toISOString().slice(0, 16)})   ${atPause.length}`);
  console.log(`     client waiting for Spartan       ${atPause.filter((o) => o.w.owed_by === "us").length}`);
  console.log(`     Spartan waiting for client       ${atPause.filter((o) => o.w.owed_by === "them").length}`);
  const atNow = overdueAt(NOW);
  console.log(`overdue TODAY  — the resume burst     ${atNow.length}`);
  console.log(`     client waiting for Spartan       ${atNow.filter((o) => o.w.owed_by === "us").length}`);
  console.log(`     Spartan waiting for client       ${atNow.filter((o) => o.w.owed_by === "them").length}`);
  const raised = atNow.filter((o) => !isDormant(o.w, NOW));
  console.log(`${"-".repeat(64)}`);
  console.log(`ACTUALLY RAISED today, horizon applied  ${raised.length}`);
  console.log(`  (${atNow.length - raised.length} are dormant: waiting longer than ${DORMANT_AFTER_DAYS} days)`);
  console.log(`${"=".repeat(64)}\n`);

  /**
   * HOW OLD IS THE WAIT. An enquiry unanswered for 30 hours is a follow-up. One
   * unanswered since July is a thread that ended by phone, and chasing it emails a
   * client about a job that happened two months ago. The buckets size that risk.
   */
  const ageDays = (w: WaitingPeriod) =>
    (PAUSE.getTime() - Date.parse(w.since_iso)) / 86_400_000;
  const buckets: Array<[string, (d: number) => boolean]> = [
    ["under 2 days", (d) => d < 2],
    ["2-7 days", (d) => d >= 2 && d < 7],
    ["7-30 days", (d) => d >= 7 && d < 30],
    ["30-90 days", (d) => d >= 30 && d < 90],
    ["over 90 days", (d) => d >= 90],
  ];
  console.log("age of the wait at the pause:");
  for (const [name, f] of buckets) {
    const hit = open.filter((o) => f(ageDays(o.w)));
    console.log(`  ${name.padEnd(14)} ${String(hit.length).padStart(4)}   ` +
      `us ${String(hit.filter((o) => o.w.owed_by === "us").length).padStart(3)}  ` +
      `them ${String(hit.filter((o) => o.w.owed_by === "them").length).padStart(3)}`);
  }
  console.log();

  if (SAMPLE) {
    /**
     * Newest first, and balanced across the two directions, because a review that is
     * all one direction proves only half the behaviour.
     */
    const half = Math.ceil(SAMPLE / 2);
    const pick = [
      ...by("us").sort((a, b) => b.w.since_iso.localeCompare(a.w.since_iso)).slice(0, half),
      ...by("them").sort((a, b) => b.w.since_iso.localeCompare(a.w.since_iso)).slice(0, SAMPLE - half),
    ];
    console.log(`${pick.length} candidates for draft review:\n`);
    for (const p of pick) {
      const dir = p.w.owed_by === "us" ? "client waiting for Spartan" : "Spartan waiting for client";
      console.log(`  ${p.thread_id}  ${dir.padEnd(26)} since ${p.w.since_iso.slice(0, 16)}  ${p.msgs} msgs`);
      console.log(`      ${p.subject.slice(0, 78)}`);
    }
    console.log();
  }
}

/**
 * The dashboard's own view, through the same code the API serves — so a number on
 * the screen and a number here can never be two different calculations.
 */
async function board() {
  const { followupBoard } = await import("../app/lib/followup/board");
  const i = process.argv.indexOf("--at");
  const b = await followupBoard(i > -1 ? new Date(process.argv[i + 1]) : new Date());
  console.log(`\nalerts: ${b.alerts.length}   dormant: ${b.dormant_count} (over ${b.dormant_days} days)`);
  const linked = b.alerts.filter((a) => a.thread_url).length;
  console.log(`thread links: ${linked} real, ${b.alerts.length - linked} fall back to search\n`);
  for (const a of b.alerts.slice(0, 10)) {
    console.log(`  ${a.direction_label.padEnd(27)} ${String(a.overdue_hours).padStart(5)}h overdue  ${a.company_name ?? a.contact_email ?? "?"}`);
    console.log(`      ${a.subject.slice(0, 74)}`);
  }
}

if (process.argv.includes("--board")) {
  board().catch((e) => { console.error(e); process.exit(1); });
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}
