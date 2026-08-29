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
import { createOpenRouterReasoner, createVenueJudge, type Reasoner } from "./engine/reason";
import { guardReasoner } from "./engine/spend";
import { tieredReasoner } from "./engine/tiered";
import { logKeyBalanceOnce } from "./engine/keyBalance";
import { buildOrderBody, buildSlotTeamBody } from "./engine/format";
import { recordOrder, buildOrderRecord } from "./orderRecordsDb";
import { replaceProvisionalOrder } from "./engine/replaceOrder";
import { amendOrderInPlace } from "./engine/amendOrder";
import type { DesiredOrder, DesiredSlotTeam } from "./engine/types";
import type { Executor, PipelineDeps } from "./engine/pipeline";

/**
 * The job id, which the create does not return. `POST /orders` answers with the order id
 * alone — nested Job and SlotTeam ids are never in the response — and every block that
 * follows has to be posted against a job_id, so this read is not optional.
 */
async function readOrderIdentifiers(
  client: OnsinchClient,
  order_id: number
): Promise<{ job_id: number; order_number?: string }> {
  const live: any = await client.orderById(order_id);
  const o = live?.data ?? live;
  const job = (Array.isArray(o?.Job) ? o.Job[0] : o?.Job) ?? {};
  const job_id = Number(job?.id);
  if (!Number.isInteger(job_id)) {
    throw new Error(`order #${order_id} was created but its job id could not be read back — cannot post crew blocks`);
  }
  return { job_id, order_number: o?.number ? String(o.number) : undefined };
}

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
  remember?: (a: { kind: "company" | "place"; alias_norm: string; entity_id: number; source: "exact"; raw_example?: string }) => Promise<void>,
  context?: { thread_id: string; sender_email: string | null; sender_domain: string | null }
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

  /**
   * ONE CALL, CARRYING THE CREW. This is the shape `POST /orders` documents as required:
   * `name, company_id, user_id`, plus `Job` with AT LEAST ONE `SlotTeam` — refused
   * otherwise with "Please fill the SlotTeam for this Order" (API reference §4).
   *
   * IT USED TO POST `SlotTeam: []` AND APPEND THE BLOCKS AFTERWARDS, AND THAT COST THE
   * ENGINE ITS ENTIRE OUTPUT FOR FIVE DAYS. The empty array is accepted — 201, with a
   * job whose window is null — so it looked like a valid create and every check passed.
   * It is not one. OnSinch files an order into ORDERS TO CONFIRM at the moment it is
   * created, from the crew it was created with, and never revisits that. An order built
   * blockless is therefore filed nowhere, and appending the blocks a second later does
   * not rescue it: measured 2026-08-28 on three orders that differ in nothing else —
   * 15603 was created with its crew nested and Ben found it in To Confirm; 15602 and
   * 15604 were built the old way and he could not see either, though by then all three
   * read back identical company, job window, rate card and `happening`.
   *
   * Nine orders a day were being written correctly into a place nobody looks, while ops
   * re-keyed the same jobs by hand.
   *
   * WHAT THIS GIVES UP, deliberately: the block ids. `POST /slotTeams` returning its id
   * is the only route to one — an API create logs a single childless audit row, so
   * nested blocks are unreadable under any key (§12), and neither `POST /orders`'s
   * response nor any `with=` embed carries them (both probed, 2026-08-28). So the
   * two-phase create was not wrong about the ids; it was buying them at a price nobody
   * had measured.
   *
   * Amendments degrade rather than break. `amendInPlace` declines with "no slot team ids
   * could be read back" and the pipeline falls through to the rebuild, which is built,
   * tested and provisions the venue before deleting. The cost is that a crew change
   * gives the order a new R number. That is a real cost to ops, and it is smaller than
   * an order they never see.
   */
  const created = await client.createOrder(buildOrderBody(o));
  const ids = await readOrderIdentifiers(client, created.id);

  // Same fail-open contract as the alias writes above: this row is a record of
  // what happened, not a condition of it, so it never blocks or fails the booking.
  if (context) {
    const rec = buildOrderRecord({
      order_id: created.id,
      thread_id: context.thread_id,
      job_id: ids.job_id,
      order_number: created.number ?? ids.order_number ?? null,
      sender_email: context.sender_email,
      sender_domain: context.sender_domain,
      place_id: o.slot_teams[0]?.place_id ?? null,
      shape_sent: o,
    });
    await recordOrder(rec).catch((err: unknown) => console.error("[order-records] record failed", err));
  }

  return { id: created.id, number: created.number ?? ids.order_number, job_id: ids.job_id, team_ids: [] };
}
import { archiveOrder, recordReplacement } from "./orderArchiveDb";
import { loadProfessions } from "./professionsDb";
import { PROFESSION_LIST } from "./engine/professionList";
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
    /**
     * The internal "is this one job or two?" email to ops, when a second thread looks
     * like a job we already hold (crossThread.ts).
     *
     * It goes through the SAME Gmail draft webhook as a client reply, because it is the
     * same operation — a draft in the bookings inbox — and a second delivery path would
     * be a second thing to keep working. The difference is only the recipient, and the
     * webhook already takes one.
     *
     * A failure here is logged and swallowed by the caller: the ORDER IS ALREADY HELD
     * by the time this runs, and the hold is the safety. An undelivered email means ops
     * find the held thread on the board instead of in their inbox, which is slower, not
     * dangerous.
     */
    async createInternalDraft(d) {
      const hook = process.env.GMAIL_DRAFT_WEBHOOK;
      if (!hook) {
        console.error("[cross-thread] no GMAIL_DRAFT_WEBHOOK — ops were not emailed:", d.subject);
        return;
      }
      const res = await fetch(hook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET ?? "",
        },
        // `to` is what makes this internal. in_reply_to is deliberately absent: this
        // must NOT land in the client's thread, which is the one way this email could
        // do harm rather than merely fail to arrive.
        body: JSON.stringify({ to: d.to, subject: d.subject, html: htmlFromText(d.body) }),
      });
      const j = (await res.json().catch(() => ({}))) as { draftId?: unknown };
      if (!res.ok || !j.draftId) {
        throw new Error(`internal draft webhook returned no draft id (HTTP ${res.status})`);
      }
      return String(j.draftId);
    },
    async createOrder(order) {
      // recordAlias is what makes a created company or venue findable from a cold
      // lambda. Passed rather than imported inside createOrderWithPlace so the write
      // path stays testable with no database.
      return createOrderWithPlace(client, order, recordAlias);
    },
    /**
     * A crew or time change applied to the order that exists, rather than to a
     * replacement for it. Tried first; see amendOrder.ts.
     *
     * DELIBERATELY NOT BEHIND THE KILL SWITCH. `SPARTAN_BLOCK_ORDER_REPLACE=1` exists to
     * stop this codebase destroying an order, and this path destroys nothing — no
     * delete, no cascade, the R number unmoved, attachments and ops' hand-typed fields
     * untouched. Gating it on the same flag would mean that throwing the switch also
     * stopped every crew change reaching OnSinch, which is the outcome the switch is
     * there to make safe, not to cause.
     */
    async amendOrderInPlace(p: {
      order_id: number;
      previous: DesiredSlotTeam[];
      desired: DesiredOrder;
      alreadyCreated?: number[];
      known?: { job_id?: number; team_ids?: number[] };
      onCreated(team_id: number): Promise<void>;
    }) {
      // `known` MUST be forwarded. It is the ids the create recorded, and without them
      // the amendment falls back to the audit read, which is empty for every order this
      // engine raises — the whole path would be correct and unreachable in production
      // while every unit test passed.
      return amendOrderInPlace(
        client,
        { order_id: p.order_id, previous: p.previous, desired: p.desired, alreadyCreated: p.alreadyCreated, known: p.known },
        { onCreated: p.onCreated }
      );
    },
    /**
     * The crew/time change PATCH cannot carry — the order is deleted and reposted.
     *
     * ON BY DEFAULT since 2026-08-18. It was gated behind SPARTAN_ALLOW_ORDER_REPLACE=1
     * while arming it was an open question; Ben has since ruled that every amendment
     * rebuilds the order, so leaving it off would have meant the ruling did nothing and
     * every crew change kept landing in a note for a human. A flag that quietly cancels
     * a decision is worse than no flag.
     *
     * The kill switch survives, inverted:
     *
     *   SPARTAN_BLOCK_ORDER_REPLACE=1
     *
     * Set that and the method is absent, the pipeline falls back to patching what it
     * can and telling a human the rest, and nothing in this codebase can delete an
     * order. It is worth keeping precisely because this is the only code that destroys
     * a real booking — but it is now something you turn ON to stop the engine, not
     * something you must remember to turn on to start it.
     *
     * What stops it running away is not the flag: a CONFIRMED order is never touched
     * (replaceOrder.ts), an attachment refuses the rebuild, and every deleted order is
     * archived in full before it goes.
     */
    ...(process.env.SPARTAN_BLOCK_ORDER_REPLACE !== "1"
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
    /**
     * `J<id>` — the identifier ops and clients both search on. Only obtainable by
     * reading the order back: POST /orders returns the order id alone, and there is
     * no GET /jobs at all (see the API reference).
     */
    /**
     * One GET, both numbers. The order's own `number` was already in this response and
     * was being thrown away, so every order the engine created reached the board, the
     * tickets table and the confirm-order API with a null R number — the identifier
     * clients quote back at us.
     */
    async identifiersForOrder(order_id: number) {
      const live = (await client.orderById(order_id)) as
        | ({ Job?: { id: number }[] | { id: number }; number?: string })
        | null;
      const job = Array.isArray(live?.Job) ? live?.Job?.[0] : (live?.Job as { id: number } | undefined);
      return {
        job_id: job?.id != null ? Number(job.id) : undefined,
        order_number: live?.number != null ? String(live.number) : undefined,
      };
    },
  };
}

