import { NextResponse } from "next/server";
import { authorizeBotCall } from "../../../lib/apiAuth";
import { runCanary } from "../../../lib/v2/bot/canary";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Walks every contracted OnSinch screen on TEST without saving; 200 with tier ok|warn|block. */
export async function GET(req: Request) {
  if (!authorizeBotCall(req).ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runCanary());
  } catch (e) {
    return NextResponse.json({ tier: "block", error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
