// Wires the engine's PipelineDeps from environment for the Vercel runtime.
// The automation runs HERE (Vercel); n8n only triggers it via /api/n8n-inbound.
//
// Executor edges:
//   - OnSinch create/patch  -> real HTTP (Vercel owns the OnSinch write)
//   - Gmail reply draft      -> POSTed to GMAIL_DRAFT_WEBHOOK if set (n8n holds
//     the Gmail creds and does the raw draft); otherwise the composed reply is
//     returned to the caller to draft. Never blocks the pipeline.

import { createHash } from "node:crypto";
import { OnsinchClient, httpTransport } from "./engine/onsinch";
import { createOpenRouterReasoner, type Reasoner } from "./engine/reason";
import { guardReasoner } from "./engine/spend";
import { tieredReasoner } from "./engine/tiered";
import { logKeyBalanceOnce } from "./engine/keyBalance";
import { buildOrderBody } from "./engine/format";
import { replaceProvisionalOrder } from "./engine/replaceOrder";
import type { DesiredOrder } from "./engine/types";
import type { Executor, PipelineDeps } from "./engine/pipeline";

/**
 * Tool 2 write path: if the order carries a new-venue provision, create the
 * place first (reference data, no contact dependency), backfill its id onto
 * every slot team, then create the order. Exported so it's testable.
 */
export async function createOrderWithPlace(client: OnsinchClient, order: DesiredOrder) {
  const o = { ...order };
  if (o.provision_place && o.slot_teams.some((s) => !s.place_id)) {
    const place = await client.createPlace({ ...o.provision_place });
    o.slot_teams = o.slot_teams.map((s) => ({ ...s, place_id: place.id }));
  }
  return client.createOrder(buildOrderBody(o));
}
import { NeonStateStore } from "./stateDb";
import { NeonMetrics } from "./metricsDb";
import { getSettings } from "./settingsDb";
import { getRateCard } from "./rateCardsDb";
import { lookupAlias, recordAlias } from "./aliasesDb";

export const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

// Lazy: the reasoner is only constructed when a language task actually runs, so
// order-execution paths (confirm-order) work without the LLM key set.
/** The production wrapper, exposed so test/depsForwardsReasoner.ts can inspect it. */
export function buildReasonerForTest(): Reasoner {
  return reasoner();
}

function reasoner(): Reasoner {
  let real: Reasoner | null = null;
  const get = (): Reasoner => {
    if (real) return real;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
    const model = process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6";
    // What is left on the key, said out loud once per process. An exhausted key returns
    // 403 on every call and looks identical to a quiet morning: 17 emails arrived on
    // 2026-08-04 and none were classified, with nothing in the logs to say why. Not
    // awaited — the balance is diagnostics, and no email should wait on it.
    logKeyBalanceOnce(apiKey);
    // Tiering, only when a cheap model is named. The escalation rules live in
    // tiered.ts and are deterministic; what is unknown is how often they fire, and
    // that needs a paid run to establish. Until then this stays opt-in, because
    // changing which model reads Spartan's mail is a decision, not a default.
    const cheapModel = process.env.SPARTAN_MODEL_CHEAP;
    if (cheapModel) {
      real = guardReasoner(
        tieredReasoner(
          createOpenRouterReasoner({ apiKey, model: cheapModel }),
          createOpenRouterReasoner({ apiKey, model }),
          { onEscalate: (r) => console.log(`[tier] escalated to ${model}: ${r}`) }
        ),
        { model, label: "pipeline (tiered)" }
      );
      return real;
    }
    // One request handles one thread, so a handful of calls is the whole job. The
    // ceiling exists for the runaway case — a retry loop, a thread that re-enters the
    // pipeline — where the cost is unbounded and nothing else would notice.
    real = guardReasoner(createOpenRouterReasoner({ apiKey, model }), { model, label: "pipeline" });
    return real;
  };
  // classifyAndExtract MUST be forwarded. This wrapper is hand-written rather than a
  // proxy, and while it listed only three methods the production reasoner had no
  // `classifyAndExtract` property at all — so `compiler.ts`, which tests for it before
  // using it, silently took the two-call fallback on every live email. The combined call
  // shipped and never once ran on Vercel. Anything added to the Reasoner interface has to
  // be added here too, or it does not exist in production.
  return {
    classifyAndExtract: (...a) => get().classifyAndExtract!(...a),
    classifyAndExtractIncremental: (...a) => get().classifyAndExtractIncremental!(...a),
    classify: (...a) => get().classify(...a),
    extractFacts: (...a) => get().extractFacts(...a),
    composeReply: (...a) => get().composeReply(...a),
  };
}

