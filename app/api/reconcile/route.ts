export const runtime = "nodejs";
export const maxDuration = 60;

// The reconciliation sweep. Re-reads every bound thread against OnSinch and corrects what
// has drifted — see engine/sweep.ts for what it does and engine/reconcile.ts for why a
// read is the only check available.
//
//   POST /api/reconcile            sweep and correct
//   POST /api/reconcile?dry=1      sweep and report, writing nothing
//   GET  /api/reconcile            the same as dry, for a browser
//
// SPENDS NO MODEL CALLS. Everything it needs is on the state row, so this is safe to run
// on a cadence without a budget conversation. It does spend two OnSinch reads per thread,
// which is why `limit` exists and defaults to something a 60-second function can finish.
//
// IT SWEEPS A ROTATION, NOT THE TABLE. Measured 2026-09-17: ~0.6s per bound thread, 251
// bound threads, so a full pass is ~117s dry and longer live, against a 60s function
// ceiling. n8n asked for limit=200 and got a 504 every night -- the sweep had never once
// completed. The batch is therefore chosen by store.forSweep(), which orders by swept_at
// NULLS FIRST, and every thread the run looked at is stamped afterwards. Each run takes
// the threads that have waited longest, so the table is covered in ceil(bound / limit)
// runs and no thread starves.
//
// THE CADENCE IS PART OF THE FIX, not a separate tuning knob. At limit=30 a full rotation
// is nine runs; daily that is nine days, which is not reconciliation. The n8n sweep runs
// hourly, so everything is checked within about nine hours. Lengthening the interval or
// shrinking the limit without doing the division re-creates the starvation this replaced.
//
// Same N8N_WEBHOOK_SECRET as the other machine routes, and the same rule: a deployment
// with the database but no secret is NOT open.

import { buildDeps } from "../../lib/deps";
import { NeonStateStore } from "../../lib/stateDb";
import { sweepAll, type SweepOutcome } from "../../lib/engine/sweep";
import { authorizeMachineCall } from "../../lib/apiAuth";

// 30, not the 40 that was measured at 23.7s dry. A dry run replaces each write with an
// immediate throw, so the live run of that same batch does 21 OnSinch patches the
// measurement never paid for. The headroom is for those.
const DEFAULT_LIMIT = 30;

async function run(request: Request, dry: boolean): Promise<Response> {
  if (!authorizeMachineCall(request).ok) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  const store = new NeonStateStore();
  const states = await store.forSweep(limit);
  const deps = await buildDeps();

  /**
   * A dry run must not be able to write, and "we promise not to call it" is not a
   * mechanism. The executor's write methods are replaced outright, so a code path that
   * reaches one throws instead of quietly altering a live order — and the store is
   * swapped for one that drops its writes, since `reconcileThread` persists as it goes.
   */
  const sandboxed = dry
    ? {
        ...deps,
        store: { get: store.get.bind(store), put: async () => {}, all: store.all.bind(store) },
        executor: {
          ...deps.executor,
          amendOrderInPlace: undefined,
          patchOrder: async () => {
            throw new Error("dry run");
          },
        },
      }
    : deps;

  // No `limit` here: the batch was already bounded by the query that chose it, and
  // sweepAll's limit counts only threads that PAID for an OnSinch read. Applying both
  // means a batch of mostly-skipped rows stops short, leaves the rest unstamped, and
  // hands the next run the same rows again -- the rotation stalls while reporting
  // success. One bound, in one place.
  const { swept, outcomes } = await sweepAll(states, sandboxed as typeof deps, {
    todayISO: new Date().toISOString(),
  });

  // Stamped only on a real run. A dry run must leave no trace, and stamping one would
  // push every thread it looked at to the back of the queue without reconciling any of
  // them -- a read-only call silently costing the next real sweep its turn.
  if (!dry) await store.markSwept(states.map((s) => s.thread_id));
  const stats = await store.sweepStats();

  const tally: Record<string, number> = {};
  for (const o of outcomes) tally[o.action] = (tally[o.action] ?? 0) + 1;

  return Response.json({
    ok: true,
    dry,
    batch: states.length,
    bound_threads: stats.bound,
    never_swept: stats.never_swept,
    swept,
    tally,
    // Only the rows that did something or could not be done. A run where 38 of 40 threads
    // hold exactly what they should is the healthy case, and printing all 38 buries the two.
    outcomes: outcomes.filter((o: SweepOutcome) => o.action !== "holds" && o.action !== "skipped"),
  });
}

export async function POST(request: Request): Promise<Response> {
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  return run(request, dry);
}

/** GET is always dry. A sweep that writes should be something a caller asked for on purpose. */
export async function GET(request: Request): Promise<Response> {
  return run(request, true);
}
