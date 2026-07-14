export const runtime = "nodejs";
export const maxDuration = 60;

// Confirm a staged order — the dashboard confirm queue's one-click approve in
// draft-only mode. POST { thread_id }. Idempotent: a thread with no pending
// order is a no-op.

import { confirmOrder } from "../../lib/engine/pipeline";
import { buildDeps } from "../../lib/deps";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-webhook-secret") !== secret) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { thread_id?: string };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const thread_id = String(body.thread_id ?? "").trim();
  if (!thread_id) return Response.json({ ok: false, error: "thread_id required" }, { status: 400 });

  try {
    const deps = await buildDeps();
    const state = await confirmOrder(thread_id, deps);
    if (!state) return Response.json({ ok: false, error: "thread not found" }, { status: 404 });
    return Response.json({ ok: true, thread_id, status: state.status, onsinch_order_id: state.onsinch_order_id ?? null, notes: state.notes });
  } catch (err) {
    console.error("[confirm-order] failed", err);
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
