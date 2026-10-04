// The /api/reconcile handler after its auth gate, with its IO injected so the route's own
// behaviour (dry writes nothing; a live run tickets, stamps, retries and expires) is tested
// (SP-50). It lives here because a route file may export only HTTP methods and config.
// What the sweep is and why: the comment at the top of app/api/reconcile/route.ts.

import { buildDeps } from "../deps";
import { NeonStateStore } from "../stateDb";
import { sweepAll, type SweepOutcome } from "../engine/sweep";
import { retryHeld, markThrew, MAX_RETRIES_PER_RUN, type RetryOutcome } from "../engine/retryHeld";
import { rebuildThread } from "../threadMessagesDb";
import { coerceThread } from "../engine/intake";
import { handleThread, flagManualIfNeeded, type PipelineDeps } from "../engine/pipeline";
import { upsertTicketFromState } from "../ticketsDb";
import { drySandbox } from "../engine/sweepSandbox";
import { expirePast } from "../engine/expirePast";
import { reportError } from "../errorReport";
import type { ConversationState } from "../engine/types";

const NEEDS_A_PERSON = new Set(["lost", "unapplied", "unactionable", "unreconciled"]);

// A re-run is one model call plus an OnSinch create; none starts after this many ms.
const RETRY_START_BUDGET_MS = 35_000;

// 30, not the 40 that was measured at 23.7s dry. A dry run replaces each write with an
// immediate throw, so the live run of that same batch does 21 OnSinch patches the
// measurement never paid for. The headroom is for those.
const DEFAULT_LIMIT = 30;

/** The slice of NeonStateStore the sweep route uses. */
export interface SweepStore {
  get(thread_id: string): Promise<ConversationState | undefined>;
  put(s: ConversationState): Promise<void>;
  all(): Promise<ConversationState[]>;
  forSweep(limit: number): Promise<ConversationState[]>;
  markSwept(threadIds: string[]): Promise<void>;
  heldForRetry(limit: number): Promise<ConversationState[]>;
  flaggedOldestFirst(limit: number): Promise<ConversationState[]>;
  sweepStats(): Promise<{ bound: number; never_swept: number }>;
}

export interface ReconcileIO {
  store: () => SweepStore;
  buildDeps: () => Promise<PipelineDeps>;
  rebuildThread: typeof rebuildThread;
  upsertTicket: typeof upsertTicketFromState;
  report: typeof reportError;
  now: () => number;
}

export const productionReconcileIO: ReconcileIO = {
  store: () => new NeonStateStore(),
  buildDeps,
  rebuildThread,
  upsertTicket: upsertTicketFromState,
  report: reportError,
  now: Date.now,
};

export async function runReconcile(request: Request, dry: boolean, io: ReconcileIO = productionReconcileIO): Promise<Response> {
  const started = io.now();
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  const store = io.store();
  const states = await store.forSweep(limit);
  const deps = await io.buildDeps();

  // A dry run must not be able to write, and "we promise not to call it" is not a
  // mechanism: drySandbox builds its deps from an allowlist of reads (SP-13).
  const sandboxed = dry ? drySandbox(deps) : deps;

  // No `limit` here: the batch was already bounded by the query that chose it, and
  // sweepAll's limit counts only threads that PAID for an OnSinch read. Applying both
  // means a batch of mostly-skipped rows stops short, leaves the rest unstamped, and
  // hands the next run the same rows again -- the rotation stalls while reporting
  // success. One bound, in one place.
  const { swept, outcomes } = await sweepAll(states, sandboxed, { todayISO: new Date(io.now()).toISOString() });

  // One ticket upsert per outcome that needs a person (SP-09): before this only held
  // re-runs reached the tickets table, so the dashboard never saw a lost order.
  if (!dry) {
    const byId = new Map(states.map((s) => [s.thread_id, s]));
    for (const o of outcomes) {
      const s = NEEDS_A_PERSON.has(o.action) ? byId.get(o.thread_id) : undefined;
      if (s) await io.upsertTicket(s);
    }
  }

  // Stamped only on a real run. A dry run must leave no trace, and stamping one would
  // push every thread it looked at to the back of the queue without reconciling any of
  // them -- a read-only call silently costing the next real sweep its turn.
  if (!dry) await store.markSwept(states.map((s) => s.thread_id));

  // Real runs only: a re-run books an order, which a dry run must never do.
  let retried: RetryOutcome[] = [];
  if (!dry) {
    retried = await retryHeld(await store.heldForRetry(MAX_RETRIES_PER_RUN), {
      listsReadable: async () => { try { await deps.onsinch.allPlaces(); await deps.onsinch.allCompanies(); return true; } catch { return false; } },
      run: async (threadId) => {
        const thread = await io.rebuildThread(threadId);
        const coerced = thread ? coerceThread(thread) : null;
        if (!coerced) return null;
        const state = await handleThread(coerced, deps);
        await io.upsertTicket(state);
        return state;
      },
      hasTime: () => io.now() - started < RETRY_START_BUDGET_MS,
    });
    for (const o of retried) if (o.result.startsWith("failed")) {
      void io.report({ route: "engine-threw", where: "api/reconcile (held retry)", what: o.result, detail: `thread ${o.thread_id}` });
      // A re-run that threw is a held pass too, or a thread that always throws would be
      // re-run, with its model calls, every hour for three days (SP-15).
      await markThrew(store, { thread_id: o.thread_id }, o.result).catch(() => {});
    }
  }

  // Real runs only: a needs-a-person flag on a job that is over comes off, 20 a run (SP-40).
  let expired = 0;
  if (!dry) {
    for (const s of expirePast(await store.flaggedOldestFirst(200), new Date(io.now()).toISOString())) {
      await store.put(s);
      await flagManualIfNeeded(s, deps);
      await io.upsertTicket(s);
      expired++;
    }
  }
  const stats = await store.sweepStats();

  const tally: Record<string, number> = {};
  for (const o of outcomes) tally[o.action] = (tally[o.action] ?? 0) + 1;

  return Response.json({
    ok: true,
    dry,
    batch: states.length,
    bound_threads: stats.bound,
    never_swept: stats.never_swept,
    swept,
    tally,
    expired,
    // Only the rows that did something or could not be done. A run where 38 of 40 threads
    // hold exactly what they should is the healthy case, and printing all 38 buries the two.
    outcomes: outcomes.filter((o: SweepOutcome) => o.action !== "holds" && o.action !== "skipped" && o.action !== "exists"),
    retried,
  });
}
