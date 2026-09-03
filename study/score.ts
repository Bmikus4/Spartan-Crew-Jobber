// ============================================================================
// WHAT COUNTS AS A CORRECT BOOKING.
// ----------------------------------------------------------------------------
// The headline number is CONJUNCTIVE, and that is the most important decision in
// this study. A case passes only if every applicable gate passes.
//
// The alternative — averaging the gates — reports 90% for an engine that books
// the right crew on the wrong day every tenth time, because nine fields were
// right. Nobody at Spartan would call that booking 90% correct. The client
// turns up to an empty hall or the crew turn up to a locked door, and the whole
// order is wrong. So a booking is right or it is not, and the per-gate rates
// exist underneath the headline to say WHY it was not.
//
// Ten gates, each naming a real consequence:
//
//   G1 classification   an invoice query booked as a job, or a job read as junk
//   G2 disposition      written when it should have held, or held when it could go
//   G3 headcount        crew missing from a site, or crew Spartan pays for twice
//   G4 team count       two calls merged into one, or one call split into two
//   G5 dates            crew on the wrong day — the failure that costs a client
//   G6 windows          crew on the right day at the wrong hour
//   G7 venue            crew at the wrong building, or a duplicate row created
//   G8 professions      a forklift job staffed with labourers
//   G9 abstention       a trade the tenant cannot supply, booked in silence
//   G10 invariants      anything OnSinch would reject, or the engine contradicting itself
// ============================================================================
import { CHIEF_ID, PLACEHOLDER_PLACE_NAME, ROLE_BY_KEY, VENUE_BY_KEY } from "./gold";
import { invariants, clientNamedAChief, type Expectation, type Violation } from "./oracle";
import type { StudyCase } from "./cases";

export type Disposition = "written" | "held" | "not-bookable" | "no-change" | "error";

/** The engine's own vocabulary, mapped to the one a booker uses. */
export function dispositionOf(status: string | undefined): Disposition {
  switch (status) {
    case "ordered": return "written";
    case "proposed": return "held";       // composed, staged for a click
    case "needs-info": return "not-bookable";
    case "error": return "error";
    default: return "no-change";          // drafted / ignored / open
  }
}

export interface ObservedTeam {
  size: number;
  profession_id: number;
  place_id: number;
  beginning: string;
  end: string;
  name: string;
}

export interface Observed {
  classification?: string;
  status?: string;
  needs_human?: boolean;
  teams: ObservedTeam[];
  order: {
    pricelist_category_id?: number;
    provision_place?: unknown;
    rate_card_source?: string;
    slot_teams?: ObservedTeam[];
  } | null;
  pending_order?: unknown;
  onsinch_order_id?: number;
  notes: string[];
  error?: string;
}

export const GATES = [
  "classification", "disposition", "headcount", "teamCount",
  "dates", "windows", "venue", "professions", "abstention", "invariants",
] as const;
export type Gate = (typeof GATES)[number];

export interface Scored {
  id: string;
  cell: Record<string, string | number | boolean>;
  /** null where the gate does not apply to this case. */
  gates: Record<Gate, boolean | null>;
  /** The conjunction over applicable gates. THE number. */
  pass: boolean;
  /** The first gate that failed, for a one-word cause column. */
  firstFail: Gate | null;
  violations: Violation[];
  detail: string[];
  expectedDisposition: Disposition;
  actualDisposition: Disposition;
}

const multiset = (xs: string[]) => xs.slice().sort().join(" ~ ");

/**
 * The day a team works, read off its stamp.
 *
 * Deliberately the LOCAL day rather than the UTC one: a shift stamped
 * 2027-03-01T00:30:00+01:00 is the small hours of the 1st to everybody
 * involved, and slicing the UTC instant would call it the 28th of February and
 * report a correct booking as a date miss.
 */
const dayOf = (stamp: string) => String(stamp).slice(0, 10);

