export const runtime = "nodejs";
// 300, not 60: a lost order now asks the link judge (up to two 45s calls) for its
// replacement. The batch limit is still sized for the old 60s; see DEFAULT_LIMIT in
// app/lib/routes/reconcile.ts.
export const maxDuration = 300;

// The reconciliation sweep. Re-reads every bound thread against OnSinch and corrects what
// has drifted — see engine/sweep.ts for what it does and engine/reconcile.ts for why a
// read is the only check available.
//
//   POST /api/reconcile            sweep and correct
//   POST /api/reconcile?dry=1      sweep and report, writing nothing
//   GET  /api/reconcile            the same as dry, for a browser
//
// THE SWEEP SPENDS NO MODEL CALLS. Everything it needs is on the state row, so this is safe
// to run on a cadence without a budget conversation. It does spend two OnSinch reads per
// thread, which is why `limit` exists and defaults to something a 60-second function can
// finish. The one exception is engine/retryHeld.ts: an email held for a venue-list outage
// is run again here, at most MAX_RETRIES_PER_RUN a run (one model call each), and only once
// a single read shows the venue list is back. Nothing else redelivers it.
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

// The handler is app/lib/routes/reconcile.ts, where its IO can be injected for tests; the
// gate stays here, where test/machineRouteAuth.ts and the middleware SKIP list look for it.
import { authorizeMachineCall } from "../../lib/apiAuth";
import { runReconcile } from "../../lib/routes/reconcile";

function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function POST(request: Request): Promise<Response> {
  if (!authorizeMachineCall(request).ok) return unauthorized();
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  return runReconcile(request, dry);
}

/** GET is always dry. A sweep that writes should be something a caller asked for on purpose. */
export async function GET(request: Request): Promise<Response> {
  if (!authorizeMachineCall(request).ok) return unauthorized();
  return runReconcile(request, true);
}
