// ============================================================================
// Retire the last "Manual" label, thread by thread, without losing a signal.
// ----------------------------------------------------------------------------
// "Manual" was one tag for two different states, which is why Ben replaced it with
// four. The pre-fix production build kept posting it, so 15 threads wear a label
// that no longer means anything specific. Deleting it outright would take the mark
// off ten threads that ARE still waiting on something.
//
// So each thread is read, not assumed:
//   still flagged + holds an order -> "Order Needs Updated"  (the dangerous one: the
//                                      board shows an order, so it looks done)
//   still flagged + holds none     -> "Order Needs Built"
//   no longer flagged              -> the mark is stale; the tag workflow was dead
//                                      when the engine tried to clear it. Just remove.
//
// `needs_label` is written to match, because the engine clears the label the ROW says
// it wears. A row that says null while the mailbox says otherwise leaves a label
// claiming work is outstanding on a thread that is finished.
//
// Reads live, writes only with --apply. The thread list is whatever currently wears
// the label, captured to .tmp-data by gmail-label-admin --threads "Manual".
//   npx tsx scripts/migrate-manual-label.ts            # plan only
//   npx tsx scripts/migrate-manual-label.ts --apply
// ============================================================================
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const APPLY = process.argv.includes("--apply");
const HOOK = "https://samuraisolutions.app.n8n.cloud/webhook/spartan-manual-tag";
const SECRET = requireEnv("N8N_WEBHOOK_SECRET");
const CAPTURE = ".tmp-data/label-admin/Manual-threads.json";

type Plan = { thread_id: string; wants: string | null; why: string };

/**
 * A tag post that n8n answered with an empty 200 is a FAILURE, not a success — that is
 * exactly what a rejected secret produces, and treating it as done would take the old
 * label off without putting the new one on.
 */
async function tag(thread_id: string, label: string, state: "manual" | "cleared"): Promise<void> {
  const res = await fetch(HOOK, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify({ thread_id, label, state }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: unknown };
  if (!res.ok || j.ok !== true) throw new Error(`${state} "${label}" on ${thread_id} did not confirm (HTTP ${res.status})`);
}

(async () => {
  const ids: string[] = JSON.parse(readFileSync(CAPTURE, "utf8")).thread_ids;
  const sql = neon(requireEnv("DATABASE_URL"));
  const rows = (await sql`
    select thread_id, onsinch_order_id, state->>'manual_flagged' mf, state->>'needs_label' nl
    from conversation_state where thread_id = any(${ids})`) as any[];

  const plan: Plan[] = ids.map((id) => {
    const r = rows.find((x) => x.thread_id === id);
    if (!r) return { thread_id: id, wants: null, why: "no state row — the engine does not know this thread" };
    if (r.mf !== "true") return { thread_id: id, wants: null, why: "no longer flagged; stale mark" };
    return r.onsinch_order_id
      ? { thread_id: id, wants: "Order Needs Updated", why: `holds order ${r.onsinch_order_id}` }
      : { thread_id: id, wants: "Order Needs Built", why: "holds no order" };
  });

  for (const p of plan) console.log(`  ${p.thread_id}  ${(p.wants ?? "remove only").padEnd(20)} ${p.why}`);
  const moving = plan.filter((p) => p.wants);
  console.log(`\n  ${moving.length} get a replacement label, ${plan.length - moving.length} lose a stale mark.`);
  if (!APPLY) return console.log("  (plan only — pass --apply to write)");

  // Add the replacement BEFORE removing "Manual": a thread that ends up wearing both for
  // a moment is recoverable, a thread that ends up wearing neither is a silently dropped job.
  for (const p of plan) {
    if (p.wants) {
      await tag(p.thread_id, p.wants, "manual");
      await sql`update conversation_state
        set state = jsonb_set(state, '{needs_label}', ${JSON.stringify(p.wants)}::jsonb, true)
        where thread_id = ${p.thread_id}`;
    }
    await tag(p.thread_id, "Manual", "cleared");
    console.log(`  done ${p.thread_id} -> ${p.wants ?? "(cleared)"}`);
  }
  console.log(`\n  "Manual" is now on no thread. Delete the label itself with:\n` +
    `    node scripts/gmail-label-admin.mjs --delete "Manual" --yes`);
})();
