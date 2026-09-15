// ============================================================================
// HOW MANY BOUND ORDERS CAN ACTUALLY TAKE AN AMENDMENT IN PLACE?
// ----------------------------------------------------------------------------
// Since 2026-09-14 an order this engine did not raise is never destroyed (replaceOrder.ts,
// rule 4.3). That is only defensible if such an order can be CHANGED, so this counts the
// ones that can.
//
// It runs the real `pairBlocks` against the real recovered ids and the real live shapes,
// and writes nothing at all — no executor exists in this script, and the transport refuses
// any non-GET.
//
// The number to watch is `declined`, and specifically its reasons: each one is a shape of
// order the engine can see, holds a thread for, and cannot correct. Those are the threads
// that will only ever get the "Order Needs Updated" label.
//
//   npx tsx scripts/amendability-dry-run.ts [limit]
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { pairBlocks, type LiveBlock } from "../app/lib/engine/amendOrder";
import { readLiveShape } from "../app/lib/engine/reconcile";
import { reconcileTarget } from "../app/lib/engine/sweep";
import type { ConversationState } from "../app/lib/engine/types";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const base = (process.env.ONSINCH_BASE_URL || "").replace(/\/$/, "");
const key = (process.env.ONSINCH_API_KEY || "").trim();
const onsinch = new OnsinchClient(async (method, path) => {
  if (method !== "GET") throw new Error(`DRY RUN: tried to ${method} ${path}`);
  const r = await fetch(base + path, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  return { status: r.status, data: r.ok ? await r.json() : null };
});

(async () => {
  const limit = Number(process.argv[2]) || 60;
  const rows = (await sql`select state from conversation_state order by updated_at desc`) as Array<{ state: any }>;
  const bound = rows
    .map((r) => (typeof r.state === "string" ? JSON.parse(r.state) : r.state) as ConversationState)
    .filter((s) => Number(s?.onsinch_order_id) > 0);

  let ours = 0, theirs = 0, gone = 0, noShape = 0, pairable = 0, declined = 0;
  const why: Record<string, number> = {};

  for (const s of bound.slice(0, limit)) {
    const order_id = Number(s.onsinch_order_id);
    const target = reconcileTarget(s);
    if (!target) { noShape++; continue; }

    const live = await readLiveShape(onsinch, order_id);
    if (live.unreadable) { gone++; continue; }

    const weMade = (s.order_action_log ?? []).some(
      (a) => a.ok && (a.kind === "create" || a.kind === "replace") && Number(a.order_id) === order_id
    );
    if (weMade) { ours++; continue; }
    theirs++;

    // The same two sources amendOrderInPlace uses, in the same order.
    const read = await onsinch.slotTeamsForOrder(order_id).catch(() => ({ teams: [] as Array<{ id: number; name: string }> }));
    const blocks: LiveBlock[] = read.teams.map((t) => {
      const seen = live.teams.get(t.id);
      return seen ? { ...t, beginning: seen.beginning, profession_id: seen.profession_id } : t;
    });

    const p = pairBlocks(target.slot_teams ?? [], blocks);
    if (p.declined) {
      declined++;
      const k = p.declined.replace(/\d+/g, "N").slice(0, 70);
      why[k] = (why[k] ?? 0) + 1;
    } else pairable++;
  }

  console.log(`\nbound threads scored: ${Math.min(limit, bound.length)} of ${bound.length}`);
  console.log(`  no recorded shape            ${noShape}`);
  console.log(`  order gone / unreadable      ${gone}`);
  console.log(`  we raised it (rebuild path)  ${ours}`);
  console.log(`  STAFF raised it              ${theirs}`);
  console.log(`     can be amended in place   ${pairable}`);
  console.log(`     cannot be paired          ${declined}`);
  if (Object.keys(why).length) {
    console.log(`\n--- why a staff-raised order could not be paired ---`);
    for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
  }
})();