export function scoreCase(
  c: StudyCase,
  exp: Expectation,
  obs: Observed,
  which: "new" | "amend" = "new",
  /**
   * Every id that IS the "No Location" placeholder for this case: the tenant's
   * own row where it exists, plus any this run provisioned under that name.
   */
  placeholderIds: ReadonlySet<number> = new Set()
): Scored {
  const gates = Object.fromEntries(GATES.map((g) => [g, null])) as Record<Gate, boolean | null>;
  const detail: string[] = [];
  const blocks = which === "amend" ? c.amend!.truth.blocks : c.truth.blocks;

  // ---------------------------------------------------------------- G1
  const wantClass =
    c.kind === "not-a-job" ? "not-a-job"
    : c.kind === "confirmation-only" ? "confirmation-only"
    : which === "amend" ? "update" : "new-job";
  gates.classification = obs.classification === wantClass;
  if (!gates.classification) detail.push(`classification: want ${wantClass}, got ${obs.classification}`);

  // ---------------------------------------------------------------- G2
  const actual = dispositionOf(obs.status);
  /**
   * "held" is accepted wherever the oracle says "written".
   *
   * Holding a correct order for a click is a POSTURE, not an error — it is what
   * draft-only mode is for, and Spartan runs it deliberately. What must never
   * happen is the reverse: an order written when it should have been held. So
   * the gate is asymmetric on purpose, and the two are counted separately in
   * the report so the posture is visible rather than hidden inside a pass.
   */
  gates.disposition =
    exp.disposition === "written" ? (actual === "written" || actual === "held")
    : exp.disposition === "not-bookable" ? (actual === "not-bookable" || actual === "held")
    : exp.disposition === "no-change" ? (actual === "no-change" || actual === "not-bookable")
    : actual === exp.disposition;
  if (!gates.disposition) detail.push(`disposition: want ${exp.disposition}, got ${actual} (status ${obs.status})`);

  // The order gates only apply where an order was meant to be composed at all.
  const orderExpected = exp.disposition === "written" && exp.teams.length > 0;
  if (orderExpected) {
    const got = obs.teams;

    // ------------------------------------------------------------ G3
    const wantHead = exp.requested;
    const gotHead = got.reduce((n, t) => n + t.size, 0);
    // A client who named a chief legitimately adds a head, so the conservation
    // rule does not apply to them.
    gates.headcount = clientNamedAChief(blocks) ? gotHead >= wantHead : gotHead === wantHead;
    if (!gates.headcount) detail.push(`headcount: client asked for ${wantHead}, order carries ${gotHead}`);

    // ------------------------------------------------------------ G4
    gates.teamCount = got.length === exp.teams.length;
    if (!gates.teamCount) detail.push(`teams: want ${exp.teams.length}, got ${got.length}`);

    // ------------------------------------------------------------ G5
    const wantDays = multiset(exp.teams.map((t) => dayOf(t.beginning)));
    const gotDays = multiset(got.map((t) => dayOf(t.beginning)));
    gates.dates = wantDays === gotDays;
    if (!gates.dates) detail.push(`dates: want [${wantDays}], got [${gotDays}]`);

    // ------------------------------------------------------------ G6
    const wantWin = multiset(exp.teams.map((t) => `${t.beginning}..${t.end}`));
    const gotWin = multiset(got.map((t) => `${t.beginning}..${t.end}`));
    gates.windows = wantWin === gotWin;
    if (!gates.windows) detail.push(`windows: want [${wantWin}], got [${gotWin}]`);

    // ------------------------------------------------------------ G7
    /**
     * A venue the tenant does not hold is CREATED from the client's own words —
     * Ben, 2026-09-03. This gate expected the "No Location" placeholder instead
     * for three days, under his 2026-08-31 ruling, and scoring a run against a
     * ruling the engine no longer follows costs 3.8 points of headline accuracy
     * with nothing wrong in the engine. See test/venueCreatesOnUnresolved.ts.
     *
     * So the shape to recognise is `provision_place` carrying something that is
     * NOT the placeholder. The placeholder is still expected, but only where no
     * venue was named at all, and it shows up two ways depending on whether the
     * row exists yet: as `provision_place: { name: "No Location" }` with
     * place_id 0 on the first thread that needs it, and as an ordinary matched
     * id every time after.
     *
     * Matched team by team rather than as a multiset of ids, because a multiset
     * cannot tell "both blocks at the right venue" from "both blocks at each
     * other's venue" — and swapping two blocks between two sites is exactly the
     * failure that sends crew to the wrong building.
     */
    const provisionName = String(
      (obs.order?.provision_place as { name?: string } | undefined)?.name ?? ""
    ).trim();
    const provisioningPlaceholder =
      !!obs.order?.provision_place && provisionName.toLowerCase() === PLACEHOLDER_PLACE_NAME.toLowerCase();
    const provisioningVenue = !!obs.order?.provision_place && !provisioningPlaceholder;
    const heldWrong: string[] = [];
    let venueOk = got.length === exp.teams.length;
    if (venueOk) {
      // Pair expected to observed on everything BUT the place, so a swap shows.
      const sig = (t: { size: number; profession_id: number; beginning: string; end: string }) =>
        `${t.beginning}|${t.end}|${t.profession_id}|${t.size}`;
      const pool = got.map((t, i) => ({ t, i, used: false }));
      for (const e of exp.teams) {
        const m = pool.find((p) => !p.used && sig(p.t) === sig(e as any));
        if (!m) { venueOk = false; heldWrong.push(`no observed team matches ${sig(e as any)}`); continue; }
        m.used = true;
        if (e.place_id === null) {
          // A venue the tenant does not hold. Correct is a row created from what
          // the client wrote: place_id 0 awaiting the provision this order
          // carries. Landing on the placeholder is now a MISS — the client gave
          // an address and the engine threw it away.
          const isCreated = m.t.place_id === 0 && provisioningVenue;
          if (!isCreated) {
            venueOk = false;
            heldWrong.push(
              placeholderIds.has(m.t.place_id) || (m.t.place_id === 0 && provisioningPlaceholder)
                ? `unheld venue parked on the "${PLACEHOLDER_PLACE_NAME}" placeholder — the client's address was discarded, expected a new venue`
                : `unheld venue booked to place ${m.t.place_id}, expected a new venue created from the client's words`
            );
          }
        } else if (m.t.place_id !== e.place_id) {
          venueOk = false;
          heldWrong.push(`want place ${e.place_id}, got ${m.t.place_id}`);
        }
      }
    } else {
      heldWrong.push(`team count differs (${got.length} vs ${exp.teams.length}) — venue not comparable`);
    }
    gates.venue = venueOk;
    if (!venueOk) {
      const names = [...new Set(blocks.map((b) => VENUE_BY_KEY.get(b.venue)!.row))].join(" | ");
      detail.push(`venue: ${heldWrong.join("; ")} (${names})`);
    }

    // ------------------------------------------------------------ G8
    const wantProf = multiset(exp.teams.map((t) => String(t.profession_id)));
    const gotProf = multiset(got.map((t) => String(t.profession_id)));
    gates.professions = wantProf === gotProf;
    if (!gates.professions) {
      const said = [...new Set(blocks.map((b) => `${ROLE_BY_KEY.get(b.role)!.said[0]}->${ROLE_BY_KEY.get(b.role)!.id}`))].join(", ");
      detail.push(`professions: want [${wantProf}] (${said}), got [${gotProf}]`);
    }
  }

  // ---------------------------------------------------------------- G9
  /**
   * A trade the tenant has no row for. Booking general Crew IS the right answer
   * — there is nothing else to book — so this is not a profession miss. The
   * failure is doing it in SILENCE: a rigger booked as labour and a rigger
   * booked as labour with somebody called are the same order and completely
   * different outcomes.
   */
  if (exp.abstentions > 0 && orderExpected) {
    gates.abstention = obs.needs_human === true;
    if (!gates.abstention) {
      const trades = [...new Set(blocks.filter((b) => ROLE_BY_KEY.get(b.role)?.abstain).map((b) => b.role))].join(", ");
      detail.push(`abstention: "${trades}" has no row in the tenant and nobody was called (needs_human=${obs.needs_human})`);
    }
  }

  // ---------------------------------------------------------------- G10
  const violations = invariants(
    obs.order,
    { status: obs.status, needs_human: obs.needs_human, pending_order: obs.pending_order, onsinch_order_id: obs.onsinch_order_id },
    exp,
    clientNamedAChief(blocks)
  );
  gates.invariants = violations.length === 0;
  if (violations.length) detail.push(`invariants: ${violations.map((v) => v.rule).join(", ")}`);

  // A thrown case fails outright, whatever else it managed.
  if (obs.error) {
    gates.disposition = false;
    detail.push(`threw: ${obs.error}`);
  }

  const applicable = GATES.filter((g) => gates[g] !== null);
  const pass = applicable.every((g) => gates[g] === true);
  const firstFail = applicable.find((g) => gates[g] === false) ?? null;

  return {
    id: c.id, cell: c.cell, gates, pass, firstFail: firstFail ?? null,
    violations, detail,
    expectedDisposition: exp.disposition, actualDisposition: actual,
  };
}

/** Everyone on the order, chiefs included. */
export const headcountOf = (teams: ObservedTeam[]) => teams.reduce((n, t) => n + t.size, 0);
export const chiefsOf = (teams: ObservedTeam[]) =>
  teams.filter((t) => t.profession_id === CHIEF_ID).reduce((n, t) => n + t.size, 0);
