import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { authorizeAction } from "../../lib/apiAuth";
import { httpTransport } from "../../lib/onsinch/onsinch";
import { planTestData, clearTestData, lastClear, type OnsinchCall } from "../../lib/testData";
import { automationPausedFlag } from "../../lib/paused";
import { botWrites } from "../../lib/v2/process";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const deps = () => ({
  sql: neon((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim()),
  t: httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" }) as unknown as OnsinchCall,
});

/** The Settings screen's test-data panel: the last check, and the last clear that removed something. */
export async function GET(request: Request): Promise<Response> {
  if (!(await authorizeAction(request)).ok) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await lastClear(deps().sql)) });
}

/**
 * {action: "preview"} says what a clear would remove and removes nothing; {action: "clear"} removes
 * it. The screen always previews first, so nobody clears without having read the list. Signed-in
 * staff or the webhook secret, the same gate as the settings write.
 */
export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await request.json(); } catch {}
  const { sql, t } = deps();
  try {
    if (body?.action === "preview") {
      const p = await planTestData(sql, t);
      return NextResponse.json({ ok: true, plan: { orders: p.orders, companies: p.companies, threads: p.threads.length, rows: p.rows, kept: p.kept, over: p.over ?? null } });
    }
    if (body?.action === "clear") {
      // THE CLEAR DELETES ORDERS AND COMPANIES IN THE LIVE ONSINCH, so it takes the minute sweep's gates (testData.ts
      // maybeSweep) and the write switches' owner: not while paused, only with both write keys on (O20: production
      // writes nothing to OnSinch while they are off), an admin's alone (A1). Until 3 Nov any signed-in user or the
      // intake secret could run it whatever the switches said.
      if (!caller.admin) return NextResponse.json({ ok: false, error: "only an admin may clear test data" }, { status: 403 });
      if (automationPausedFlag()) return NextResponse.json({ ok: false, error: "the automation is paused: nothing is cleared" }, { status: 409 });
      if (!(await botWrites())) return NextResponse.json({ ok: false, error: "bot writes are off, so nothing is deleted in OnSinch" }, { status: 409 });
      return NextResponse.json({ ok: true, result: await clearTestData(sql, t, "button") });
    }
    return NextResponse.json({ ok: false, error: "action must be preview or clear" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
