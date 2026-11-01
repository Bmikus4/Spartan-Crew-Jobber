export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

// The TV's history (lib/feed/history.ts). GET only, it writes nothing. Without `at`: every moment a list was kept;
// with `at` (an ISO time): the list as it stood then. GUARDED like the feed: it answers with client names and orders.

import { neon } from "@neondatabase/serverless";
import { authorizeAction } from "../../../lib/apiAuth";
import { keptTimes, listAt } from "../../../lib/feed/history";

export async function GET(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sql = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim());
  const at = new URL(request.url).searchParams.get("at");
  try {
    if (!at) return Response.json({ ok: true, times: await keptTimes(sql) }, { headers: { "cache-control": "no-store" } });
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return Response.json({ ok: false, error: "at is not a time" }, { status: 400 });
    const list = await listAt(sql, t);
    return Response.json({ ok: true, list }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[feed/history] failed", err);
    // A failed read is a 500, never an empty list.
    return Response.json({ ok: false, error: "the history could not be read" }, { status: 500 });
  }
}
