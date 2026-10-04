export const runtime = "nodejs";
export const maxDuration = 20;
export const dynamic = "force-dynamic";

// The watchdog's one question: has anything reached the engine lately?
//
// WHY THIS IS A ROUTE AND NOT A CRON INSIDE THE ENGINE. An engine that is not running cannot
// report that it is not running. When the Gmail credential expired on 2026-08-26 nothing here
// threw — the mail simply stopped arriving, and every dashboard stayed green for 42 hours. So
// the question is asked from OUTSIDE, by an n8n Schedule workflow (scripts/build-intake-health-
// workflow.mjs), and this end only answers it.
//
// IT ALSO FILES THE REPORT ITSELF when the answer is bad, so the suppression window and the
// recipient list live in one place rather than being re-implemented on the n8n canvas. n8n's
// own job is the case this cannot cover: THIS ENDPOINT NOT ANSWERING AT ALL. A 500, a timeout
// or a DNS failure is n8n's to alert on, because at that point nothing here can.
//
// GET only, read-only, and gated on the shared machine secret — it is a single MAX() and leaks
// nothing, but an unauthenticated endpoint on this project is how the last two holes started.

import { authorizeMachineCall } from "../../../lib/apiAuth";
import { handleIntakeHealth } from "../../../lib/routes/healthIntake";

export async function GET(request: Request): Promise<Response> {
  if (!authorizeMachineCall(request).ok) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return handleIntakeHealth(request);
}
