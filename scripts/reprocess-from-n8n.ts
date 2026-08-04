// ============================================================================
// Re-drive real threads through the FIXED engine, from this machine.
// ----------------------------------------------------------------------------
// Why this exists: the engine fixes are committed but cannot be deployed - the
// Vercel account is at its 100-deployments-per-day cap, which is account-wide and
// resets on its own. Meanwhile the live Jobs Board holds tickets that were
// decided by the broken path: sender and subject blank, and quote requests
// rejected as not-a-job.
//
// The deployed route is only a thin wrapper around handleThread, and this runs
// the same pipeline with the same Neon store and the same OnSinch client - it
// just runs here, where there is no 60-second function ceiling. So the board can
// be corrected now, and the pending deploy stops being urgent.
//
// Threads come from stored n8n execution data rather than from inbound_raw,
// because the rows in inbound_raw were built by the OLD node body and have the
// blank headers baked in.
//
// DRY RUN BY DEFAULT. --apply writes conversation_state and tickets.
// order_mode stays at the launch default (draft-only), so an order is STAGED for
// human confirm and nothing is ever written to OnSinch. The Gmail executor is
// disabled outright: no draft, no send, ever.
//
//   npx tsx scripts/reprocess-from-n8n.ts            # dry run
//   npx tsx scripts/reprocess-from-n8n.ts --apply
//   npx tsx scripts/reprocess-from-n8n.ts --apply --limit 20
//   npx tsx scripts/reprocess-from-n8n.ts --thread 19fc73c87a9f16ba --apply
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { coerceThread } from "../app/lib/engine/intake";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { NeonStateStore } from "../app/lib/stateDb";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { upsertTicketFromState } from "../app/lib/ticketsDb";
import { getSettings } from "../app/lib/settingsDb";
import { getRateCard } from "../app/lib/rateCardsDb";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY };
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const LIMIT = Number(argv[argv.indexOf("--limit") + 1]) || 30;
// Re-drive ONE thread. Re-driving thirty to correct one costs thirty model calls
// and risks changing tickets nobody asked about, on a live client system.
const ONLY = argv.includes("--thread") ? String(argv[argv.indexOf("--thread") + 1] || "").trim() : "";

const src = readFileSync(join(ROOT_DIR, "n8n", "nodes", "build-engine-payload.js"), "utf8");

function buildPayload(runData: Record<string, any>, tapJson: unknown) {
  const $ = (name: string) => {
    const run = runData[name];
    if (!run) throw new Error(`no node "${name}"`);
    const items = (run[0]?.data?.main?.[0] || []).map((i: any) => i.json);
    if (!items.length) throw new Error(`node "${name}" produced nothing`);
    return { item: { json: items[0] }, all: () => items.map((j: any) => ({ json: j })) };
  };
  return new Function("$", "$json", "Buffer", src)($, tapJson, Buffer)[0].json;
}

/**
 * Orders are STAGED, never written (draft-only), so createOrder should not be
 * reachable. Replies are refused outright rather than left to a setting: this is
 * a backfill, and it must not be able to email a client.
 */
const noWrites: Executor = {
  async createReplyDraft() { throw new Error("reprocess: refused to draft or send a reply"); },
  async createOrder() { throw new Error("reprocess: refused to write an order to OnSinch"); },
  async patchOrder() { throw new Error("reprocess: refused to patch an order in OnSinch"); },
};

/**
 * Neon, but with the idempotency guard defeated on purpose.
 *
 * handleThread returns the stored state untouched when prior.last_message_id
 * already equals the thread's newest client message - correct in production, and
 * exactly wrong here: every thread we want to re-decide is one the broken path
 * already stored, so the guard hands back the bad answer and the ticket upsert
 * writes it straight back. The first --apply run did that and looked like a
 * no-op, which is how it was caught: it disagreed with the dry run.
 *
 * last_message_id is blanked rather than the whole prior state discarded, so an
 * existing onsinch_order_id linkage is not thrown away to force a re-decide.
 */
function reprocessStore(write: boolean): NeonStateStore {
  const real = new NeonStateStore();
  const get = real.get.bind(real);
  real.get = async (thread_id: string) => {
    const prior = await get(thread_id);
    return prior ? { ...prior, last_message_id: "" } : prior;
  };
  // A dry run READS the same prior state and only withholds the write. Giving it
  // an empty store instead is what let the first dry run and the first --apply
  // disagree, and a preview you cannot trust is worse than no preview.
  if (!write) real.put = async () => {};
  return real;
}

