// ============================================================================
// THE RECONCILIATION SWEEP, AGAINST THE LIVE TENANT, WRITING NOTHING.
// ----------------------------------------------------------------------------
// Runs the same `reconcileThread` the route runs, with every write path removed rather
// than merely unused — the executor's write methods throw and the store drops its puts, so
// a branch that tries to change something fails loudly instead of quietly altering a live
// order.
//
// Spends no model calls. Two OnSinch reads per thread.
//
//   npx tsx scripts/sweep-dry-run.ts [limit]
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { reconcileThread, type SweepOutcome } from "../app/lib/engine/sweep";
import type { ConversationState } from "../app/lib/engine/types";
import type { PipelineDeps } from "../app/lib/engine/pipeline";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const base = (process.env.ONSINCH_BASE_URL || "").replace(/\/$/, "");
const key = (process.env.ONSINCH_API_KEY || "").trim();

/** Reads only. A write reaching here is a bug in the sweep, so it throws. */
const onsinch = new OnsinchClient(async (method, path, body) => {
  if (method !== "GET") throw new Error(`DRY RUN: the sweep tried to ${method} ${path} ${JSON.stringify(body)?.slice(0, 200)}`);
  const r = await fetch(base + path, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  return { status: r.status, data: r.ok ? await r.json() : null };
});

/**
 * The executor RECORDS instead of writing, rather than throwing.
 *
 * Throwing turned every drifted thread into an "error" and hid the one thing worth
 * seeing — what actually differs. Nothing reaches OnSinch either way: the executor is
 * the only thing that would call the transport, and the transport above refuses any
 * non-GET regardless, so that guard is still the backstop and this is only about what
 * the report can say.
 */
const attempted: string[] = [];
const deps = {
  onsinch,
  now: () => Date.now(),
  store: { get: async () => undefined, put: async () => {}, all: async () => [] },
  executor: {
    async patchOrder(p: any) { attempted.push(`patchOrder #${p.order_id}`); return []; },
    async amendOrderInPlace(p: any) {
      attempted.push(`amend #${p.order_id}`);
      return { amended: { order_id: p.order_id, patched: 0, added: [] } };
    },
  },
} as unknown as PipelineDeps;

(async () => {
  const limit = Number(process.argv[2]) || 60;
  const rows = (await sql`select thread_id, state from conversation_state order by updated_at desc`) as Array<{ thread_id: string; state: any }>;
  const states = rows
    .map((r) => (typeof r.state === "string" ? JSON.parse(r.state) : r.state) as ConversationState)
    .filter((s) => Number(s?.onsinch_order_id) > 0);

  console.log(`bound threads: ${states.length}; sweeping ${Math.min(limit, states.length)}`);

  const todayISO = new Date().toISOString();
  const outcomes: SweepOutcome[] = [];
  for (const s of states.slice(0, limit)) {
    try {
      // A deep copy, so a branch that mutates state cannot leak between threads or back
      // into anything that might later be persisted.
      outcomes.push(await reconcileThread(JSON.parse(JSON.stringify(s)), deps, { todayISO }));
    } catch (err: any) {
      outcomes.push({ thread_id: s.thread_id, action: "error", detail: String(err?.message ?? err) });
    }
  }

  const tally: Record<string, number> = {};
  for (const o of outcomes) tally[o.action] = (tally[o.action] ?? 0) + 1;
  console.log("\n" + Object.entries(tally).map(([k, v]) => `  ${k.padEnd(14)} ${v}`).join("\n"));

  for (const kind of ["reasserted", "rebound", "lost", "unreconciled", "error"] as const) {
    const rows = outcomes.filter((o) => o.action === kind);
    if (!rows.length) continue;
    console.log(`\n--- ${kind} (${rows.length}) ---`);
    for (const o of rows.slice(0, 15)) console.log(`   ${o.thread_id.slice(0, 12)}  #${o.order_id}  ${String(o.detail ?? "").slice(0, 180)}`);
    if (rows.length > 15) console.log(`   ... and ${rows.length - 15} more`);
  }

  // The skips are the quiet half and worth seeing once: a sweep that skips everything is
  // not a healthy sweep, it is a sweep that is not running.
  const why: Record<string, number> = {};
  for (const o of outcomes.filter((o) => o.action === "skipped")) {
    const k = String(o.detail ?? "").split("—")[0].trim().slice(0, 60);
    why[k] = (why[k] ?? 0) + 1;
  }
  if (Object.keys(why).length) {
    console.log(`\n--- why threads were skipped ---`);
    for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
  }
})();
