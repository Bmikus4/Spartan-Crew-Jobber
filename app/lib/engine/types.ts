// ============================================================================
// Spartan Crew Enquiry Engine — core types
// ----------------------------------------------------------------------------
// The whole system is: an inbound Gmail event -> hydrate the full thread ->
// COMPILE (thread + prior state) into a NEW state row -> diff -> execute.
// One Gmail thread == one row in the Save State Table. This is the dedup key
// and the "never miss a lead" guarantee: every thread has exactly one row,
// and re-running the compile is idempotent.
// ============================================================================

/** A single cleaned message inside a conversation. */
export interface ThreadMessage {
  message_id: string;
  from: string;          // sender email address
  to: string[];
  date_iso: string;      // ISO-8601, used to order the conversation
  subject: string;
  body: string;          // cleaned plain text (quotes/signatures stripped)
  is_from_spartan: boolean;
  /**
   * RFC headers, when the transport forwards them. Optional because the n8n payload does
   * not today — and that absence is why bulk mail has to be guessed from the body, which
   * finds it on 0.6% of the corpus against a header that would find nearly all of it.
   */
  headers?: Record<string, string | undefined>;
}

/** A hydrated Gmail thread — the raw input to the compiler. */
export interface HydratedThread {
  thread_id: string;
  messages: ThreadMessage[]; // chronological, oldest first
}

/** What kind of message the *latest* inbound email is, w.r.t. the order. */
export type Classification =
  | "new-job"
  | "update"
  | "confirmation-only"
  | "not-a-job";

/** Profession ids Spartan actually uses (from the live PROFESSION LIST). */
export const PROFESSION = {
  CREW: 1,
  CARPENTER: 3,
  DRIVER: 9,
  AV: 16,
  CSCS: 32,
  CREW_CHIEF: 36,
} as const;

/** One shift block requested in the conversation. */
export interface DesiredSlotTeam {
  name: string;
  profession_id: number;
  beginning: string;     // ISO-8601 with offset
  end: string;           // ISO-8601 with offset
  size: number;
  place_id: number;      // MANDATORY on every slot team (top cause of 400s)
  description?: string;
}

/**
 * The order this conversation wants to create/patch — the full verified OnSinch
 * DRAFT-order shape (provisional + quote posture, explicit rate card).
 */
export interface DesiredOrder {
  name: string;
  company_id: number;
  user_id: number;
  request_approval: true;      // hardcoded business rule
  provisional: boolean;        // THE draft flag
  quote: boolean;              // draft/quote posture
  pricelist_category_id: number; // THE RATE CARD (I1 — never OnSinch's silent default)
  job_name: string;
  slot_teams: DesiredSlotTeam[];
  specification?: string;      // the job summary
  intern_name?: string;        // PO / customer reference ONLY
  order_manager_id?: number;   // Spartan-side manager
  supervisor_id?: number;      // job supervisor
  /**
   * Tool 2 — when the venue isn't already in OnSinch, the place is created on
   * write (reference data, no contact dependency) and its id backfilled onto
   * every slot team. place_id is 0 on the slot teams until then.
   */
  provision_place?: { name: string; country: string; address?: string; city?: string; zip?: string };
  /**
   * The same, for a client who is not yet in OnSinch. Ben, 2026-08-09: "if company
   * or venue location are not found in the system, always create new ones if they
   * can be inferred."
   *
   * company_id is 0 until the write path creates it. It exists as an intent on the
   * order rather than a create at compile time because compile() must stay a pure
   * read — it is re-run on every message in a thread, and a create there would make
   * a duplicate company per email.
   */
  provision_company?: { name: string };
  /**
   * Where pricelist_category_id came from. "default" means the house standard
   * was applied to a client with no pricing history, and such an order is never
   * written hands-free - see pipeline.ts.
   */
  rate_card_source?: "seeded" | "history" | "default";
}

