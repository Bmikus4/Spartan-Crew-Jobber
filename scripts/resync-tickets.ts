// ============================================================================
// Re-project every ticket from its conversation_state, and re-sync the
// denormalised status column.
// ----------------------------------------------------------------------------
// conversation_state.state is the single source of truth. Two things copy from
// it: the `status`/`needs_human`/`onsinch_order_id` columns on the same row, and
// the `tickets` row the Jobs Board reads. Any direct UPDATE of `state` leaves
// both behind - which is how the OnSinch-notifier threads stayed on the board as
// confirmable after they had been correctly retired, and how a genuinely staged
// patch ended up with no ticket at all and therefore invisible.
//
// Writing through store.put + upsertTicketFromState brings all three into line.
// Idempotent: safe to re-run any time, and a no-op once everything agrees.
//
//   npx tsx scripts/resync-tickets.ts            # report the drift only
//   npx tsx scripts/resync-tickets.ts --apply
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";
import { NeonStateStore } from "../app/lib/stateDb";
import { upsertTicketFromState } from "../app/lib/ticketsDb";
import type { ConversationState } from "../app/lib/engine/types";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");

async function main() {
  const store = new NeonStateStore();
  const states = (await sql`SELECT thread_id, status AS col_status, state FROM conversation_state`) as
    { thread_id: string; col_status: string | null; state: ConversationState }[];
  const tickets = (await sql`SELECT thread_id, status, classification, onsinch_order_id FROM tickets`) as
    { thread_id: string; status: string; classification: string; onsinch_order_id: number | null }[];
  const byThread = new Map(tickets.map((t) => [t.thread_id, t]));
  const orderOwner = new Map<number, string>();
  for (const t of tickets) if (t.onsinch_order_id != null) orderOwner.set(Number(t.onsinch_order_id), t.thread_id);

  const drift: Array<{ thread_id: string; why: string; state: ConversationState }> = [];
  for (const r of states) {
    const s = r.state;
    const t = byThread.get(r.thread_id);
    const reasons: string[] = [];
    if (r.col_status !== s.status) reasons.push(`column ${r.col_status} != state ${s.status}`);
    if (!t) reasons.push("no ticket at all — invisible on the board");
    else {
      if (t.status !== s.status) reasons.push(`ticket status ${t.status} != ${s.status}`);
      if (t.classification !== s.classification) reasons.push(`ticket class ${t.classification} != ${s.classification}`);
    }
    if (reasons.length) drift.push({ thread_id: r.thread_id, why: reasons.join("; "), state: s });
  }

  console.log(`threads: ${states.length}   tickets: ${tickets.length}   drifted: ${drift.length}\n`);
  for (const d of drift) {
    // A ticket can only hold one order (unique partial index), so flag a clash
    // rather than letting the upsert swallow it.
    const oid = d.state.onsinch_order_id;
    const clash = oid != null && orderOwner.has(Number(oid)) && orderOwner.get(Number(oid)) !== d.thread_id;
    console.log(`  ${d.thread_id}`);
    console.log(`     ${d.why}`);
    if (clash) console.log(`     WARNING: order #${oid} is already on ticket ${orderOwner.get(Number(oid))} — upsert will refuse`);
  }
  if (!drift.length) { console.log("everything agrees — nothing to do."); return; }

  if (!APPLY) { console.log(`\n(report only — re-run with --apply to resync ${drift.length})`); return; }

  let done = 0;
  for (const d of drift) {
    await store.put(d.state);                 // resyncs the columns from state
    await upsertTicketFromState(d.state);     // re-projects the board row
    done++;
  }
  console.log(`\nresynced ${done}. Verifying...`);

  const after = (await sql`
    SELECT c.thread_id
    FROM conversation_state c LEFT JOIN tickets t ON t.thread_id = c.thread_id
    WHERE c.status <> c.state->>'status'
       OR t.thread_id IS NULL
       OR t.status <> c.state->>'status'
       OR t.classification <> c.state->>'classification'`) as { thread_id: string }[];
  console.log(after.length ? `  STILL drifted: ${after.map((r) => r.thread_id).join(", ")}` : "  all three now agree on every thread");
}

main().catch((e) => { console.error(e); process.exit(1); });
