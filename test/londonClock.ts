// ============================================================================
// A client's wall clock is London local, and OnSinch stores a true instant.
//
// compose stamped every window `+00:00`. OnSinch holds UTC — proven on the live
// tenant, where human-raised jobs cluster an hour earlier in BST than in GMT
// (modal start 07:00 vs 08:00 across 1685 orders) — so from late March to late
// October every job this engine wrote was booked an hour late. It went unnoticed
// because staff were fixing it in the UI: 19 of the 21 BST orders the engine had
// written carried a post-creation edit, and thread 1a062f961459e571 ("Labour
// Fringe - Liverpool") is the one that was reported — 09:00-15:00 asked for,
// 10:00-16:00 booked.
//
// The winter half is the trap. `+00:00` is CORRECT under GMT, so half the year
// looks right and a fix that hardcodes `+01:00` would break the other half.
//
// Run: npx tsx test/londonClock.ts
// ============================================================================
import { composeOrder } from "../app/lib/engine/compose";
import type { ConversationFacts } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const window = (date: string, start: string, end: string) => {
  const o = composeOrder({
    facts: { location_text: "ExCeL London", requests: [{ date, size: 4, start_time: start, end_time: end }] },
    company_id: 515, user_id: 2257, place_id: 49, pricelist_category_id: 197,
    orderName: "test", jobName: "test",
  });
  const t = o.order!.slot_teams[0];
  return { beginning: t.beginning, end: t.end };
};

console.log("\n[1] the reported job — Labour Fringe, 24 Sep 2026, BST");
{
  const w = window("2026-09-24", "09:00", "15:00");
  ok(w.beginning === "2026-09-24T09:00:00+01:00", "09:00 is 09:00 London, not 09:00 UTC", w.beginning);
  ok(w.end === "2026-09-24T15:00:00+01:00", "and so is the finish", w.end);
  ok(Date.parse(w.beginning) === Date.parse("2026-09-24T08:00:00Z"), "the instant OnSinch stores is 08:00Z");
}

console.log("\n[2] the same clock in winter keeps +00:00");
{
  const w = window("2026-12-10", "09:00", "17:00");
  ok(w.beginning === "2026-12-10T09:00:00+00:00", "GMT is unchanged", w.beginning);
  ok(w.end === "2026-12-10T17:00:00+00:00", "both ends", w.end);
}

console.log("\n[3] the clock-change days themselves");
{
  // BST 2026 begins 01:00 UTC on 29 March and ends 02:00 BST on 25 October.
  ok(window("2026-03-28", "09:00", "17:00").beginning.endsWith("+00:00"), "the day before spring forward is GMT");
  ok(window("2026-03-29", "09:00", "17:00").beginning.endsWith("+01:00"), "the day of spring forward is BST by 09:00");
  ok(window("2026-10-25", "09:00", "17:00").beginning.endsWith("+00:00"), "the day of fall back is GMT by 09:00");
  ok(window("2026-10-24", "09:00", "17:00").beginning.endsWith("+01:00"), "the day before it is still BST");
}

console.log("\n[4] a shift that crosses the spring-forward boundary");
{
  // 29 March 2026: the clocks go forward at 01:00 UTC, so a 20:00-02:00 shift
  // starting on the 28th finishes at 02:00 BST — a five-hour night, not six.
  const w = window("2026-03-28", "20:00", "02:00");
  ok(w.beginning === "2026-03-28T20:00:00+00:00", "starts on GMT", w.beginning);
  ok(w.end === "2026-03-29T02:00:00+01:00", "finishes on BST the next morning", w.end);
  const hours = (Date.parse(w.end) - Date.parse(w.beginning)) / 3600000;
  ok(hours === 5, "five real hours, because an hour of the night did not exist", String(hours));
}

console.log("\n[5] an unpadded clock is still a clock");
{
  const w = window("2026-09-24", "9:00", "15:00");
  ok(w.beginning === "2026-09-24T09:00:00+01:00", "\"9:00\" pads rather than falling back to UTC", w.beginning);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
