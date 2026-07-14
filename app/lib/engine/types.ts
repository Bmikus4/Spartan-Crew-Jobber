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
}

/** The order this conversation wants to create/patch, fully structured. */
export interface DesiredOrder {
  name: string;
  company_id: number;
  user_id: number;
  request_approval: true; // hardcoded business rule
  job_name: string;
  slot_teams: DesiredSlotTeam[];
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
  id: number;
  name?: string;
  address?: string;
  city?: string;
  zip?: string;
  country?: string;
  lat?: number;
  lng?: number;
  alias?: string;
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
  onsinch_order_number?: string;

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
    kind: "create" | "patch";
    desired: DesiredOrder;
    order_id?: number;               // present for a patch
  };
  status: "open" | "drafted" | "proposed" | "ordered" | "error" | "ignored";
  notes: string[];
  order_action_log: Array<{
    ts: number;
    kind: "create" | "patch";
    order_id?: number;
    ok: boolean;
    error?: string;
  }>;
}

/** Client-tunable settings (surfaced in the Vercel settings menu). */
export interface Settings {
  /**
   * draft-only  = replies drafted + orders STAGED for one-click confirm (launch default)
   * auto        = replies drafted + confident orders written to OnSinch hands-free
   */
  order_mode: "draft-only" | "auto";
}

export const DEFAULT_SETTINGS: Settings = { order_mode: "draft-only" };

/** The actions the executor should perform after a compile. */
export interface Actions {
  createReplyDraft?: { subject: string; html: string; in_reply_to: string };
  createOrder?: DesiredOrder;
  patchOrder?: { order_id: number; desired: DesiredOrder };
  none?: boolean;
}
