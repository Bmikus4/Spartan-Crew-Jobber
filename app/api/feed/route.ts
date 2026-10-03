export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// The office TV's feed. GET only, and it writes nothing but the feed's own marks
// (app/lib/feed/marksDb.ts) — never conversation_state, OnSinch or Gmail.
//
// GUARDED like every read route (test/writeRoutesAuthorised.ts): it answers with client
// company names and order numbers.

import { authorizeAction } from "../../lib/apiAuth";
import { serveFeed } from "../../lib/feed/serve";
import { liveFeedDeps } from "../../lib/feed/live";

export async function GET(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const r = await serveFeed(liveFeedDeps(), Date.now());
  return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
}
