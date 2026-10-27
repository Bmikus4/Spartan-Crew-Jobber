import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { authorizeAction } from "../../lib/apiAuth";
import { httpTransport } from "../../lib/onsinch/onsinch";
import { planTestData, clearTestData, lastClear, type OnsinchCall } from "../../lib/testData";

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
    if (body?.action === "clear") return NextResponse.json({ ok: true, result: await clearTestData(sql, t, "button") });
    return NextResponse.json({ ok: false, error: "action must be preview or clear" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
