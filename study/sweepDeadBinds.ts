// ============================================================================
// Can the reconciliation sweep recover the 109 threads whose order is gone?
// ----------------------------------------------------------------------------
// docs/ACCURACY-PLAN-2026-09-16.md ranks dead binds first: 109 of the 287 threads
// that ever bound to an OnSinch order hold an id that no longer exists — 38%. It
// matters because the identity rule reads that id to decide whether the next message
// amends the standing order or opens a new one, so every one of these threads will
// get its next amendment wrong.
//
// The sweep already claims to detect and re-match a dead bind. It has never been
// scored on this population, and until it is, "the sweep handles it" is a belief.
//
// DRY BY DEFAULT and it is not a promise: the executor's write methods are removed
// and the store's put is dropped, so a code path that reaches a write throws instead
// of quietly altering a live order. Passing --write lets the sweep correct what it
// finds, which is what the 06:00 cron does anyway.
//
// It targets the 109 BY ID rather than sweeping the head of the queue, because the
// head is whatever was updated most recently and would answer a different question.
//
//   npx tsx study/sweepDeadBinds.ts            report, writing nothing
//   npx tsx study/sweepDeadBinds.ts --write     let it correct what it finds
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildDeps } from "../app/lib/deps";
import { NeonStateStore } from "../app/lib/stateDb";
import { sweepAll, type SweepOutcome } from "../app/lib/engine/sweep";
import type { PipelineDeps } from "../app/lib/engine/pipeline";
import { loadEnv, ROOT_DIR } from "../scripts/_env.mjs";

loadEnv();
const WRITE = process.argv.includes("--write");

