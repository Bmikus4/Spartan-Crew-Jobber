export const runtime = "nodejs";
export const maxDuration = 20;
export const dynamic = "force-dynamic";

// The automation's heartbeat, asked by a Vercel cron every 5 minutes (vercel.json), never by n8n
// (DECISIONS O1). What it judges: app/lib/heartbeat.ts. 200 whatever the verdict, as
// /api/health/intake: a non-200 means the check itself failed. Under /api/health in the
// middleware SKIP list, so authorizeCronCall is its only gate (test/machineRouteAuth.ts).

import { authorizeCronCall } from "../../../lib/apiAuth";
import { heartbeat } from "../../../lib/heartbeat";
import { lastInboundAt } from "../../../lib/inboundRawDb";
import { lastRun } from "../../../lib/runMarks";
import { automationPausedFlag } from "../../../lib/paused";
import { reportError } from "../../../lib/errorReport";

export async function GET(request: Request): Promise<Response> {
  if (!authorizeCronCall(request).ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { oldestUndecidedAt } = await import("../../../lib/v2/process");
  return Response.json(await heartbeat({ now: Date.now, paused: () => automationPausedFlag(), lastInboundAt, oldestUndecidedAt, lastRun, report: reportError }));
}
