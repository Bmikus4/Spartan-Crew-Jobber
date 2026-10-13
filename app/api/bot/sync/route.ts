import { NextResponse } from "next/server";
import { authorizeMachineCall } from "../../../lib/apiAuth";
import { backfillLinks, sweepLinks } from "../../../lib/v2/links";
import { retryStopped } from "../../../lib/v2/process";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The bridge's minute (Ben, 10-13: "Everything should always be synced every minute"), called by
 * the n8n workflow "Spartan Sync" (scripts/install-sync-workflow.mjs): every order the bot made or
 * changed is followed by its J number, the unlinked are looked for, and writes that stopped
 * before anything was sent are tried again. It is in the middleware SKIP list under /api/bot, so
 * the machine secret here is its only gate (test/machineRouteAuth.ts).
 */
export async function POST(request: Request): Promise<Response> {
  if (!authorizeMachineCall(request).ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sql = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim());
  const t0 = Date.now();
  const backfilled = await backfillLinks(sql).catch((e) => `error: ${String(e?.message ?? e).slice(0, 120)}`);
  const sweep = await sweepLinks(sql).catch((e) => ({ error: String(e?.message ?? e).slice(0, 160) }));
  const retry = await retryStopped().catch((e) => ({ error: String(e?.message ?? e).slice(0, 160) }));
  return NextResponse.json({ ok: true, ms: Date.now() - t0, backfilled, sweep, retry });
}
