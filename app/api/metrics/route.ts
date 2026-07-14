export const runtime = "nodejs";
export const maxDuration = 20;

// Read model for the Dashboard (UI-only surface). Aggregates the append-only
// metric_events table into the funnel + headline tiles + a daily series. GET only.

import { metricsSummary } from "../../lib/metricsDb";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(7, parseInt(url.searchParams.get("days") || "90", 10) || 90));
  const m = await metricsSummary(days);
  return Response.json(m);
}