/**
 * Typed facts extracted from the conversation. This REPLACES the old
 * "stream:query:data" verbatim-line hack with a real structure.
 */
export interface ConversationFacts {
  company_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  customer_reference?: string;
  location_text?: string;    // best destination address / venue string
  // one requested block per distinct date/size/task
  requests: Array<{
    date?: string;           // YYYY-MM-DD (or undefined => TBC)
    start_time?: string;     // HH:MM
    end_time?: string;       // HH:MM
    size?: number;
    task?: string;           // free text describing the work
    profession_hint?: string;// e.g. "CSCS", "driver", "AV"
  }>;
}

/** A resolved OnSinch place candidate (subset of the Place schema). */
export interface PlaceCandidate {
  /** OnSinch's short form for the venue — "RAH" for the Royal Albert Hall. */
  alias?: string;
  /** Retired venues stay in the list; matchPlace prefers an active one. */
  active?: boolean;
  id: number;
  name?: string;
  address?: string;
  city?: string;
  zip?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

/** One row of the Save State Table — the canonical state of a conversation. */
export interface ConversationState {
  thread_id: string;                 // PK
  subject: string;
  participants: string[];
  last_message_id: string;
  last_processed_epoch: number;

  classification: Classification;
  facts: ConversationFacts;

  // resolved entities — cached once known so we never re-resolve/guess
  company_id?: number;
  user_id?: number;
  place_id?: number;

  // the order this thread maps to (dedup: thread -> order)
  onsinch_order_id?: number;
  /**
   * The identifiers a human types into OnSinch, which are NOT the api ids:
   * the order is `R<order.number>` and the job inside it is `J<Job.id>`.
   * Verified against the tenant — a price-quote attachment OnSinch generated
   * itself reads "R10560 … J13925", and `GET /orders?number=10560&with=Job`
   * returns api id 13645 with `Job[0].id` 13925. So the api order id (13645)
   * appears in neither, and pasting it into the search box finds nothing.
   *
   * Clients quote the J number back at us unprompted ("PO for Job J13918"), so
   * it is the one identifier both sides of the conversation share.
   */
  onsinch_order_number?: string;
  onsinch_job_id?: number;

  desired_order: DesiredOrder | null; // null => info-only / not a job
  last_ordered_hash?: string;         // hash of the last order we actually sent

  // reply
  priority: "low" | "medium" | "high";
  reply_body_html?: string;
  reply_subject?: string;
  reply_draft_id?: string;
  last_reply_hash?: string;

