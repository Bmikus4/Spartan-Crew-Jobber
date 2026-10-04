// ============================================================================
// The dry-run sandbox for the sweep: built from what may be read, never from what may not.
// ----------------------------------------------------------------------------
// The old sandbox spread the real deps and overrode the writes it knew about (the store's
// put, the executor's patch). Everything it did not name came through: a dry `lost` posted
// a Gmail label through flagForManual, a dry run wrote metric_events, and the link judge
// would have spent model money (SP-13). So this copies an allowlist and nothing else; a
// write dependency added to PipelineDeps later is absent here by default.
//
// OnSinch is wrapped at the transport, so every non-GET is refused whatever method sends it.
// ============================================================================
import type { PipelineDeps } from "./pipeline";

/** The only deps keys a dry sweep receives as they are. */
export const DRY_PASS_THROUGH = ["now", "readThread"] as const;

export function drySandbox(deps: PipelineDeps): PipelineDeps {
  const out: Record<string, unknown> = {};
  for (const k of DRY_PASS_THROUGH) if ((deps as any)[k] !== undefined) out[k] = (deps as any)[k];
  out.onsinch = deps.onsinch.readOnly();
  out.store = {
    get: deps.store.get.bind(deps.store),
    all: deps.store.all.bind(deps.store),
    put: async () => {},
  };
  const refuse = async () => { throw new Error("dry run: nothing is written"); };
  out.executor = { patchOrder: refuse, createOrder: refuse, createReplyDraft: refuse };
  return out as unknown as PipelineDeps;
}
