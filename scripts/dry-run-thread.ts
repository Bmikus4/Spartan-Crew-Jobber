// ============================================================================
// Run the REAL engine over a REAL thread, writing nothing anywhere.
// ----------------------------------------------------------------------------
// Ben's open question was whether the classifier needs "a new brain". It could
// never be answered before, for two reasons: the classifier node was pinned to a
// model that no longer exists, so it had never run; and once it did run, every
// message reached the engine with the sender and subject blank, so the engine was
// judging headerless bodies and reading Spartan's own replies as client mail.
//
// Both are fixed. This replays stored n8n execution data through the fixed
// payload builder and then through the actual pipeline, with:
//   - the real reasoner (this costs OpenRouter tokens)
//   - the real OnSinch client, for company/user LOOKUPS only
//   - an in-memory store and metrics, so the database is untouched
//   - an executor that THROWS if anything tries to write an order or a draft
//
// So the output is the engine's genuine judgement on real mail, and it cannot
// create an order, a reply draft, or a database row.
//
//   npx tsx scripts/dry-run-thread.ts                 # last 3 replayable executions
//   npx tsx scripts/dry-run-thread.ts 300324
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { coerceThread } from "../app/lib/engine/intake";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY };
const argv = process.argv.slice(2);
const ONE = argv.find((a) => /^\d+$/.test(a));

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

/** Writes are not merely skipped - they are made impossible. */
const noWrites: Executor = {
  async createReplyDraft() { throw new Error("DRY RUN: refused to create a Gmail draft"); },
  async createOrder() { throw new Error("DRY RUN: refused to write an order to OnSinch"); },
  async patchOrder() { throw new Error("DRY RUN: refused to patch an order in OnSinch"); },
};

function deps(): PipelineDeps {
  const client = new OnsinchClient(
    httpTransport({
      baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1",
      apiKey: requireEnv("ONSINCH_API_KEY"),
    })
  );
  return {
    reasoner: createOpenRouterReasoner({
      apiKey: requireEnv("OPENROUTER_API_KEY"),
      model: process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.8",
    }),
    onsinch: client,
    store: new InMemoryStore(),
    metrics: new InMemoryMetrics(),
    settings: { ...DEFAULT_SETTINGS }, // draft-only, replies off - the real defaults
    repliesEnabled: false,
    seededRateCard: async () => null,
    executor: noWrites,
    now: () => Date.now(),
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  } as PipelineDeps;
}

async function main() {
  const ids: string[] = ONE
    ? [ONE]
    : (await (await fetch(`${BASE}/executions?workflowId=${WF}&limit=20`, { headers: h })).json()).data
        .filter((e: any) => e.status === "success")
        .map((e: any) => String(e.id));

  const d = deps();
  const seenThreads = new Set<string>();
  let done = 0;

  for (const id of ids) {
    if (!ONE && done >= 3) break;
    const ex = await (await fetch(`${BASE}/executions/${id}?includeData=true`, { headers: h })).json();
    const runData = ex?.data?.resultData?.runData || {};
    if (!runData["Get a thread2"]) continue;

    let payload: any;
    try {
      payload = buildPayload(runData, runData["Combine all Email Data"]?.[0]?.data?.main?.[0]?.[0]?.json || {});
    } catch (err) {
      console.log(`\n${id}: could not rebuild payload — ${(err as Error).message}`);
      continue;
    }
    // Prefer the longest version of a thread; a shorter earlier run adds nothing.
    if (seenThreads.has(payload.thread_id)) continue;
    seenThreads.add(payload.thread_id);

    const thread = coerceThread(payload);
    if (!thread) { console.log(`\n${id}: payload did not satisfy the intake contract`); continue; }
    done++;

    console.log(`\n${"=".repeat(76)}`);
    console.log(`execution ${id}  thread ${thread.thread_id}  ${thread.messages.length} message(s)`);
    console.log(`  subject   ${thread.messages[0]?.subject}`);
    console.log(`  from      ${thread.messages.map((m) => `${m.from}${m.is_from_spartan ? " (spartan)" : ""}`).join(", ")}`);
    const verdict = String(runData["Determine if Order"]?.[0]?.data?.main?.[0]?.[0]?.json?.message?.content || "");
    console.log(`  n8n said  is_job=${/is_job:\s*(\w+)/.exec(verdict)?.[1]} type_job=${/type_job:\s*(\w+)/.exec(verdict)?.[1]}`);

    try {
      const s = await handleThread(thread, d);
      console.log(`\n  ENGINE`);
      console.log(`    classification  ${s.classification}`);
      console.log(`    status          ${s.status}   needs_human=${s.needs_human}   priority=${s.priority}`);
      console.log(`    company         ${s.facts?.company_name ?? "-"}  (onsinch company_id=${s.company_id ?? "-"})`);
      console.log(`    contact         ${s.facts?.contact_email ?? "-"}`);
      console.log(`    venue           ${s.facts?.location_text ?? "-"}`);
      for (const r of s.facts?.requests ?? [])
        console.log(`    request         ${r.date} ${r.start_time ?? "?"}-${r.end_time ?? "?"}  size=${r.size ?? "?"}  ${r.profession_hint ?? ""}  ${String(r.task ?? "").slice(0, 60)}`);
      if (s.desired_order) {
        console.log(`    ORDER staged    ${s.desired_order.slot_teams?.length ?? 0} slot team(s)`);
        for (const st of s.desired_order.slot_teams ?? [])
          console.log(`      slot          ${st.start} -> ${st.end}  crew=${st.people ?? st.count ?? "?"}  prof=${st.profession_id ?? "-"}`);
      } else {
        console.log(`    ORDER staged    none`);
      }
      console.log(`    notes           ${(s.notes ?? []).join(" | ") || "-"}`);
      console.log(`    write attempts  ${JSON.stringify(s.order_action_log ?? [])}`);
    } catch (err) {
      console.log(`\n  ENGINE THREW: ${(err as Error).message}`);
    }
  }
  if (!done) console.log("no replayable execution found.");
}

main().catch((err) => { console.error(err); process.exit(1); });
