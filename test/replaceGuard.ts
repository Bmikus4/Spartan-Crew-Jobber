// ============================================================================
// SP-05: the staffing check before delete-and-repost fails closed.
// ----------------------------------------------------------------------------
// attendanceCount read `pagination.count` whatever the status and answered 0 when it was
// missing, and 0 is the one answer that lets a staffed order be deleted and posted again,
// detaching everyone signed on. A failed or count-less read now throws, which the
// rebuild maps to "refusing to rebuild it blind".
//
// Offline.  npx tsx test/replaceGuard.ts
// ============================================================================
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const desired: DesiredOrder = {
  name: "Event Concept @ Tobacco Dock", company_id: 501, user_id: 9001, request_approval: true, pricelist_category_id: 342,
  job_name: "4 at Tobacco Dock on 2026-09-12",
  slot_teams: [{ name: "Crew", profession_id: 1, beginning: "2026-09-12T09:00:00+01:00", end: "2026-09-12T16:00:00+01:00", size: 4, place_id: 304 }],
} as DesiredOrder;

function rig(attendance: { status: number; data: unknown }) {
  const calls: string[] = [];
  const client = new OnsinchClient(async (method, path) => {
    if (method === "GET" && path.startsWith("/attendance")) return attendance as any;
    if (method === "GET" && path.startsWith("/orders")) {
      return { status: 200, data: { data: [{ id: 13632, provisional: true, quote: false, company_id: 501 }], pagination: { pageCount: 1, count: 1 } } };
    }
    calls.push(`${method} ${path}`);
    if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 14001 }] } };
    return { status: 200, data: null };
  });
  const hooks = { onIntent: async () => {}, onDeleted: async () => {} };
  return { client, calls, hooks };
}

async function main() {
  for (const [label, attendance] of [
    ["attendance answers 500", { status: 500, data: { message: "Server Error" } }],
    ["attendance answers {}", { status: 200, data: {} }],
    ["attendance answers a null count", { status: 200, data: { data: [], pagination: { count: null } } }],
  ] as const) {
    console.log(`\n[${label}]`);
    const r = rig(attendance);
    const out = await replaceProvisionalOrder(r.client, { weCreatedIt: true, order_id: 13632, desired }, r.hooks as any);
    ok(out.deleted === false && /blind/.test(out.refused ?? ""), "refused as blind, not deleted", out.refused ?? "no refusal");
    ok(!r.calls.some((c) => c.startsWith("DELETE")), "and no delete was sent", r.calls.join(", "));
  }

  console.log("\n[control: a real 0 still lets an unstaffed draft be rebuilt]");
  {
    const r = rig({ status: 200, data: { data: [], pagination: { pageCount: 1, count: 0 } } });
    const out = await replaceProvisionalOrder(r.client, { weCreatedIt: true, order_id: 13632, desired }, r.hooks as any);
    ok(!/blind/.test(out.refused ?? ""), "not refused as blind", out.refused ?? "no refusal");
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
