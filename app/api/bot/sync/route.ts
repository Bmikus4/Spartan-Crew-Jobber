import { NextResponse } from "next/server";
import { authorizeMachineCall } from "../../../lib/apiAuth";
import { backfillLinks, sweepLinks } from "../../../lib/v2/links";
import { retryStopped } from "../../../lib/v2/process";
import { replanOpen } from "../../../lib/v2/replan";
import { neon } from "@neondatabase/serverless";
import { httpTransport } from "../../../lib/engine/onsinch";
import { getSettings } from "../../../lib/settingsDb";
import { maybeSweep, type OnsinchCall } from "../../../lib/testData";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The bridge's minute (Ben, 10-13: "Everything should always be synced every minute"), called by
 * the n8n workflow "Spartan Sync" (scripts/install-sync-workflow.mjs): every order the bot made or
 * changed is followed by its J number, the unlinked are looked for, and writes that stopped
 * before anything was sent are tried again. Every 15 minutes, with the Settings switch on, test
 * data is cleared (lib/testData.ts). It is in the middleware SKIP list under /api/bot, so
 * the machine secret here is its only gate (test/machineRouteAuth.ts).
 */
export async function POST(request: Request): Promise<Response> {
  if (!authorizeMachineCall(request).ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sql = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim());
  const t0 = Date.now();
  const backfilled = await backfillLinks(sql).catch((e) => `error: ${String(e?.message ?? e).slice(0, 120)}`);
  const sweep = await sweepLinks(sql).catch((e) => ({ error: String(e?.message ?? e).slice(0, 160) }));
  const retry = await retryStopped().catch((e) => ({ error: String(e?.message ?? e).slice(0, 160) }));
  // The planner again on every open card, against OnSinch now (Ben approved 10-20): reads only, never a write.
  const replan = await replanOpen(sql).catch((e) => ({ error: String(e?.message ?? e).slice(0, 160) }));
  const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" }) as unknown as OnsinchCall;
  const testData = await getSettings()
    .then((s) => maybeSweep(sql, t, !!s.test_data_autoclear))
    .then((r) => (typeof r === "string" ? r : { orders: r.orders.length, companies: r.companies.length, rows: Object.values(r.rows).reduce((a, b) => a + b, 0), refused: r.refused ?? null, failed: r.failed.length }))
    .catch((e) => ({ error: String(e?.message ?? e).slice(0, 160) }));
  return NextResponse.json({ ok: true, ms: Date.now() - t0, backfilled, sweep, retry, replan, testData });
}
