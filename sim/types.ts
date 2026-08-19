// ============================================================================
// The scenario language for the 100-booking simulation.
// ----------------------------------------------------------------------------
// A case is DECLARATIVE: it says what the client asked for, not what the engine
// should do about it. sim/oracle.ts turns the same declaration into an expected
// outcome, independently of the engine, and sim/run.ts compares the two.
//
// The email body is GROUND TRUTH. It is generated from these blocks (see
// bodyFor in harness.ts) and the scripted reasoner extracts exactly what the
// block states — a perfect model. An unstated field is absent from the body AND
// absent from the facts, so parseWork's reconcile has nothing to fill and the
// engine's own defaults are what get exercised. Any other arrangement would
// measure the generator instead of the engine.
// ============================================================================

/** One requested block of work, as the client stated it. */
export interface SimBlock {
  /** People asked for. Omitted = the client named no number (composes to nothing). */
  size?: number;
  /** The words the client used for the role, if any. */
  prof?: string;
  /** YYYY-MM-DD. Omitted = the client said TBC. */
  date?: string;
  /** HH:MM. Omitted = not stated, so the engine's 08:00 default applies. */
  start?: string;
  /** HH:MM. Omitted = not stated, so the engine's 18:00 default applies. */
  end?: string;
  /** Free text describing the work; becomes the slot team name. */
  task?: string;
  /** A venue named for THIS block only — the crew-moves-between-venues shape. */
  venue?: string;
  /**
   * The profession a booker SHOULD pick for this wording, labelled by hand off the
   * tenant's own 43-row list.
   *
   * A gold standard, not a second implementation. Paraphrasing the resolver's cue
   * table into the oracle only measures whether the paraphrase is faithful — it
   * called "IPAF 3a/3b operators" unrecognised when the tenant has profession 5 of
   * exactly that name, and marked the engine wrong for being right. A label is a
   * judgement about the booking, made from the list, and it is the only thing that
   * can disagree with the code usefully.
   */
  expect_profession?: number;
}

/**
 * Which client the enquiry is from, which is really a question about the rate card:
 *   history    an existing client whose recent orders agree -> card from history
 *   nohistory  an existing client with no orders            -> assumed card, HOLDS
 *   new        not in OnSinch at all                        -> company provisioned
 */
export type SimClient = "history" | "nohistory" | "new";

export interface SimCase {
  id: string;
  label: string;
  /** Which factors this case is covering, for the per-axis breakdown. */
  tags: string[];
  client: SimClient;
  /** The venue for the job as a whole. */
  venue?: string;
  blocks: SimBlock[];
  /** Customer reference / PO, which lands in intern_name. */
  po?: string;
  /**
   * A second email on the same thread. Two handleThread runs against one store,
   * which is what puts real hashes and a real action log in place — the only way
   * the replace path is reachable.
   */
  amend?: {
    blocks: SimBlock[];
    /** The model flags the client as calling it off. Never acted on. */
    cancellation?: boolean;
    /** What the classifier calls the second message. */
    classification?: "update" | "confirmation-only" | "not-a-job";
  };
  /**
   * Another thread already in the store that agrees on client + date + venue.
   * duplicate = same window and size; extension = same day, different window.
   */
  twin?: "duplicate" | "extension";
  /** The existing order reads back from OnSinch as confirmed, so a replace must refuse. */
  orderConfirmed?: boolean;
  /** The first message is not a booking at all. */
  classification?: "new-job" | "confirmation-only" | "not-a-job";
}
