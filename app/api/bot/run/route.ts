import { NextResponse } from "next/server";
import { authorizeBotCall } from "../../../lib/apiAuth";
import { runOp } from "../../../lib/v2/bot/run";
import type { Op } from "../../../lib/v2/bot/ops";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Runs one operation: POST {source, op}. TEST company 515 only: live writes to Spartan
 * Crew's clients wait for the cutover bar and Ben's sign-off, so there is no switch here.
 */
export async function POST(req: Request) {
  if (!authorizeBotCall(req).ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { source?: string; op?: Op } | null;
  if (!body?.source || !body?.op?.kind) return NextResponse.json({ error: "body must be {source, op}" }, { status: 400 });
  return NextResponse.json(await runOp(body.source, body.op, { testOnly: true }));
}
