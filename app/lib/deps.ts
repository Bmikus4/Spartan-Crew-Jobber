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
import type { Executor, PipelineDeps } from "./engine/pipeline";
import { NeonStateStore } from "./stateDb";
import { NeonMetrics } from "./metricsDb";
import { getSettings } from "./settingsDb";

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

function executor(client: OnsinchClient): Executor {
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
      return client.createOrder(buildOrderBody(order));
    },
    async patchOrder(p) {
      await client.patchOrder([{ id: p.order_id }]);
    },
  };
}

export async function buildDeps(): Promise<PipelineDeps> {
  const client = onsinch();
  return {
    reasoner: reasoner(),
    onsinch: client,
    store: new NeonStateStore(),
    metrics: new NeonMetrics(),
    settings: await getSettings(),
    executor: executor(client),
    now: () => Date.now(),
    hashOrder,
  };
}
