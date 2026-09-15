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
// Same N8N_WEBHOOK_SECRET as the other machine routes, and the same rule: a deployment
// with the database but no secret is NOT open.

import { buildDeps } from "../../lib/deps";
import { NeonStateStore } from "../../lib/stateDb";
import { sweepAll, type SweepOutcome } from "../../lib/engine/sweep";
import { authorizeMachineCall } from "../../lib/apiAuth";

const DEFAULT_LIMIT = 40;

async function run(request: Request, dry: boolean): Promise<Response> {
  if (!authorizeMachineCall(request).ok) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  const store = new NeonStateStore();
  const states = (await store.all()).filter((s) => Number(s.onsinch_order_id) > 0);
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

  const { swept, outcomes } = await sweepAll(states, sandboxed as typeof deps, {
    todayISO: new Date().toISOString(),
    limit,
  });

  const tally: Record<string, number> = {};
  for (const o of outcomes) tally[o.action] = (tally[o.action] ?? 0) + 1;

  return Response.json({
    ok: true,
    dry,
    bound_threads: states.length,
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