  // control
  needs_human: boolean;              // confidence gate for handsfree
  // an order the engine WANTS to write but is holding for human confirm
  // (always set in draft-only mode; this is the dashboard confirm queue).
  pending_order?: {
    kind: "create" | "patch" | "replace";
    desired: DesiredOrder;
    order_id?: number;               // present for a patch or a replace
  };
  /**
   * A destructive replace that is part-way through. Crew and time changes cannot be
   * PATCHed (nested slot teams expose no ids, GET /slot_teams is 405), so the only
   * route is delete-then-post — and that has a window in which the old order is gone
   * and the new one does not exist yet.
   *
   * This is what closes that window. It is written BEFORE the delete, carries a full
   * snapshot of the order about to be destroyed, and `deleted` is flipped the moment
   * it is gone. A resumed run reads this instead of guessing: `deleted: true` means
   * post the replacement, never delete again.
   */
  order_replace?: {
    order_id: number;
    deleted: boolean;
    /** The order as OnSinch held it, read immediately before deletion. */
    snapshot?: unknown;
    ts: number;
  };
  /**
   * Fingerprint of the slot teams last actually written to OnSinch. This is what
   * distinguishes "the client changed the crew" (needs a replace) from "the client
   * sent a PO number" (a patch will do), so a harmless follow-up never triggers a
   * delete-and-repost of a real order.
   */
  last_ordered_teams_hash?: string;
  /**
   * needs-info = the engine did its job but cannot proceed without a human
   *              (no company name in the email, unknown sender, new venue).
   *              Expected and routine.
   * error      = something actually FAILED, e.g. an OnSinch write threw.
   *
   * These were both "error", which meant a real write failure was
   * indistinguishable from a routine "we need the company name" on the Jobs
   * Board — the dangerous direction, since genuine failures hid in the noise.
   */
  status: "open" | "drafted" | "proposed" | "ordered" | "needs-info" | "error" | "ignored";
  notes: string[];
  order_action_log: Array<{
    ts: number;
    kind: "create" | "patch" | "replace" | "replace-refused";
    order_id?: number;
    ok: boolean;
    error?: string;
  }>;
}

/** Client-tunable settings (surfaced in the Vercel settings menu). */
export interface Settings {
  /**
   * draft-only  = orders STAGED for one-click confirm (launch default)
   * auto        = confident orders written to OnSinch hands-free
   */
  order_mode: "draft-only" | "auto";
  /**
   * Tool 1 — the verbatim Spartan reply generator. OFF by default: the engine
   * still classifies + does order work, but drafts NO reply until this is on.
   */
  replies_enabled: boolean;
  /**
   * The second of Ben's two reply settings: once replies ARE on, is the reply
   * left as a Gmail draft for a human to send, or sent outright?
   * DRAFT by default. N/A while replies_enabled is false.
   */
  reply_delivery: "draft" | "send";
  /**
   * WHICH threads get a reply, once replies are on.
   *
   *   all       every thread the engine reads, acknowledgements included
   *   enquiries only threads carrying a crew request — a new job, or a change
   *             to one. Confirmations and everything else pass silently.
   *
   * Measured before this existed: over a 10-thread sample across all
   * classifications, 7 were confirmation-only or not-a-job and produced correct
   * but low-value drafts — "PO received, thank you!", "you too, have a great
   * weekend!". On the live board that shape is ~45% of threads, and every one is
   * a draft somebody opens and then deletes.
   *
   * Neither answer is safer than the other, which is why it is a setting and not
   * a rule: a reply nobody needed is a wasted click, a missing reply is a client
   * left waiting. Ben chose "all" as the default (2026-08-09).
   */
  reply_scope: "all" | "enquiries";
  /**
   * The rate card for a client with no pricing history — a brand-new company, or
   * one whose recent orders are genuinely mixed. 0 means no fallback: the thread
   * holds for a human, which is what happened before this existed.
   *
   * I1 says an order never goes out without an explicit pricelist_category_id,
   * because OnSinch silently assigns its own otherwise — card 245, which is
   * Tracy's original wrong-rate failure and still shows up on 7 first orders in
   * the recent window, almost certainly where nobody set one.
   *
   * But I1 was also blocking every new client outright, since a company with no
   * orders has no history to derive a card from. 315 is the house standard by a
   * wide margin, measured over the 498 recent orders that carry a card:
   *
   *     card 315   70.3% of all orders   75.0% of companies' FIRST orders
   *     card 342    9.8%                  7.1%
   *     card 245    2.0%                  5.0%   <- the silent default, not a choice
   *
   * So three new clients in four are priced correctly by this, and the fourth is
   * caught because an order priced this way is NEVER written hands-free: it is
   * staged for a human whatever order_mode says (pipeline.ts), and the ticket says
   * the card was assumed. Money is the one thing worth a click.
   */
  default_rate_card: number;
}

export const DEFAULT_SETTINGS: Settings = {
  order_mode: "draft-only",
  replies_enabled: false,
  reply_delivery: "draft",
  reply_scope: "all",
  default_rate_card: 315,
};

/** The actions the executor should perform after a compile. */
export interface Actions {
  createReplyDraft?: { subject: string; html: string; in_reply_to: string };
  createOrder?: DesiredOrder;
  patchOrder?: { order_id: number; desired: DesiredOrder };
  none?: boolean;
}
