import { NextResponse } from "next/server";
import { authorizeCronCall } from "../../../lib/apiAuth";
import { backfillBoardLinks, backfillLinks, sweepLinks } from "../../../lib/v2/links";
import { botWrites, retryStopped, retryUnread, sweepUndecided } from "../../../lib/v2/process";
import { replanOpen } from "../../../lib/v2/replan";
import { neon } from "@neondatabase/serverless";
import { httpTransport } from "../../../lib/engine/onsinch";
import { getSettings } from "../../../lib/settingsDb";
import { maybeSweep, type OnsinchCall } from "../../../lib/testData";
import { automationPausedFlag } from "../../../lib/paused";
import { markRun } from "../../../lib/runMarks";
import { askLabels, runSync, type SyncStep } from "../../../lib/routes/sync";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The bridge's minute (Ben, 10-13: "Everything should always be synced every minute") [DECISIONS V11]: every
 * order the bot made or changed is followed by its J number, the unlinked are looked for, and writes that stopped
 * before anything was sent are tried again. Every 15 minutes, with the Settings switch and both write keys on,
 * test data is cleared (lib/testData.ts). SPARTAN_PAUSED=1 stops the retries, the undecided sweep and the clear;
 * the link sweeps and the re-plan only read OnSinch and keep the TV true, so they run.
 *
 * GET is the Vercel cron (vercel.json), which then starts the n8n label workflow. POST is the n8n minute
 * schedule, which runs the labels itself; it goes when the switch-over in ADDENDUM R3 retires that schedule.
 * Both are in the middleware SKIP list under /api/bot, so authorizeCronCall here is the only gate
 * (test/machineRouteAuth.ts); once CRON_SECRET is set the intake secret no longer opens it (addendum F3).
 */
async function sync(request: Request, labels: boolean): Promise<Response> {
  if (!authorizeCronCall(request).ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sql = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim());
  const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" }) as unknown as OnsinchCall;
  const steps: SyncStep[] = [
    ["backfilled", () => backfillLinks(sql)],
    ["board", () => backfillBoardLinks(sql)],
    ["sweep", () => sweepLinks(sql)],
    ["retry", () => retryStopped()],
    // A stored client email with no decision is decided, or becomes a card (process.ts sweepUndecided).
    ["undecided", () => sweepUndecided()],
    // An email the reader could not read (a rate limit, a timeout) is read again with backoff (process.ts retryUnread).
    ["unread", () => retryUnread()],
    // The planner again on every open card, against OnSinch now (Ben approved 10-20): reads only, never a write. [DECISIONS V24]
    ["replan", () => replanOpen(sql)],
    ["testData", () => getSettings()
      .then(async (s) => maybeSweep(sql, t, !!s.test_data_autoclear, { writes: await botWrites() }))
      .then((r) => (typeof r === "string" ? r : { orders: r.orders.length, companies: r.companies.length, rows: Object.values(r.rows).reduce((a, b) => a + b, 0), refused: r.refused ?? null, failed: r.failed.length }))],
    // Paused, the labels route refuses to change anything, so the workflow is not started.
    ...(labels && !automationPausedFlag() ? [["labels", askLabels] as SyncStep] : []),
  ];
  const r = await runSync(steps, { mark: markRun });
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

export async function GET(request: Request): Promise<Response> {
  return sync(request, true);
}

export async function POST(request: Request): Promise<Response> {
  return sync(request, false);
}
