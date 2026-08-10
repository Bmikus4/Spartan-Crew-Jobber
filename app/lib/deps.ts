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
import { normName, normAddr } from "./engine/resolve";
import { createOpenRouterReasoner, type Reasoner } from "./engine/reason";
import { guardReasoner } from "./engine/spend";
import { tieredReasoner } from "./engine/tiered";
import { logKeyBalanceOnce } from "./engine/keyBalance";
import { buildOrderBody } from "./engine/format";
import { replaceProvisionalOrder } from "./engine/replaceOrder";
import type { DesiredOrder } from "./engine/types";
import type { Executor, PipelineDeps } from "./engine/pipeline";

/**
 * Tool 2 write path: create the reference data the order needs but OnSinch does
 * not yet have — the client company and the venue — then create the order.
 *
 * Both are created HERE and not in compile(), because compile is a pure read that
 * re-runs on every message of a thread; creating there would mint a company per
 * email. This runs once, at the moment the order is actually written.
 *
 * `remember` is how a created record is found next time. Ben, 2026-08-09: "You
 * must make sure that in cases where a location must be created or a company must
 * be created, that they will be found the NEXT time that name is used, to prove
 * the consistency of our datalogging system."
 *
 * There are two halves to that and both are needed. The OnSinch client patches its
 * warm list, which covers the next enquiry handled by this same lambda. `remember`
 * writes the name to the alias store, which covers every other lambda and every
 * time after — it is looked up before the whole-list pull, so a cold process
 * resolves the name without paging 763 companies to find one it created itself.
 *
 * Recorded as source "exact" deliberately: an alias we created the entity FOR is
 * not a fuzzy guess about which existing client was meant, it is the definition of
 * that name. Exported so it is testable.
 */
export async function createOrderWithPlace(
  client: OnsinchClient,
  order: DesiredOrder,
  remember?: (a: { kind: "company" | "place"; alias_norm: string; entity_id: number; source: "exact"; raw_example?: string }) => Promise<void>
) {
  const o = { ...order };

  if (o.provision_company && !o.company_id) {
    const company = await client.createCompany({ name: o.provision_company.name });
    o.company_id = company.id;
    await remember?.({
      kind: "company",
      alias_norm: normName(o.provision_company.name),
      entity_id: company.id,
      source: "exact",
      raw_example: o.provision_company.name,
    }).catch?.((err: unknown) => console.error("[aliases] company record failed", err));
  }

  if (o.provision_place && o.slot_teams.some((s) => !s.place_id)) {
    const place = await client.createPlace({ ...o.provision_place });
    o.slot_teams = o.slot_teams.map((s) => ({ ...s, place_id: place.id }));
    await remember?.({
      kind: "place",
      // Keyed on what the resolver will look up next time: the venue text from the
      // email, normalised the same way. For the "No Location" placeholder that is the
      // placeholder's own name, which is exactly right - the next enquiry with no
      // venue asks the same question and gets the same answer.
      alias_norm: normAddr(o.provision_place.address || o.provision_place.name),
      entity_id: place.id,
      source: "exact",
      raw_example: o.provision_place.name,
    }).catch?.((err: unknown) => console.error("[aliases] place record failed", err));
  }

  return client.createOrder(buildOrderBody(o));
}
import { NeonStateStore } from "./stateDb";
import { NeonMetrics } from "./metricsDb";
import { getSettings } from "./settingsDb";
import { getRateCard } from "./rateCardsDb";
import { lookupAlias, recordAlias } from "./aliasesDb";
import { senderVerdict, recordSender } from "./senderLedgerDb";

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
    /**
     * Hand the composed reply to n8n, which holds the Gmail credential and creates
     * the draft. See scripts/install-reply-draft-workflow.mjs.
     *
     * A DRAFT ID OR NOTHING. This used to return `j.draftId ?? "drafted"`, which
     * reads any answer at all as success — and n8n's webhook returns HTTP 200 with
     * an empty body when the workflow throws, which is exactly what a rejected
     * secret produces. Verified live: posting with no secret gets 200, the run
     * stops at the guard, no draft is created, and the old code would have stamped
     * the thread "drafted" and moved on. A reply nobody can see, recorded as sent,
     * is the failure this whole system is built to avoid.
     *
     * The secret is the same N8N_WEBHOOK_SECRET the inbound route uses — one shared
     * secret between this app and its own workflows, in both directions.
     */
    async createReplyDraft(a) {
      const hook = process.env.GMAIL_DRAFT_WEBHOOK;
      if (!hook) return "return-to-caller"; // caller drafts from the response
      try {
        const res = await fetch(hook, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET ?? "",
          },
          body: JSON.stringify(a),
        });
        const j = (await res.json().catch(() => ({}))) as { draftId?: unknown };
        if (!res.ok || !j.draftId) {
          console.error(`[gmail] draft webhook did not return a draft id (HTTP ${res.status})`, JSON.stringify(j).slice(0, 200));
          return "draft-failed";
        }
        return String(j.draftId);
      } catch (err) {
        console.error("[gmail] draft webhook failed", err);
        return "draft-failed";
      }
    },
    async createOrder(order) {
      // recordAlias is what makes a created company or venue findable from a cold
      // lambda. Passed rather than imported inside createOrderWithPlace so the write
      // path stays testable with no database.
      return createOrderWithPlace(client, order, recordAlias);
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
            weCreatedIt: boolean;
            alreadyDeleted?: boolean;
            onIntent(snapshot: unknown): Promise<void>;
            onDeleted(): Promise<void>;
          }) {
            return replaceProvisionalOrder(
              client,
              {
                order_id: p.order_id,
                desired: p.desired,
                // Forwarded, not defaulted. This wrapper is written out by hand and has
                // dropped a method before; a custody flag it silently supplied itself
                // would re-arm the deletion it exists to prevent.
                weCreatedIt: p.weCreatedIt,
                alreadyDeleted: p.alreadyDeleted,
              },
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
    senderVerdict,
    recordSender,
    executor: executor(client),
    now: () => Date.now(),
    hashOrder,
  };
}
