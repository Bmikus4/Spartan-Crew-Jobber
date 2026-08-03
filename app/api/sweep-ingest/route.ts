export const runtime = "nodejs";
export const maxDuration = 60;

// Ingest for the 12-month historical sweep of bookings@spartancrew.co.uk.
//
// Separate from /api/n8n-inbound on purpose. That route is the live path: it runs
// the pipeline, spends model calls, and projects onto the Jobs Board. This one only
// STORES, into its own table, so a year of history cannot bury today's work or cost
// a fortune on ingest. The corpus is analysed offline afterwards.
//
//   POST /api/sweep-ingest   { thread_id, messages[] }   -> stores one thread
//   GET  /api/sweep-ingest                              -> progress
//
// Same N8N_WEBHOOK_SECRET as the other machine routes; env only.

import { storeSweptThread, sweepStats } from "../../lib/sweepDb";
import { safeEqual } from "../../lib/safeEqual";

function authorized(request: Request): boolean {
  const secret = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  if (!secret) return true; // not configured yet — matches the other intake routes
  return safeEqual(request.headers.get("x-webhook-secret") || "", secret);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }

  // A sweep may post one thread or a batch of them; accept both so the workflow can
  // choose based on how it pages.
  const items = Array.isArray(payload) ? payload : [payload];
  const results = [];
  for (const item of items) results.push(await storeSweptThread(item));

  const stored = results.filter((r) => r.stored).length;
  return Response.json({
    ok: results.every((r) => r.ok),
    received: items.length,
    stored,
    skipped: items.length - stored, // already held a copy with at least as many messages
    threads: results.map((r) => ({ thread_id: r.thread_id, messages: r.message_count, stored: r.stored, error: r.error })),
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return Response.json({ ok: true, ...(await sweepStats()) });
}
