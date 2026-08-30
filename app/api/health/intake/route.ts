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
import { lastInboundAt } from "../../../lib/inboundRawDb";
import { intakeHealth, DEFAULT_QUIET_MINUTES } from "../../../lib/intakeHealth";
import { reportError } from "../../../lib/errorReport";

export async function GET(request: Request): Promise<Response> {
  if (!authorizeMachineCall(request).ok) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const quietMinutes = Math.min(
    24 * 60,
    Math.max(5, parseInt(url.searchParams.get("quiet_minutes") || "", 10) || DEFAULT_QUIET_MINUTES),
  );

  const health = intakeHealth({ lastReceivedAt: await lastInboundAt(), now: Date.now(), quietMinutes });

  if (health.stale) {
    // `where` is constant so every silence in a run shares one fingerprint and collapses into
    // one email per window, however often the schedule asks. The changing minute count lives in
    // `detail`, which is not fingerprinted.
    void reportError({
      route: "intake-quiet",
      where: "health/intake",
      what: health.minutes_since == null ? "no inbound has ever been recorded" : "the intake has gone quiet during working hours",
      detail: `${health.what}. Last inbound: ${health.last_received_at ?? "never"}. Threshold: ${quietMinutes} minutes.`,
    });
  }

  // 200 whatever the verdict: a non-200 here would mean "the check failed", which is a
  // different thing from "the check ran and the answer is bad", and n8n has to tell them apart.
  return Response.json(health);
}
