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
import { buildOrderBody } from "./engine/format";
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

export const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

// Lazy: the reasoner is only constructed when a language task actually runs, so
// order-execution paths (confirm-order) work without the LLM key set.
function reasoner(): Reasoner {
  let real: Reasoner | null = null;
  const get = (): Reasoner => {
    if (real) return real;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
    real = createOpenRouterReasoner({ apiKey, model: process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.8" });
    return real;
  };
  return {
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
    executor: executor(client),
    now: () => Date.now(),
    hashOrder,
  };
}
