// ============================================================================
// Every conversation's fold state, recomputed by hand (the live keeper is the minute sync's fold step).
// ----------------------------------------------------------------------------
// Same code as production (app/lib/v2/fold/live.ts): fill refolds every thread with a reading and
// overwrites fold_state; diff recomputes without writing and exits red on any difference — the same
// check the sync runs daily, runnable on demand. Counts and ids only.
//
//   npx tsx --env-file=.env.local scripts/refold.mts fill
//   npx tsx --env-file=.env.local scripts/refold.mts diff
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";
import { foldAll, FOLD_VERSION } from "../app/lib/v2/fold/fold";
import { buildEvents, foldThreads, stable } from "../app/lib/v2/fold/live";
import { migrate } from "../app/lib/migrations";

loadEnv();
const mode = process.argv[2];
if (mode !== "fill" && mode !== "diff") {
  console.error("usage: refold.mts fill|diff");
  process.exit(2);
}
const sql: any = neon(requireEnv("DATABASE_URL").trim());
await migrate(sql);

const tids = ((await sql`SELECT DISTINCT thread_id FROM v2_decisions WHERE ask IS NOT NULL AND thread_id IS NOT NULL`) as any[]).map((r: any) => r.thread_id);
if (mode === "fill") {
  const asks = await foldThreads(sql, tids);
  console.log(`folded ${tids.length} threads, ${asks} asks (${FOLD_VERSION})`);
  process.exit(0);
}
const stored = new Map(((await sql`SELECT thread_id, state FROM fold_state`) as any[]).map((r: any) => [r.thread_id, stable(r.state)]));
const events = await buildEvents(sql, tids);
let differ = 0, asks = 0;
for (const tid of tids) {
  const s = foldAll(tid, events.get(tid) ?? []);
  asks += s.asks.length;
  if (stored.get(tid) !== stable(s)) differ++;
}
console.log(`refolded ${tids.length} threads (${asks} asks): ${differ} differ from fold_state${differ ? " — REFOLD DRIFT, investigate before trusting stored state" : ""}`);
process.exit(differ ? 1 : 0);
