export const runtime = "nodejs";
export const maxDuration = 20;

// Read model for the Dashboard (UI-only surface). Aggregates the append-only
// metric_events table into the funnel + headline tiles + a daily series. GET only.

import { metricsSummary } from "../../lib/metricsDb";
import { authorizeAction } from "../../lib/apiAuth";

export async function GET(request: Request): Promise<Response> {
  // Its own check, not only middleware's: that one is a single env switch away from off.
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(7, parseInt(url.searchParams.get("days") || "90", 10) || 90));
  const m = await metricsSummary(days);
  return Response.json(m);
}
