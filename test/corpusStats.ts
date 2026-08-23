// ============================================================================
// The corpus aggregates still return what the database returned.
// ----------------------------------------------------------------------------
// rnd-study asked Postgres for eight aggregates over sweep_threads.payload. The
// mail moved to data/corpus/sweep-threads.jsonl and the column was emptied, so
// those became one pass in scripts/_corpusStats.mjs. A mistake in that port does
// not throw — it prints a different number and reads exactly like a finding.
//
// So the two figures below are pinned to what SQL returned on 2026-08-23, BEFORE
// the payload was cleared:
//   SELECT COUNT(*) FROM sweep_threads t, jsonb_array_elements(t.payload->'messages')
//     -> 27830
//   SELECT COUNT(DISTINCT lower(m.v->>'from')) ... is_from_spartan=false AND from<>''
//     -> 1178
// They cannot be re-derived from the database now, which is exactly why they are
// written down here.
//
// No database connection: this passes while Neon is over its transfer quota.
// Skips cleanly when the corpus file is absent.
//
// Run: npx tsx test/corpusStats.ts
// ============================================================================
import { existsSync } from "node:fs";
import { corpusStats, latencySummary } from "../scripts/_corpusStats.mjs";
import { corpusPath } from "../scripts/_corpus.mjs";

let fails = 0;
const ok = (cond: boolean, label: string, got: unknown, want?: unknown) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}  got=${got}${want !== undefined ? ` want=${want}` : ""}`);
};

async function main() {
  if (!existsSync(corpusPath())) {
    console.log("  SKIP  no corpus exported — run npm run corpus:export");
    process.exit(0);
  }

  const S = await corpusStats();

  ok(S.messages === 27830, "total messages", S.messages, 27830);
  ok(S.msgCountByAddr.size === 1178, "distinct non-Spartan senders", S.msgCountByAddr.size, 1178);

  // Internal consistency the SQL guaranteed by construction.
  ok(S.fromSpartan + S.fromClient === S.messages,
     "spartan + client == total", `${S.fromSpartan}+${S.fromClient}`, S.messages);
  ok(S.threadsByAddr.size === S.msgCountByAddr.size,
     "same sender set in both tallies", S.threadsByAddr.size, S.msgCountByAddr.size);

  const perSender = [...S.threadsByAddr].map(([, s]) => (s as Set<string>).size);
  const totalThreads = perSender.reduce((a, b) => a + b, 0);
  const repeatThreads = perSender.filter((t) => t > 1).reduce((a, b) => a + b, 0);
  ok(repeatThreads <= totalThreads, "repeat threads <= total thread-appearances", `${repeatThreads}/${totalThreads}`);
  ok([...S.threadsByDomain.values()].every((s) => (s as Set<string>).size > 0),
     "every domain has >=1 thread", S.threadsByDomain.size);

  const lat = latencySummary(S.latencyMinutes);
  ok(lat.pairs > 0, "reply-latency pairs found", lat.pairs);
  ok(lat.within_15m + lat.over_4h <= lat.pairs, "latency buckets within total",
     `${lat.within_15m}+${lat.over_4h}`, lat.pairs);

  const chars = [...S.charsByThread.values()].filter((c) => (c as number) > 0) as number[];
  ok(chars.length > 5000, "threads with text", chars.length);
  ok(Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) > 0, "mean chars positive",
     Math.round(chars.reduce((a, b) => a + b, 0) / chars.length));

  console.log(`\n  reply latency: pairs=${lat.pairs} median=${lat.median_minutes}min mean=${lat.mean_minutes}min <15m=${lat.within_15m} >4h=${lat.over_4h}`);
  console.log(`  talk split:    spartan=${S.fromSpartan} client=${S.fromClient}`);
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}
main();
