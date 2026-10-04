export const runtime = "nodejs";
export const maxDuration = 60;

// Confirm a staged order — the dashboard confirm queue's one-click approve in
// draft-only mode. POST { thread_id }. Idempotent: a thread with no pending
// order is a no-op.

import { authorizeAction } from "../../lib/apiAuth";
import { handleConfirmOrder } from "../../lib/routes/confirmOrder";

export async function POST(request: Request): Promise<Response> {
  // A signed-in human OR n8n. This used to demand the webhook secret only, so
  // the Jobs Board's one-click confirm - the entire point of draft-only mode -
  // got a 401 from the browser, which sends a session cookie and no secret.
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handleConfirmOrder(request, caller.actor);
}
