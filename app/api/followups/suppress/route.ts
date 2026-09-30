export const runtime = "nodejs";
export const maxDuration = 15;

// Dismiss (or restore) one follow-up. The only write in the follow-up feature.
//
// GUARDED, and by authorizeAction rather than the machine-only check: the caller is a
// person clicking a button in the dashboard, and their session is how we know who to
// record. Nothing outside the UI has any business suppressing a follow-up.
//
// THE WAIT IS PART OF THE REQUEST, not just the thread. A dismissal names the silence
// it is dismissing (`waiting_since`, the flip point the board showed), so a later wait
// on the same thread is not muted by an older click. See suppressionDb.ts.

import { authorizeAction } from "../../../lib/apiAuth";
import { followupsEnabled } from "../../../lib/followup/enabled";
import { suppress, unsuppress } from "../../../lib/followup/suppressionDb";

export async function POST(request: Request): Promise<Response> {
  if (!followupsEnabled()) return Response.json({ ok: false, error: "not enabled" }, { status: 404 });
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { thread_id?: string; waiting_since?: string; reason?: string; restore?: boolean };
  try { body = await request.json(); }
  catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }

  const thread_id = String(body.thread_id ?? "").trim();
  if (!thread_id) return Response.json({ ok: false, error: "thread_id required" }, { status: 400 });

  if (body.restore) {
    const ok = await unsuppress(thread_id);
    return Response.json({ ok }, { status: ok ? 200 : 500 });
  }

  const waiting_since = String(body.waiting_since ?? "").trim();
  if (!waiting_since) {
    /**
     * REFUSED RATHER THAN DEFAULTED. Suppressing without naming the wait would mute
     * the thread indefinitely, which is the one behaviour this feature is built not
     * to have. A caller that cannot say which silence it means does not get to
     * silence anything.
     */
    return Response.json(
      { ok: false, error: "waiting_since required — a dismissal names the wait it dismisses" },
      { status: 400 }
    );
  }

  // `actor` is the field this codebase already uses for an audit trail.
  const who = caller.actor;
  const ok = await suppress(thread_id, waiting_since, who, String(body.reason ?? "").trim() || null);
  return Response.json({ ok }, { status: ok ? 200 : 500 });
}
