// ============================================================================
// The rig both corpus runs share: a real OnSinch client, the production executor, and
// the deps `handleThread` needs.
// ----------------------------------------------------------------------------
// ONE COPY, because the scripted run and the model run must exercise the SAME engine.
// Two executors would eventually differ in some small way and the two studies would stop
// being comparable — and the first version of the scripted executor had already drifted:
// it reimplemented the two-phase create without its rollback and left half-built orders
// behind, a defect of the harness that read as a defect of the engine.
//
// Every order id is ledgered FROM THE WIRE, so an order that exists is an order cleanup
// knows about, whichever code path made it and whether or not that path rolled it back.
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient, httpTransport, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { createOrderWithPlace } from "../app/lib/deps";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import type { Executor, PipelineDeps } from "../app/lib/engine/pipeline";
import type { Reasoner } from "../app/lib/engine/reason";
import { loadProfessions } from "./harness";

export interface Rig {
  onsinch: OnsinchClient;
  deps: PipelineDeps;
  store: InMemoryStore;
  wire: string[];
  /** The job's window, the only field derived from the blocks and so the only oracle. */
  windowOf: (id?: number) => Promise<string | undefined>;
}

export function buildRig(opts: {
  baseUrl: string;
  apiKey: string;
  reasoner: Reasoner;
  onOrderCreated: (id: number) => void;
}): Rig {
  const wire: string[] = [];
  const logged: Transport = async (m, p, b) => {
    const r = await httpTransport({ baseUrl: opts.baseUrl, apiKey: opts.apiKey })(m, p, b);
    if (m !== "GET") wire.push(`${m} ${p} -> ${r.status}`);
    if (m === "POST" && p === "/orders" && r.status === 201) {
      const id = Number((r.data as { data?: { id?: number }[] })?.data?.[0]?.id);
      if (Number.isInteger(id)) opts.onOrderCreated(id);
    }
    return r;
  };
  const onsinch = new OnsinchClient(logged);
  const store = new InMemoryStore();
  let clock = 1_800_000_000_000;

  const executor: Executor = {
    async createReplyDraft() { return "no-draft"; },
    // THE PRODUCTION FUNCTION, not a copy of it. A study that reimplements the thing it
    // is measuring measures the reimplementation.
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
      return amendOrderInPlace(
        onsinch,
        { order_id: p.order_id, previous: p.previous, desired: p.desired, alreadyCreated: p.alreadyCreated, known: p.known },
        { onCreated: p.onCreated },
      );
    },
    async replaceOrder(p) {
      return replaceProvisionalOrder(
        onsinch,
        { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted, weCreatedIt: p.weCreatedIt },
        { onIntent: p.onIntent, onDeleted: p.onDeleted },
      );
    },
    async identifiersForOrder(order_id) {
      const live = (await onsinch.orderById(order_id)) as { Job?: { id: number }[]; number?: string } | null;
      const job = Array.isArray(live?.Job) ? live?.Job?.[0] : (live?.Job as { id: number } | undefined);
      return { job_id: job?.id, order_number: live?.number != null ? String(live.number) : undefined };
    },
  };

  const deps: PipelineDeps = {
    reasoner: opts.reasoner, onsinch, now: () => ++clock, store,
    metrics: new InMemoryMetrics(), executor, settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    professions: loadProfessions(),
    // Pinned, so a case measures the booking rather than the rate-card hold: the test
    // company has no order history, and a derived card would stage every thread for a
    // click before it ever reached the write.
    seededRateCard: async () => 315,
    archiveOrder: async () => 1,
    recordReplacement: async () => {},
  };

  const windowOf = async (id?: number) => {
    if (!id) return undefined;
    const live = (await onsinch.orderById(id)) as { Job?: { min_beginning?: string; max_end?: string }[] } | null;
    const job = Array.isArray(live?.Job) ? live?.Job?.[0] : undefined;
    if (!job?.min_beginning) return undefined;
    return `${String(job.min_beginning).slice(0, 16)}..${String(job.max_end).slice(0, 16)}`;
  };

  return { onsinch, deps, store, wire, windowOf };
}
