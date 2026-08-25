// ============================================================================
// One enquiry, captured end to end, with every byte that crossed the wire.
// ----------------------------------------------------------------------------
//   npx tsx sim/corpus-showcase.ts --case=3
//
// The study says how OFTEN things work. This says WHAT one of them looks like: the email
// as the client typed it, the facts the model read out of it, the exact JSON posted to
// OnSinch, and the order that came back — read from the tenant rather than assumed.
//
// It exists because a schema described in prose is a schema nobody can check. Writes to
// TEST company 515 and deletes what it made.
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "../scripts/_env.mjs";
import { OnsinchClient, httpTransport, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { guardReasoner } from "../app/lib/engine/spend";
import { handleThread } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { createOrderWithPlace } from "../app/lib/deps";
import { DEFAULT_SETTINGS, type HydratedThread, type ThreadMessage } from "../app/lib/engine/types";
import type { Executor, PipelineDeps } from "../app/lib/engine/pipeline";
import { createHash } from "node:crypto";
import { loadProfessions } from "./harness";
import { buildRandomCases } from "./randomCases";
import { CONTACT } from "./corpusCases";

loadEnv();
const KEY = requireEnv("ONSINCH_API_KEY");
const AI_KEY = requireEnv("OPENROUTER_API_KEY");
const BASE = onsinchBase();
const MODEL = process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6";
const IDX = Number((process.argv.find((a) => a.startsWith("--case=")) || "--case=3").split("=")[1]);

const OUT = join(import.meta.dirname, "..", ".tmp-data", "corpus-real");
mkdirSync(OUT, { recursive: true });

/** Every call, with its BODY — the thing the study's wire log deliberately leaves out. */
interface Call { method: string; path: string; request?: unknown; status: number; response?: unknown }

(async () => {
  __resetListCache();
  const c = buildRandomCases(100)[IDX];
  const calls: Call[] = [];
  const created: number[] = [];

  const logged: Transport = async (m, p, b) => {
    const r = await httpTransport({ baseUrl: BASE, apiKey: KEY })(m, p, b);
    // GETs are the reference-data reads — hundreds of rows of the client's venue list —
    // so only their shape is kept. The writes are the point.
    calls.push({
      method: m, path: p.split("?")[0], status: r.status,
      request: m === "GET" ? undefined : b,
      response: m === "GET" ? `[${Array.isArray((r.data as { data?: unknown[] })?.data) ? (r.data as { data: unknown[] }).data.length : 0} rows]` : r.data,
    });
    if (m === "POST" && p === "/orders" && r.status === 201) {
      const id = Number((r.data as { data?: { id?: number }[] })?.data?.[0]?.id);
      if (Number.isInteger(id)) created.push(id);
    }
    return r;
  };

  const onsinch = new OnsinchClient(logged);
  const store = new InMemoryStore();
  let clock = 1_800_000_000_000;
  const executor: Executor = {
    async createReplyDraft() { return "no-draft"; },
    async createOrder(order) { return createOrderWithPlace(onsinch, order); },
    async patchOrder(p) {
      const applied: string[] = [];
      const patch: Record<string, unknown> = { id: p.order_id };
      if (p.desired.specification) { patch.specification = p.desired.specification; applied.push("specification"); }
      if (p.desired.intern_name) { patch.intern_name = p.desired.intern_name; applied.push("intern_name"); }
      if (applied.length) await onsinch.patchOrder([patch as { id: number }]);
      return applied;
    },
    async amendOrderInPlace(p) {
      return amendOrderInPlace(onsinch, { order_id: p.order_id, previous: p.previous, desired: p.desired, alreadyCreated: p.alreadyCreated, known: p.known }, { onCreated: p.onCreated });
    },
    async replaceOrder(p) {
      return replaceProvisionalOrder(onsinch, { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted, weCreatedIt: p.weCreatedIt }, { onIntent: p.onIntent, onDeleted: p.onDeleted });
    },
    async identifiersForOrder(order_id) {
      const live = (await onsinch.orderById(order_id)) as { Job?: { id: number }[]; number?: string } | null;
      const job = Array.isArray(live?.Job) ? live?.Job?.[0] : (live?.Job as { id: number } | undefined);
      return { job_id: job?.id, order_number: live?.number != null ? String(live.number) : undefined };
    },
  };
  const reasoner = guardReasoner(createOpenRouterReasoner({ apiKey: AI_KEY, model: MODEL }), { model: MODEL, label: c.id, limit: 8 });
  const deps: PipelineDeps = {
    reasoner, onsinch, now: () => ++clock, store, metrics: new InMemoryMetrics(), executor,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    professions: loadProfessions(), seededRateCard: async () => 315,
    archiveOrder: async () => 1, recordReplacement: async () => {},
  };

  const m = (id: string, subject: string, body: string, at: string): ThreadMessage => ({
    message_id: id, from: CONTACT, to: ["bookings@spartancrew.co.uk"], date_iso: at, subject, body, is_from_spartan: false,
  });
  const thread = (msgs: ThreadMessage[]): HydratedThread => ({ thread_id: `showcase-${c.id}`, messages: msgs });

  const e1 = m("m1", c.subject, c.body, "2026-08-24T09:00:00Z");
  const s1 = await handleThread(thread([e1]), deps);
  const writes1 = calls.filter((x) => x.method !== "GET");

  let s2: typeof s1 | null = null;
  let writes2: Call[] = [];
  if (c.amend) {
    const before = calls.length;
    s2 = await handleThread(thread([e1, m("m2", c.amend.subject, c.amend.body, "2026-08-24T13:00:00Z")]), deps);
    writes2 = calls.slice(before).filter((x) => x.method !== "GET");
  }

  // The order as the TENANT holds it, not as the engine believes it to be.
  const liveOrder = s1.onsinch_order_id ? await onsinch.orderById(s1.onsinch_order_id) : null;

  const doc = {
    case: { id: c.id, truth: c.truth, amendShape: c.amend?.shape ?? null },
    email1: { subject: c.subject, from: CONTACT, body: c.body },
    email2: c.amend ? { subject: c.amend.subject, body: c.amend.body } : null,
    extracted1: (s1 as { facts?: unknown }).facts,
    composed1: s1.desired_order,
    writes1,
    state1: {
      classification: s1.classification, status: s1.status,
      company_id: s1.company_id, user_id: s1.user_id, place_id: s1.place_id,
      onsinch_order_id: s1.onsinch_order_id, onsinch_order_number: s1.onsinch_order_number,
      onsinch_job_id: s1.onsinch_job_id, last_ordered_team_ids: s1.last_ordered_team_ids,
      notes: s1.notes,
    },
    extracted2: s2 ? (s2 as { facts?: unknown }).facts : null,
    composed2: s2?.desired_order ?? null,
    writes2,
    state2: s2 ? {
      classification: s2.classification, status: s2.status,
      onsinch_order_id: s2.onsinch_order_id, onsinch_order_number: s2.onsinch_order_number,
      last_ordered_team_ids: s2.last_ordered_team_ids,
      action_log: s2.order_action_log, notes: s2.notes,
    } : null,
    liveOrder,
    spend: reasoner.spend(),
  };

  const f = join(OUT, `showcase-${c.id}.json`);
  writeFileSync(f, JSON.stringify(doc, null, 2));
  console.log(`wrote ${f}`);
  console.log(`order ${s1.onsinch_order_id} R${s1.onsinch_order_number} · ${writes1.length} writes on email 1, ${writes2.length} on email 2`);
  console.log(`spend $${(reasoner.spend().estimatedUsd ?? 0).toFixed(4)}`);

  for (const id of [...new Set(created)]) {
    await onsinch.deleteOrders([id]).catch(() => {});
    console.log(`  cleaned #${id}`);
  }
})();
