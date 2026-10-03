export const runtime = "nodejs";
export const maxDuration = 15;

// The TV's tick. Writes and deletes feed_marks rows with mark = 'checked' and nothing
// else; see app/lib/feed/check.ts.

import { authorizeAction } from "../../../lib/apiAuth";
import { applyCheck } from "../../../lib/feed/check";
import { addMark, removeCheck } from "../../../lib/feed/marksDb";

export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const r = await applyCheck(body, caller.actor ?? "unknown", { addMark, removeCheck });
    return Response.json(r.body, { status: r.status });
  } catch (err) {
    console.error("[feed/check] failed", err);
    return Response.json({ ok: false, error: "could not save the tick" }, { status: 500 });
  }
}
