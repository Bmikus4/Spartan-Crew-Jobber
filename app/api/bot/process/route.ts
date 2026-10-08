import { NextResponse } from "next/server";
import { authorizeBotCall } from "../../../lib/apiAuth";
import { processMessage } from "../../../lib/v2/process";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * One captured email through the rebuild: POST {message_id, execute?}. Without execute it
 * records the decision and writes nothing (shadow). With it, writes go through runOp, which
 * is TEST-only until cutover.
 */
export async function POST(req: Request) {
  if (!authorizeBotCall(req).ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { message_id?: string; execute?: boolean } | null;
  if (!body?.message_id) return NextResponse.json({ error: "body must be {message_id, execute?}" }, { status: 400 });
  try {
    return NextResponse.json(await processMessage(body.message_id, { execute: body.execute === true }));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