/**
 * The cross-thread draft is composed as plain text because it is a list of facts, not
 * prose. Gmail drafts are HTML, so it is escaped and wrapped in a <pre> rather than
 * being run through a markdown renderer that would reflow the columns it lines up.
 */
function htmlFromText(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${esc}</pre>`;
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
    // Which threads get one. Forwarded explicitly: this wrapper is hand-written
    // and has dropped a field before, and a scope that silently defaulted would
    // reply to everything while the dashboard said otherwise.
    replyScope: settings.reply_scope,
    // The house standard for a client with no history. Forwarded explicitly for
    // the same reason as everything else here: this wrapper is hand-written.
    defaultRateCard: settings.default_rate_card,
    seededRateCard: async (companyId: number) => (await getRateCard(companyId))?.card ?? null,
    aliases: { lookup: lookupAlias, record: recordAlias },
    /**
     * The venue adjudicator (Ben, 2026-08-25). Only built when there is a key —
     * absent, the venue path takes the deterministic search result and says so on
     * the ticket, which is the behaviour every test pins.
     */
    venueJudge: process.env.OPENROUTER_API_KEY
      ? createVenueJudge({ apiKey: process.env.OPENROUTER_API_KEY })
      : null,
    // Read once per invocation from the Neon cache; the committed list is the floor.
    professions: await loadProfessions(PROFESSION_LIST),
    /**
     * A job this engine could not book, tagged "Manual" in Gmail so ops see it in the
     * mailbox they already work from rather than only on a board they have to open.
     *
     * Ben, 2026-08-26: "any that cannot be booked should pipe into n8n via webhook and
     * mark the thread with a tag 'Manual'."
     *
     * n8n does the labelling because the mailbox credential lives there and cannot be
     * read out of it — the public API returns credential metadata only, never the token.
     * Same shared secret and same failure posture as the draft webhook above.
     *
     * NO WEBHOOK MEANS NO TAG, SILENTLY, AND THAT IS THE RIGHT DEFAULT. A preview
     * deployment and a local run have no business writing labels into the live bookings
     * mailbox, and the flag is an alert rather than part of the booking — the thread is
     * on the board with its reason either way.
     */
    async flagForManual(a) {
      const hook = process.env.MANUAL_TAG_WEBHOOK;
      if (!hook) return;
      const res = await fetch(hook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET ?? "",
        },
        body: JSON.stringify({ label: "Manual", ...a }),
      });
      /**
       * A 200 WITH AN EMPTY BODY IS A FAILURE HERE, for the reason recorded on the draft
       * webhook: n8n answers 200 when the workflow throws, which is exactly what a
       * rejected secret produces. Throwing lets the caller leave `manual_flagged` unset
       * so the next email retries, instead of recording a tag that was never applied.
       */
      const j = (await res.json().catch(() => ({}))) as { ok?: unknown };
      if (!res.ok || j.ok !== true) {
        throw new Error(`manual-tag webhook did not confirm (HTTP ${res.status}) ${JSON.stringify(j).slice(0, 160)}`);
      }
    },
    senderVerdict,
    recordSender,
    // The permanent record of every order a rebuild destroys, and what replaced it.
    archiveOrder,
    recordReplacement,
    executor: executor(client),
    now: () => Date.now(),
    hashOrder,
  };
}
