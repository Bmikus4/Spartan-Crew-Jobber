export const runtime = "nodejs";
export const maxDuration = 30;

// Read model for the dashboard's "Needs Follow-Up" row. GET only; computes nothing
// it could not recompute, writes nothing, and holds no state of its own.
//
// GUARDED, as every read route now is (test/writeRoutesAuthorised.ts [6]). This one
// answers with client names, company names and the first line of a client's own
// email — the most identifying payload any read route here returns.

import { authorizeAction } from "../../lib/apiAuth";
import { followupBoard } from "../../lib/followup/board";

export async function GET(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const board = await followupBoard();
    return Response.json({ ok: true, ...board });
  } catch (err) {
    /**
     * A FAILED REQUEST MUST NOT READ AS "NOTHING OUTSTANDING". An empty list and a
     * broken query look identical on a dashboard, and the empty one is reassuring —
     * which is the wrong way round for the failure that matters. The status code and
     * the flag both say so, and the UI renders an error rather than "all caught up".
     */
    console.error("[followups] board failed", err);
    return Response.json(
      { ok: false, error: "could not read follow-ups" },
      { status: 500 }
    );
  }
}
