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
  HydratedThread,
} from "./types";
import { normalizeThread } from "./normalize";
import { scorePlaces } from "./score";
import { composeOrder } from "./compose";
import { validateOrder } from "./format";
import type { Reasoner } from "./reason";
import type { OnsinchClient } from "./onsinch";

export interface CompileDeps {
  reasoner: Reasoner;
  onsinch: OnsinchClient;
  now: () => number; // injectable clock for deterministic tests
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function jobNameFrom(facts: ConversationFacts): string {
  const r = facts.requests[0];
  const size = r?.size ?? "?";
  const loc = facts.location_text ?? "TBC";
  const date = r?.date ?? "TBC";
  return `${size} at ${loc} on ${date}`.slice(0, 100);
}

/** Resolve company_id from OnSinch, reusing the cached value if present. */
async function resolveCompany(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient
): Promise<{ id?: number; note?: string }> {
  if (prior?.company_id) return { id: prior.company_id };
  if (!facts.company_name) return { note: "no company name extracted" };
  const cands = await onsinch.searchCompanies({ name: facts.company_name });
  const exact = cands.find(
    (c) => (c.name || "").toLowerCase() === facts.company_name!.toLowerCase()
  );
  const pick = exact ?? cands[0];
  if (!pick) return { note: `company "${facts.company_name}" not found` };
  return { id: pick.id };
}

async function resolvePlace(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient
): Promise<{ id?: number; note?: string }> {
  if (prior?.place_id) return { id: prior.place_id };
  if (!facts.location_text) return { note: "no location extracted" };
  // OnSinch has no fuzzy search: pull candidates, then score locally.
  const cands = await onsinch.searchPlaces({});
  const scored = scorePlaces(facts.location_text, cands);
  if (scored.decision === "match" && scored.place)
    return { id: scored.place.id };
  return { note: `place unresolved (best ${scored.match_pct}%) — create-new` };
}

async function resolveUser(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient
): Promise<{ id?: number; note?: string }> {
  if (prior?.user_id) return { id: prior.user_id };
  if (!facts.contact_email) return { note: "no contact email" };
  const cands = await onsinch.searchUsers({ email: facts.contact_email });
  if (!cands[0]) return { note: `user ${facts.contact_email} not found` };
  return { id: cands[0].id };
}

export async function compile(
  thread: HydratedThread,
  prior: ConversationState | undefined,
  deps: CompileDeps
): Promise<{ state: ConversationState; actions: Actions }> {
  const { reasoner, onsinch, now } = deps;
  const { latest, history } = normalizeThread(thread);
  const notes: string[] = [];

  // 1. classify the latest email
  const cls = await reasoner.classify(latest, history, !!prior?.onsinch_order_id);

  // 2. compose the reply (always — every inbound gets a draft)
  const reply = await reasoner.composeReply(latest, history, cls.classification);
  const replyHash = hash(reply.html);

  // 3. only a real job triggers the order path
  const isJob = cls.classification === "new-job" || cls.classification === "update";
  let facts: ConversationFacts = prior?.facts ?? { requests: [] };
  let desired = null as ConversationState["desired_order"];
  let needs_human = false;
  let company_id = prior?.company_id;
  let user_id = prior?.user_id;
  let place_id = prior?.place_id;

  if (isJob) {
    facts = await reasoner.extractFacts(latest, history);
    const [co, pl, us] = await Promise.all([
      resolveCompany(facts, prior, onsinch),
      resolvePlace(facts, prior, onsinch),
      resolveUser(facts, prior, onsinch),
    ]);
    company_id = co.id ?? company_id;
    place_id = pl.id ?? place_id;
    user_id = us.id ?? user_id;
    [co, pl, us].forEach((r) => r.note && notes.push(r.note));

    if (company_id && user_id && place_id) {
      const composed = composeOrder({
        facts,
        company_id,
        user_id,
        place_id,
        orderName: (latest.subject || facts.requests[0]?.task || "Spartan Crew job").slice(0, 80),
        jobName: jobNameFrom(facts),
      });
      composed.warnings.forEach((w) => notes.push(w));
      desired = composed.order;
      if (desired) {
        const errs = validateOrder(desired);
        if (errs.length) {
          needs_human = true;
          notes.push(...errs);
        }
      }
    } else {
      needs_human = true; // unresolved ids -> a human confirms before we book
    }
  }

  // 4. decide actions (reads already happened; writes are returned only)
  const actions: Actions = {};
  if (!prior || prior.last_reply_hash !== replyHash) {
    actions.createReplyDraft = {
      subject: reply.subject,
      html: reply.html,
      in_reply_to: latest.message_id,
    };
  }
  const desiredHash = desired ? hash(JSON.stringify(desired)) : undefined;
  if (desired && !needs_human) {
    if (prior?.onsinch_order_id) {
      // only patch if the desired order actually changed since we last sent it
      if (desiredHash !== prior.last_ordered_hash) {
        actions.patchOrder = { order_id: prior.onsinch_order_id, desired };
      }
    } else {
      actions.createOrder = desired;
    }
  }
  if (!actions.createReplyDraft && !actions.createOrder && !actions.patchOrder) {
    actions.none = true;
  }

  const status: ConversationState["status"] = needs_human
    ? "error"
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
    onsinch_order_id: prior?.onsinch_order_id,
    onsinch_order_number: prior?.onsinch_order_number,
    desired_order: desired,
    last_ordered_hash: prior?.last_ordered_hash,
    priority: cls.priority,
    reply_body_html: reply.html,
    reply_subject: reply.subject,
    reply_draft_id: prior?.reply_draft_id,
    last_reply_hash: replyHash,
    needs_human,
    status,
    notes,
    order_action_log: prior?.order_action_log ?? [],
  };

  return { state, actions };
}
