export const runtime = "nodejs";
export const maxDuration = 60;

// Confirm a staged order — the dashboard confirm queue's one-click approve in
// draft-only mode. POST { thread_id }. Idempotent: a thread with no pending
// order is a no-op.

import { confirmOrder } from "../../lib/engine/pipeline";
import { buildDeps } from "../../lib/deps";
import { upsertTicketFromState } from "../../lib/ticketsDb";
import { authorizeAction } from "../../lib/apiAuth";

export async function POST(request: Request): Promise<Response> {
  // A signed-in human OR n8n. This used to demand the webhook secret only, so
  // the Jobs Board's one-click confirm - the entire point of draft-only mode -
  // got a 401 from the browser, which sends a session cookie and no secret.
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let body: { thread_id?: string };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const thread_id = String(body.thread_id ?? "").trim();
  if (!thread_id) return Response.json({ ok: false, error: "thread_id required" }, { status: 400 });

  try {
    const deps = await buildDeps();
    const state = await confirmOrder(thread_id, deps);
    if (!state) return Response.json({ ok: false, error: "thread not found" }, { status: 404 });
    await upsertTicketFromState(state); // reflect the confirm on the tickets board
    return Response.json({
      ok: true, thread_id, status: state.status,
      onsinch_order_id: state.onsinch_order_id ?? null,
      confirmed_by: caller.actor, // who approved it, for the audit trail
      notes: state.notes,
    });
  } catch (err) {
    console.error("[confirm-order] failed", err);
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