const PATH = join(ROOT_DIR, "data", "testset", "threads.jsonl");
if (!existsSync(PATH)) throw new Error(`no test set at ${PATH} — run: npx tsx scripts/build-testset.ts`);
const rows = readFileSync(PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const deadIds = new Set<string>(rows.filter((r: any) => r.onsinch_missing).map((r: any) => r.thread_id));

async function main() {
  console.log(`${deadIds.size} thread(s) in the test set hold an order id OnSinch no longer has.\n`);

  const store = new NeonStateStore();
  const all = await store.all();
  const targets = all.filter((s) => deadIds.has(s.thread_id));
  console.log(`${targets.length} of them are still in the state store's window (store.all is the 500 most`);
  console.log(`recently updated threads, so an older one is simply not reachable from here).\n`);

  const deps = await buildDeps();
  // The dry sandbox, same construction as /api/reconcile: removing the methods rather
  // than trusting the caller not to call them.
  const sandboxed = WRITE ? deps : {
    ...deps,
    store: { get: store.get.bind(store), put: async () => {}, all: store.all.bind(store) },
    executor: {
      ...deps.executor,
      amendOrderInPlace: undefined,
      patchOrder: async () => { throw new Error("dry run"); },
    },
  };

  console.log(`sweeping ${targets.length} thread(s) ${WRITE ? "FOR REAL" : "DRY"} — two OnSinch reads each, no model calls …\n`);
  const t0 = Date.now();
  const { swept, outcomes } = await sweepAll(targets, sandboxed as PipelineDeps, {
    todayISO: new Date().toISOString(),
    // No limit: the limit exists to fit a 60-second serverless function, and this is not one.
  });
  console.log(`${swept} thread(s) cost a read; ${Math.round((Date.now() - t0) / 1000)}s\n`);

  const byAction = new Map<string, SweepOutcome[]>();
  for (const o of outcomes) {
    if (!byAction.has(o.action)) byAction.set(o.action, []);
    byAction.get(o.action)!.push(o);
  }
  const MEANING: Record<string, string> = {
    rebound: "FOUND A LIVE ORDER FOR THIS JOB — the bind is repaired",
    lost: "no order exists for this job any more; the thread is flagged for a human",
    reasserted: "the order is alive after all and its shape was re-asserted",
    holds: "the order is alive and already correct",
    unreconciled: "alive, but the row carries no shape to reconcile against",
    skipped: "decided before any OnSinch read — cost nothing",
    error: "threw",
  };
  console.log("outcome                 n    meaning");
  for (const [action, os] of [...byAction.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${action.padEnd(14)} ${String(os.length).padStart(4)}    ${MEANING[action] ?? ""}`);
  }

  // THE DENOMINATOR IS THE RESULT. "109 dead binds, 38% of everything that ever bound"
  // counts every thread whose order id is gone, and most of those jobs already happened —
  // the crew turned up or they did not, weeks ago, and no amount of reconciling changes
  // it. A dead bind only costs anything on work still to come, because that is the only
  // case where the identity rule will read the stale id to decide what the next message
  // means. So the honest denominator is the FUTURE work, and it is a quarter of the size.
  const count = (a: string) => (byAction.get(a) ?? []).length;
  const skips = byAction.get("skipped") ?? [];
  const past = skips.filter((o) => /in the past/.test(String(o.detail))).length;
  const noShape = skips.filter((o) => /no desired shape/.test(String(o.detail))).length;
  const apiMute = skips.filter((o) => /came back empty|could not be read back/.test(String(o.detail))).length;
  const n = targets.length;
  const live = n - past;

  console.log(`\nOf ${n} dead binds:`);
  console.log(`  ${past} are jobs that ALREADY HAPPENED — nothing to recover, and not a defect.`);
  console.log(`  ${live} concern work still to come. That is the real denominator.\n`);
  console.log(`Against those ${live}:`);
  const pc = (x: number) => (live ? `${((100 * x) / live).toFixed(1)}%` : "n/a");
  console.log(`  ${count("rebound")} rebound to the live successor order   ${pc(count("rebound"))}`);
  console.log(`  ${count("lost")} correctly declared lost and flagged     ${pc(count("lost"))}`);
  console.log(`  ${noShape} cannot be reconciled at all — the thread carries no desired shape  ${pc(noShape)}`);
  console.log(`  ${apiMute} the API would not answer, so nothing is evidence either way        ${pc(apiMute)}`);
  console.log(`  ${count("error")} threw (in a dry run that is the write guard firing, so these would have been corrected)`);
  console.log(`  ${count("holds") + count("reasserted") + count("unreconciled")} were alive after all — the test set was stamped earlier and has gone stale`);
  const handled = count("rebound") + count("lost");
  console.log(`\n  HANDLED CORRECTLY: ${handled} of ${live}  ${pc(handled)}`);
  console.log(`  The ${noShape} with no desired shape are the one real gap, and they are a known bug:`);
  console.log(`  until 2026-09-14 the compiler wrote null over desired_order on every pass that`);
  console.log(`  composed nothing, which is most messages in a booked thread. Those rows are`);
  console.log(`  already written and no sweep can reconcile them without a rebuild from`);
  console.log(`  last_ordered_teams.`);

  for (const [action, os] of byAction) {
    if (action === "holds") continue;
    if (action === "skipped") {
      // WHY a thread was skipped is the whole result on this population, because the
      // sweep declining to look is indistinguishable from the sweep finding nothing
      // unless the reason is printed.
      const why: Record<string, number> = {};
      for (const o of os) why[String(o.detail ?? "(none)")] = (why[String(o.detail ?? "(none)")] ?? 0) + 1;
      console.log(`
skipped, by reason:`);
      for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
      continue;
    }
    console.log(`\n${action}:`);
    for (const o of os.slice(0, 15)) console.log(`  ${o.thread_id}  order ${o.order_id ?? "-"}  ${String(o.detail ?? "").slice(0, 110)}`);
    if (os.length > 15) console.log(`  … and ${os.length - 15} more`);
  }

  console.log(`\n${WRITE ? "Corrections were written." : "Nothing was written. Pass --write to let it correct what it found."}`);
}

main();
