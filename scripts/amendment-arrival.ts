// ============================================================================
// HOW LONG AFTER A BOOKING DOES THE AMENDMENT ARRIVE?
// ----------------------------------------------------------------------------
// Ben's question, 2026-09-13: do amendments land within 30 days of the order being raised?
// It decides how long a thread has to stay reconcilable, and therefore whether anything may
// ever be purged.
//
// IT CANNOT BE ANSWERED FROM THIS TENANT TODAY, and that is the point of this script rather
// than an excuse for it. The longest interval on record is bounded by how long the engine has
// been running, not by client behaviour, so any number it prints now is a floor. What makes
// the answer possible later is that `logAction` stamps `days_after_create` on every amendment
// as it happens (pipeline.ts) — this only reads what accumulated.
//
// Read the OUTPUT accordingly: the distribution is real, the maximum is an artefact of the
// engine's age, and the two stop being the same thing once the engine is older than the
// horizon it is measuring. Re-run it in sixty days.
//
// For the other half of the picture — how far AHEAD of the job an order is raised, which is
// what says how long a thread must stay alive — see scripts/amendment-horizon.mjs.
//
// Read-only. Touches no API.
//   npx tsx scripts/amendment-arrival.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import type { ConversationState } from "../app/lib/engine/types";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

const CHANGED = new Set(["amend", "replace"]);

(async () => {
  const rows = (await sql`select state from conversation_state`) as Array<{ state: any }>;
  const states = rows.map((r) => (typeof r.state === "string" ? JSON.parse(r.state) : r.state) as ConversationState);

  const days: number[] = [];
  let changes = 0, stamped = 0, unstamped = 0, inherited = 0;
  const oldest: Array<{ thread: string; days: number; kind: string }> = [];

  for (const s of states) {
    const log = s.order_action_log ?? [];
    const hasCreate = log.some((a) => a.kind === "create" && a.ok);
    for (const a of log) {
      if (!CHANGED.has(a.kind) || !a.ok) continue;
      changes++;
      if (typeof a.days_after_create === "number") {
        stamped++;
        days.push(a.days_after_create);
        oldest.push({ thread: s.thread_id, days: a.days_after_create, kind: a.kind });
      } else if (!hasCreate) {
        // The order was raised before this engine ever saw the thread, so there is no
        // origin to measure from. Counted apart rather than as a zero — folding these in
        // would drag every percentile towards same-day.
        inherited++;
      } else {
        // Logged before the stamp existed. Also not a zero.
        unstamped++;
      }
    }
  }

  const pct = (p: number) => (days.length ? days.slice().sort((a, b) => a - b)[Math.floor((days.length - 1) * p)] : null);

  console.log(`threads: ${states.length}`);
  console.log(`successful amendments and rebuilds: ${changes}`);
  console.log(`  with an interval recorded   ${stamped}`);
  console.log(`  order predates the engine   ${inherited}  (no origin to measure from)`);
  console.log(`  logged before the stamp     ${unstamped}`);

  if (!days.length) {
    console.log(`\nNo intervals recorded yet. This is the expected state on the day the stamp shipped —`);
    console.log(`it fills in as amendments arrive. Nothing here is evidence that amendments are rare.`);
    return;
  }

  console.log(`\ndays from the order being raised to the change arriving`);
  console.log(`  min ${Math.min(...days)}   median ${pct(0.5)}   p75 ${pct(0.75)}   p90 ${pct(0.9)}   max ${Math.max(...days)}`);
  const within = (n: number) => `${days.filter((d) => d <= n).length}/${days.length}`;
  console.log(`  within 7 days ${within(7)}   within 30 ${within(30)}   within 90 ${within(90)}`);
  console.log(`\nTHE MAXIMUM IS A FLOOR. It cannot exceed the engine's own age, so it says what has`);
  console.log(`been observed and not what clients do. Treat it as settled only once it stops rising.`);

  oldest.sort((a, b) => b.days - a.days);
  console.log(`\n--- the longest intervals seen ---`);
  for (const o of oldest.slice(0, 10)) console.log(`   ${String(o.days).padStart(4)}d  ${o.kind.padEnd(8)} ${o.thread.slice(0, 16)}`);
})();
