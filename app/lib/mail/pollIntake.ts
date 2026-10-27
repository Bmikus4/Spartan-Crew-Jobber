// ============================================================================
// What the Gmail poll (/api/mail-poll) does with the client mail of one batch (addendum F43, R14): what
// n8n's intake does with a delivery (n8nInbound.ts), thread by thread.
// ----------------------------------------------------------------------------
// Paused, whichever intake is live: what the poll stored first is marked store-only, so nothing decides it,
// then or after (decisions/2026-10-25-pause-window-store-only.md). Otherwise only the live intake decides
// (intakePath.ts). Live, the poll decides every message of its batch that has no decision, whichever intake
// stored it first: n8n may still be firing after the flip, and stores without deciding. In shadow the poll
// decides nothing, and n8n's delivery of a message the poll stored first finds it held, so the undecided
// sweep decides it minutes later behind a "reading it again" card: shadow is a short check, not a state.
// decideDelivery reads its ids as one conversation, so it is called once per thread. A thread that throws,
// or that the time budget does not reach, stays stored and undecided: the sweep's.
// ============================================================================
import type { decideDelivery, storeOnly } from "../v2/process";
import { reportError } from "../errorReport";
import { automationPausedFlag } from "../paused";
import { activeIntake, mayRunEngine } from "../intakePath";

export type Polled = { message_id: string; thread_id: string; inserted: boolean };
export type PollIO = {
  decide: typeof decideDelivery;
  storeOnly: typeof storeOnly;
  /** Of these ids, the ones with no decision and no store-only mark. */
  undecided: (ids: string[]) => Promise<string[]>;
  report: typeof reportError;
};

export const productionPollIO: PollIO = {
  // Loaded on use, as n8nInbound.ts does: the engine pulls in the browser bot.
  decide: async (ids) => (await import("../v2/process")).decideDelivery(ids),
  storeOnly: async (ids, reason) => (await import("../v2/process")).storeOnly(ids, reason),
  undecided: async (ids) => (await import("../v2/process")).undecidedOf(ids),
  report: reportError,
};

/** Each thread's outcome, for the route's answer. `polled` is the batch's client mail, in the order it was read. */
export async function settlePolled(polled: Polled[], io: PollIO = productionPollIO, opts: { deadline?: number } = {}): Promise<Array<{ thread: string; engine: string }>> {
  if (automationPausedFlag()) {
    const mine = polled.filter((m) => m.inserted);
    await io.storeOnly(mine.map((m) => m.message_id), "arrived while the automation was paused");
    return [...new Set(mine.map((m) => m.thread_id))].map((thread) => ({ thread, engine: "stored only (paused)" }));
  }
  if (!mayRunEngine("routing")) return [...new Set(polled.map((m) => m.thread_id))].map((thread) => ({ thread, engine: `shadow (INTAKE_PATH=${activeIntake()})` }));
  const open = new Set(polled.length ? await io.undecided(polled.map((m) => m.message_id)) : []);
  const threads = new Map<string, string[]>();
  for (const m of polled.filter((m) => open.has(m.message_id))) threads.set(m.thread_id, [...(threads.get(m.thread_id) ?? []), m.message_id]);
  const out: Array<{ thread: string; engine: string }> = [];
  for (const [thread, ids] of threads) {
    if (opts.deadline && Date.now() > opts.deadline) { out.push({ thread, engine: "left to the undecided sweep (time budget)" }); continue; }
    try {
      const r = await io.decide(ids);
      out.push({ thread, engine: r.map((x) => x.decision?.kind ?? x.skipped ?? "none").join(", ") || "nothing to decide" });
    } catch (err) {
      void io.report({ route: "engine-threw", where: "api/mail-poll", what: String((err as Error)?.message ?? err), detail: `thread ${thread}, messages ${ids.join(", ")}; the undecided sweep reads them again` });
      out.push({ thread, engine: "the engine threw; left to the undecided sweep" });
    }
  }
  return out;
}