function onsinch(): OnsinchClient {
  return new OnsinchClient(
    httpTransport({
      baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1",
      apiKey: process.env.ONSINCH_API_KEY || "",
    })
  );
}

export function executor(client: OnsinchClient): Executor {
  return {
    async createReplyDraft(a) {
      const hook = process.env.GMAIL_DRAFT_WEBHOOK;
      if (!hook) return "return-to-caller"; // caller drafts from the response
      try {
        const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(a) });
        const j = await res.json().catch(() => ({}));
        return String(j.draftId ?? "drafted");
      } catch (err) {
        console.error("[gmail] draft webhook failed", err);
        return "draft-failed";
      }
    },
    async createOrder(order) {
      return createOrderWithPlace(client, order);
    },
    /**
     * The crew/time change PATCH cannot carry. Gated by an env flag because it DELETES
     * a real order to apply an email: the capability is built and tested, but arming it
     * on a live tenant is an operational decision.
     *
     *   SPARTAN_ALLOW_ORDER_REPLACE=1
     *
     * Unset, the method is absent and the pipeline falls back to patching what it can and
     * telling a human the rest — exactly the behaviour before this existed.
     */
    ...(process.env.SPARTAN_ALLOW_ORDER_REPLACE === "1"
      ? {
          async replaceOrder(p: {
            order_id: number;
            desired: DesiredOrder;
            alreadyDeleted?: boolean;
            onIntent(snapshot: unknown): Promise<void>;
            onDeleted(): Promise<void>;
          }) {
            return replaceProvisionalOrder(
              client,
              { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted },
              { onIntent: p.onIntent, onDeleted: p.onDeleted }
            );
          },
        }
      : {}),
    /**
     * Update an EXISTING order with the fields it is safe to overwrite, and
     * return which ones went so the pipeline can be honest about the rest.
     *
     * This used to send `[{ id }]` and nothing else — a guaranteed no-op that
     * the pipeline then recorded as a completed update.
     *
     * Deliberately NOT sent:
     *  - `name`: Spartan's orders are named "<Company> @ <Venue>" throughout the
     *    tenant. Overwriting that with an email subject ("RE: UKLE26-2841.01 //
     *    ★LOCAL CREW★ ...") destroys the convention every human and the
     *    order->thread linkage both rely on.
     *  - the rate card: on an existing order it is the real, invoiced one. Ours
     *    is inferred from history and has been wrong; it must never overwrite.
     *  - slot teams: nested teams from the original POST expose no ids, and there
     *    is no GET /slotTeams, so a crew change cannot be applied or verified.
     *    A crew or time change goes through replaceOrder above instead.
     */
    async patchOrder(p) {
      const body: Record<string, unknown> = { id: p.order_id };
      const applied: string[] = [];
      const spec = p.desired.specification?.trim();
      if (spec) { body.specification = spec; applied.push("specification"); }
      const po = p.desired.intern_name?.trim();
      if (po) { body.intern_name = po; applied.push("intern_name"); }
      if (!applied.length) return []; // nothing safe to send — do not call at all
      await client.patchOrder([body as { id: number }]);
      return applied;
    },
  };
}

export async function buildDeps(): Promise<PipelineDeps> {
  const client = onsinch();
  const settings = await getSettings();
  return {
    reasoner: reasoner(),
    onsinch: client,
    store: new NeonStateStore(),
    metrics: new NeonMetrics(),
    settings,
    repliesEnabled: settings.replies_enabled, // Tool 1: off by default
    seededRateCard: async (companyId: number) => (await getRateCard(companyId))?.card ?? null,
    aliases: { lookup: lookupAlias, record: recordAlias },
    executor: executor(client),
    now: () => Date.now(),
    hashOrder,
  };
}
