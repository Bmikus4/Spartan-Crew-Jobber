// ============================================================================
// WHY A STAFF-RAISED ORDER COULD NOT BE PAIRED — the actual blocks, side by side.
// ----------------------------------------------------------------------------
// `amendability-dry-run.ts` counts the refusals. This prints the two block sets that
// produced them, because a count tells you how many and never which shape of problem.
//
// Read-only: the transport refuses any non-GET.
//   npx tsx scripts/why-unpairable.ts [howMany] [limit]
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
const onsinch = new OnsinchClient(async (m, p) => {
  if (m !== "GET") throw new Error(`DRY RUN: tried to ${m} ${p}`);
  const r = await fetch(base + p, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  return { status: r.status, data: r.ok ? await r.json() : null };
});

(async () => {
  const howMany = Number(process.argv[2]) || 4;
  const limit = Number(process.argv[3]) || 120;
  const rows = (await sql`select state from conversation_state order by updated_at desc`) as Array<{ state: any }>;
  const bound = rows
    .map((r) => (typeof r.state === "string" ? JSON.parse(r.state) : r.state) as ConversationState)
    .filter((s) => Number(s?.onsinch_order_id) > 0);

  let shown = 0;
  for (const s of bound.slice(0, limit)) {
    if (shown >= howMany) break;
    const id = Number(s.onsinch_order_id);
    const target = reconcileTarget(s);
    if (!target) continue;
    const live = await readLiveShape(onsinch, id);
    if (live.unreadable) continue;
    const weMade = (s.order_action_log ?? []).some(
      (a) => a.ok && (a.kind === "create" || a.kind === "replace") && Number(a.order_id) === id
    );
    if (weMade) continue;

    const read = await onsinch.slotTeamsForOrder(id).catch(() => ({ teams: [] as Array<{ id: number; name: string }> }));
    const blocks: LiveBlock[] = read.teams.map((t) => {
      const seen = live.teams.get(t.id);
      return seen ? { ...t, beginning: seen.beginning, profession_id: seen.profession_id } : t;
    });
    const p = pairBlocks(target.slot_teams ?? [], blocks);
    if (!p.declined) continue;
    shown++;

    console.log(`\n#${id}  ${s.thread_id.slice(0, 12)}  "${String(s.subject ?? "").slice(0, 52)}"`);
    console.log(`  DECLINED: ${p.declined}`);
    console.log(`  the thread asks for ${(target.slot_teams ?? []).length} block(s):`);
    for (const b of target.slot_teams ?? []) {
      console.log(`    day=${String(b.beginning).slice(0, 10)} place=${b.place_id} prof=${b.profession_id} size=${b.size} "${String(b.name).slice(0, 28)}"`);
    }
    console.log(`  the order holds ${blocks.length} block(s):`);
    for (const b of blocks) {
      console.log(`    id=${b.id} day=${String(b.beginning ?? "?").slice(0, 10)} prof=${b.profession_id ?? "?"} "${String(b.name).slice(0, 28)}"`);
    }
  }
  if (!shown) console.log("no declined pairings in the window scanned");
})();
