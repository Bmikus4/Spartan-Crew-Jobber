// ============================================================================
// compiler — the foundational piece. compile(thread, prior) -> {state, actions}
//
// The compiler READS (normalize, classify, extract, resolve ids via GET) and
// composes desired state. It NEVER writes to OnSinch/Gmail — it returns the
// Actions for the executor to perform. This keeps compile idempotent and
// safe to re-run on any thread at any time (the "never miss a lead" property:
// a nightly full-thread sweep can re-compile everything harmlessly).
// ============================================================================
import { createHash } from "node:crypto";
import type {
  Actions,
  ConversationFacts,
  ConversationState,
  DesiredOrder,
  HydratedThread,
} from "./types";
import { normalizeThread } from "./normalize";
import { composeOrder } from "./compose";
import { validateOrder } from "./format";
import { matchCompany, matchContact, matchPlace, matchExistingOrder } from "./resolve";
import { resolveRateCard } from "./rates";
import type { Reasoner } from "./reason";
import type { OnsinchClient } from "./onsinch";

export interface CompileDeps {
  reasoner: Reasoner;
  onsinch: OnsinchClient;
  now: () => number; // injectable clock for deterministic tests
  // Tool 1 toggle. undefined => enabled (tests); false => no reply is drafted.
  repliesEnabled?: boolean;
  // Seeded rate-card lookup (Phase B rate_cards). Injected so the engine stays
  // DB-agnostic; when absent, rates.ts falls back to a live history scan.
  seededRateCard?: (companyId: number) => Promise<number | null>;
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** OnSinch caps the Job name; keep it under this. */
const JOB_NAME_MAX = 100;

/**
 * "<size> at <venue> on <date>", capped at JOB_NAME_MAX.
 *
 * The cap is applied to the VENUE, not to the finished string. Truncating the
 * whole thing lopped the date off the end whenever the address was long: live
 * order 13632's name read "...London E16 2HB on 2026", cut four characters into
 * the year, because that address is 87 chars and the full name is 106.
 *
 * The date is the load-bearing token here - it is what a human scans a crew job
 * name for, and what the order->thread linkage matches on. The venue tail is the
 * only part that can afford to be lost.
 */
export function jobNameFrom(facts: ConversationFacts): string {
  const r = facts.requests[0];
  const size = r?.size ?? "?";
  const date = r?.date ?? "TBC";
  const loc = facts.location_text ?? "TBC";

  const head = `${size} at `;
  const tail = ` on ${date}`;
  const room = JOB_NAME_MAX - head.length - tail.length;
  // Nothing sane left for a venue: keep the ends, which still identify the job.
  if (room <= 0) return `${head}${tail}`.slice(0, JOB_NAME_MAX);
  const venue = loc.length > room ? loc.slice(0, room).trimEnd() : loc;
  return `${head}${venue}${tail}`;
}

/** Earliest requested date (YYYY-MM-DD) — the order-dedup key. */
function firstDate(facts: ConversationFacts): string | undefined {
  return facts.requests
    .map((r) => r.date)
    .filter((d): d is string => !!d)
    .sort()[0];
}

// Tool 2 resolution — OnSinch search is limited/non-fuzzy, so we pull the WHOLE
// list and match EXACTLY client-side (dedup: never create a duplicate).

/** company: reuse prior; else exact-match all companies; else it's new (needs adding). */
async function resolveCompany(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient
): Promise<{ id?: number; note?: string }> {
  if (prior?.company_id) return { id: prior.company_id };
  if (!facts.company_name) return { note: "no company name extracted" };
  const id = matchCompany(facts.company_name, await onsinch.allCompanies());
  if (id) return { id };
  return { note: `new company "${facts.company_name}" — add it in OnSinch (a contact is needed too)` };
}

/** contact: reuse prior; else exact-match the sender against the company's
 * Client list; else fall back to an existing company contact; else needs-human.
 * (The API cannot create contacts — a genuinely-new person must be added in OnSinch.) */
async function resolveContact(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  company_id: number | undefined,
  onsinch: OnsinchClient
): Promise<{ id?: number; note?: string }> {
  if (prior?.user_id) return { id: prior.user_id };
  if (!company_id) return { note: "no company resolved — contact pending" };
  const clients = await onsinch.companyClients(company_id);
  const exact = matchContact(facts.contact_email, clients);
  if (exact) return { id: exact };
  if (clients[0]?.id)
    return { id: clients[0].id, note: `unknown sender ${facts.contact_email ?? "?"} — used the company's existing contact` };
  return { note: `new contact ${facts.contact_email ?? "?"} and the company has no contact on file — add one in OnSinch` };
}

/** place: reuse prior; else exact-match all places; else provision a new one on write. */
async function resolvePlace(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient
): Promise<{ id?: number; provision?: DesiredOrder["provision_place"]; note?: string }> {
  if (prior?.place_id) return { id: prior.place_id };
  if (!facts.location_text) return { note: "no location extracted" };
  const id = matchPlace(facts.location_text, await onsinch.allPlaces());
  if (id) return { id };
  return {
    provision: { name: facts.location_text.slice(0, 120), country: "GB", address: facts.location_text },
    note: `new venue "${facts.location_text}" — will be created in OnSinch on confirm`,
  };
}

export async function compile(
  thread: HydratedThread,
  prior: ConversationState | undefined,
  deps: CompileDeps
): Promise<{ state: ConversationState; actions: Actions }> {
  const { reasoner, onsinch, now } = deps;
  const { latest, history, machine } = normalizeThread(thread);
  const notes: string[] = [];

  // 0. machine mail — nothing here was written by a client, so there is nothing
  // to reply to and nothing to book. Decided before the model runs: OnSinch's
  // own order notifications read as perfect enquiries, and acting on one means
  // patching a real order with invented hours and a guessed rate card. Prior
  // linkage (company/order ids) is carried through untouched.
  if (machine) {
    return {
      state: {
        ...(prior ?? {}),
        thread_id: thread.thread_id,
        subject: latest.subject,
        participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
        last_message_id: latest.message_id,
        last_processed_epoch: now(),
        classification: "not-a-job",
        facts: prior?.facts ?? { requests: [] },
        desired_order: null,
        pending_order: prior?.pending_order,
        priority: "low",
        needs_human: false,
        status: "ignored",
        notes: [`machine mail from ${latest.from} — not a client enquiry`],
        order_action_log: prior?.order_action_log ?? [],
      },
      actions: { none: true },
    };
  }

  // 1. classify the latest email
  const cls = await reasoner.classify(latest, history, !!prior?.onsinch_order_id);

  // 2. compose the reply — Tool 1, gated by the replies_enabled setting.
  // Off by default: classification + order work still run, but no reply is drafted.
  const repliesEnabled = deps.repliesEnabled !== false;
  const reply = repliesEnabled
    ? await reasoner.composeReply(latest, history, cls.classification)
    : null;
  const replyHash = reply ? hash(reply.html) : undefined;

  // 3. only a real job triggers the order path
  const isJob = cls.classification === "new-job" || cls.classification === "update";
  let facts: ConversationFacts = prior?.facts ?? { requests: [] };
  let desired = null as ConversationState["desired_order"];
  let needs_human = false;
  let company_id = prior?.company_id;
  let user_id = prior?.user_id;
  let place_id = prior?.place_id;
  let linkedOrderId = prior?.onsinch_order_id;
  let provisionPlace: DesiredOrder["provision_place"];

  if (isJob) {
    facts = await reasoner.extractFacts(latest, history);

    // company first (contact resolution needs it)
    const co = await resolveCompany(facts, prior, onsinch);
    company_id = co.id ?? company_id;
    if (co.note) notes.push(co.note);

    const [pl, us] = await Promise.all([
      resolvePlace(facts, prior, onsinch),
      resolveContact(facts, prior, company_id, onsinch),
    ]);
    place_id = pl.id ?? place_id;
    provisionPlace = pl.provision;
    user_id = us.id ?? user_id;
    if (pl.note) notes.push(pl.note);
    if (us.note) notes.push(us.note);

    // Order dedup vs OnSinch — never create a second job for an existing one.
    if (company_id && !linkedOrderId) {
      const existing = matchExistingOrder(firstDate(facts), await onsinch.companyOrdersWithJob(company_id));
      if (existing) {
        linkedOrderId = existing.order_id;
        notes.push(`matched existing OnSinch order #${existing.order_id} (same date) — will update, not create`);
      }
    }

    // Rate card (I1) — resolved before compose; no confident card => needs-human.
    let pricelist_category_id = 0;
    if (company_id) {
      const rate = await resolveRateCard(company_id, { onsinch, seededRateCard: deps.seededRateCard });
      if (rate.card) pricelist_category_id = rate.card;
      else notes.push(`no confident rate card for company ${company_id} — needs a human (I1)`);
    }

    const havePlace = !!place_id || !!provisionPlace;
    if (company_id && user_id && havePlace && pricelist_category_id) {
      const composed = composeOrder({
        facts,
        company_id,
        user_id,
        place_id: place_id ?? 0, // 0 => created on write from provisionPlace
        pricelist_category_id,
        orderName: (latest.subject || facts.requests[0]?.task || "Spartan Crew job").slice(0, 80),
        jobName: jobNameFrom(facts),
        specification: cls.job_summary,
        intern_name: facts.customer_reference,
      });
      composed.warnings.forEach((w) => notes.push(w));
      desired = composed.order;
      if (desired && provisionPlace) desired.provision_place = provisionPlace;
      if (desired) {
        const errs = validateOrder(desired);
        if (errs.length) {
          needs_human = true;
          notes.push(...errs);
        }
      }
    } else {
      needs_human = true; // unknown company / no contact -> a human resolves it
    }
  }

  // 4. decide actions (reads already happened; writes are returned only)
  const actions: Actions = {};
  if (reply && (!prior || prior.last_reply_hash !== replyHash)) {
    actions.createReplyDraft = {
      subject: reply.subject,
      html: reply.html,
      in_reply_to: latest.message_id,
    };
  }
  const desiredHash = desired ? hash(JSON.stringify(desired)) : undefined;
  if (desired && !needs_human) {
    if (linkedOrderId) {
      // an existing order (ours or matched in OnSinch) — patch only if it changed
      if (desiredHash !== prior?.last_ordered_hash) {
        actions.patchOrder = { order_id: linkedOrderId, desired };
      }
    } else {
      actions.createOrder = desired;
    }
  }
  if (!actions.createReplyDraft && !actions.createOrder && !actions.patchOrder) {
    actions.none = true;
  }

  // needs-info, NOT error: nothing failed here, we simply cannot finish without
  // a human. "error" is reserved for an actual failure (see pipeline.ts).
  const status: ConversationState["status"] = needs_human
    ? "needs-info"
    : desired
    ? "ordered"
    : cls.classification === "not-a-job"
    ? "ignored"
    : "drafted";

  const state: ConversationState = {
    thread_id: thread.thread_id,
    subject: latest.subject,
    participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
    last_message_id: latest.message_id,
    last_processed_epoch: now(),
    classification: cls.classification,
    facts,
    company_id,
    user_id,
    place_id,
    onsinch_order_id: linkedOrderId,
    onsinch_order_number: prior?.onsinch_order_number,
    desired_order: desired,
    last_ordered_hash: prior?.last_ordered_hash,
    priority: cls.priority,
    reply_body_html: reply?.html ?? prior?.reply_body_html,
    reply_subject: reply?.subject ?? prior?.reply_subject,
    reply_draft_id: prior?.reply_draft_id,
    last_reply_hash: replyHash ?? prior?.last_reply_hash,
    needs_human,
    status,
    notes,
    order_action_log: prior?.order_action_log ?? [],
  };

  return { state, actions };
}