async function deps(): Promise<PipelineDeps> {
  const client = new OnsinchClient(
    httpTransport({
      baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1",
      apiKey: requireEnv("ONSINCH_API_KEY"),
    })
  );
  const stored = await getSettings().catch(() => DEFAULT_SETTINGS);
  // Whatever the stored settings say, an OnSinch write is not this script's job.
  const settings = { ...stored, order_mode: "draft-only" as const, replies_enabled: false };
  return {
    reasoner: createOpenRouterReasoner({
      apiKey: requireEnv("OPENROUTER_API_KEY"),
      model: process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6",
    }),
    onsinch: client,
    store: reprocessStore(APPLY),
    metrics: new InMemoryMetrics(),
    settings,
    repliesEnabled: false,
    seededRateCard: async (companyId: number) => (await getRateCard(companyId))?.card ?? null,
    executor: noWrites,
    now: () => Date.now(),
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  } as PipelineDeps;
}

async function main() {
  console.log(APPLY ? "\nAPPLY: conversation_state and tickets WILL be written.\n" : "\nDRY RUN: nothing will be written. Add --apply to commit.\n");

  const list = await (await fetch(`${BASE}/executions?workflowId=${WF}&limit=${LIMIT}`, { headers: h })).json();
  const ids: string[] = (list.data || []).filter((e: any) => e.status === "success").map((e: any) => String(e.id));

  // Newest execution wins per thread: it carries the most complete message list.
  const byThread = new Map<string, any>();
  for (const id of ids) {
    const ex = await (await fetch(`${BASE}/executions/${id}?includeData=true`, { headers: h })).json();
    const runData = ex?.data?.resultData?.runData || {};
    if (!runData["Get a thread2"]) continue;
    let payload: any;
    try {
      payload = buildPayload(runData, runData["Combine all Email Data"]?.[0]?.data?.main?.[0]?.[0]?.json || {});
    } catch { continue; }
    const prev = byThread.get(payload.thread_id);
    if (!prev || (payload.messages?.length ?? 0) > (prev.payload.messages?.length ?? 0)) {
      byThread.set(payload.thread_id, { id, payload });
    }
  }
  if (ONLY) {
    for (const k of [...byThread.keys()]) if (k !== ONLY) byThread.delete(k);
    console.log(`--thread ${ONLY}: ${byThread.size} match(es)`);
    if (!byThread.size) { console.log("that thread is not in the recent executions — raise --limit."); return; }
  }
  console.log(`${byThread.size} distinct thread(s) rebuilt from ${ids.length} execution(s)\n`);

  const d = await deps();
  let processed = 0;
  const summary: string[] = [];

  for (const [thread_id, { id, payload }] of byThread) {
    const thread = coerceThread(payload);
    if (!thread) { console.log(`  ${thread_id}: payload did not satisfy the intake contract (execution ${id})`); continue; }
    try {
      const s = await handleThread(thread, d);
      processed++;
      if (APPLY) await upsertTicketFromState(s);
      const staged = s.pending_order ? `${s.pending_order.kind} ${s.pending_order.desired.slot_teams?.length ?? 0} slot team(s)` : "none";
      console.log(`  ${thread_id}  ${s.classification.padEnd(12)} ${s.status.padEnd(10)} needs_human=${String(s.needs_human).padEnd(5)} company=${s.facts?.company_name ?? "-"}`);
      console.log(`      staged order: ${staged}`);
      if (s.notes?.length) console.log(`      ${s.notes.join(" | ")}`);
      summary.push(`${thread_id} -> ${s.classification}/${s.status}`);
    } catch (err) {
      console.log(`  ${thread_id}  THREW: ${(err as Error).message}`);
    }
  }

  console.log(`\n${processed}/${byThread.size} thread(s) processed.`);
  if (!APPLY) console.log(`(dry run - the live board is unchanged. Re-run with --apply.)`);
  else console.log(`Written to conversation_state + tickets. No OnSinch writes, no replies.`);
  console.log();
}

main().catch((err) => { console.error(err); process.exit(1); });

