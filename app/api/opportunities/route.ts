export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// All Opportunities (lib/feed/opportunities.ts). GET only, it writes nothing. Without `id`: every conversation, the
// TV's urgent cards among them; with `id` (a thread): that conversation in full. GUARDED like the feed: it answers
// with client names, emails and orders.

import { neon } from "@neondatabase/serverless";
import { authorizeAction } from "../../lib/apiAuth";
import { liveFeedDeps } from "../../lib/feed/live";
import { listOpportunities, opportunityDetail } from "../../lib/feed/opportunities";

export async function GET(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sql = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim()) as never;
  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id) return Response.json({ ok: true, ...(await opportunityDetail(sql, id)) }, { headers: { "cache-control": "no-store" } });
    const list = await listOpportunities(sql, liveFeedDeps(), Date.now());
    // A failed read is a 500, never an empty list.
    if (!list.ok) return Response.json({ ok: false, error: "the opportunities could not be read" }, { status: 500 });
    return Response.json(list, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[opportunities] failed", err);
    return Response.json({ ok: false, error: "the opportunities could not be read" }, { status: 500 });
  }
}
