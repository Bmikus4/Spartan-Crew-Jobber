// ============================================================================
// What the settled rules say each case should produce, worked out from the case
// and not from the engine.
// ----------------------------------------------------------------------------
// Two instruments, and the difference between them is the point.
//
// PREDICTION re-states the rules — the chief bands and the carve-out, the merge
// key, the 08:00/18:00 defaults, day rate at 8h STATED, the four hold conditions.
// It mirrors compose.ts's algorithm because for these rules the algorithm IS the
// rule, so a disagreement means one of the two read Ben's ruling differently. It
// is a consistency check, and it is worth exactly what a consistency check is
// worth.
//
// INVARIANTS are the real evidence. They are properties that must hold whatever
// the implementation does — headcount conservation, every team placed, the rate
// card never absent, Crew Boss never reachable, nothing written while held. They
// cannot be satisfied by copying the implementation, because they were not
// derived from it.
// ============================================================================
import type { DesiredOrder, DesiredSlotTeam, ConversationState } from "../app/lib/engine/types";
import { validateOrder, SLOT_TEAM_NAME_MAX } from "../app/lib/engine/format";
import type { SimBlock, SimCase } from "./types";

// ------------------------------------------------------------------ prediction
/** Ben, Q9(a): 4 -> 1 chief, 10 -> 2, 20 -> 3. Bands, not a ratio. */
export function bandChiefs(size: number): number {
  if (size >= 20) return 3;
  if (size >= 10) return 2;
  if (size >= 4) return 1;
  return 0;
}

const CHIEF_ID = 36;

/**
 * The offset a London wall clock carries, restated here rather than imported.
 *
 * The rule: a client's time is Europe/London, OnSinch stores a true instant, so
 * the stamp needs +01:00 through British Summer Time and +00:00 outside it. This
 * is worked out from the IANA zone directly — a different route to the same
 * answer than compose.ts takes, which is the whole point of an oracle.
 */
function londonStamp(day: string, clock: string): string {
  const pad = (c: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(c);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : c;
  };
  const hm = pad(clock);
  const offsetAt = (ms: number) => {
    const name = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", timeZoneName: "shortOffset",
    }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-]\d{1,2})?/.exec(name);
    return m?.[1] ? Number(m[1]) * 60 : 0;
  };
  const wall = Date.parse(`${day}T${hm}:00Z`);
  if (!Number.isFinite(wall)) return `${day}T${hm}:00+00:00`;
  const mins = offsetAt(wall - offsetAt(wall) * 60000);
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  return `${day}T${hm}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Hours in a window, an end at or before the start being an overnight. */
export function hoursOf(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const from = sh * 60 + sm;
  const to = eh * 60 + em;
  return ((to <= from ? to + 1440 : to) - from) / 60;
}

/** Ten hours after `start`, wrapping past midnight. */
export function plus10(start: string): string {
  const [h, m] = start.split(":").map(Number);
  const t = (h * 60 + m + 600) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** The calendar day a window ENDS on: the next one when it crosses midnight. */
export function endDay(date: string, start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (eh * 60 + em > sh * 60 + sm) return date;
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/** The profession the rules choose for a hint, before rate twins are considered. */
export function predictProfession(hint?: string): { id: number; family: string } {
  const t = (hint ?? "").toLowerCase();
  if (!t) return { id: 1, family: "crew" };
  if (/crew chief|\bchief\b|crew lead|crew manager|\bboss\b/.test(t)) return { id: CHIEF_ID, family: "chief" };
  if (/\bcscs\b/.test(t)) return { id: 32, family: "cscs" };
  if (/chippy|carpenter/.test(t)) return { id: 3, family: "carpenter" };
  if (/driver|driving/.test(t)) return { id: 9, family: "driver" };
  if (/\bav\b|audio ?visual/.test(t)) return { id: 16, family: "av" };
  if (/rough terrain|all terrain/.test(t)) return { id: 17, family: "roughterrain" };
  if (/forklift|counterbalance/.test(t)) return { id: 11, family: "counterbalance" };
  if (/telehandler|telehander/.test(t)) return { id: 4, family: "telehandler" };
  return { id: 1, family: "crew" }; // unrecognised resolves DOWN to Crew, never up
}

/**
 * Plant professions come in hourly/day twins; day rate at 8h or more (Q8).
 * The pairs are the ones professions.ts names: 4/23 Telehandler U<9M, 7/24 O>9M,
 * 11/22 Counterbalance, 17/25 Rough Terrain.
 */
export const PLANT_FAMILIES = new Set(["telehandler", "counterbalance", "roughterrain"]);
const DAY_TWIN: Record<number, number> = { 4: 23, 7: 24, 11: 22, 17: 25 };

export interface PredictedTeam {
  key: string;
  profession_family: string;
  profession_id: number;
  size: number;
  beginning: string;
  end: string;
  tbc: boolean;
}

/**
 * What should become of the enquiry. Coarser than a status string on purpose: the
 * question a booker asks is "is it on the board, is somebody looking at it, or did
 * nothing happen", and every finer distinction is the engine's own vocabulary.
 */
export type Outcome =
  | "written"        // an order reached OnSinch
  | "held"           // composed, deliberately not written, a human asked
  | "refused"        // a change could not be applied and said so
  | "not-bookable"   // nothing that could be posted could be built
  | "no-change";     // the message asked for nothing

export interface Prediction {
  /** No block carried a size, so there is nothing to compose. */
  empty: boolean;
  teams: PredictedTeam[];
  /** Everyone on the order, chiefs included — must equal what the client asked for. */
  headcount: number;
  requested: number;
  chiefs: number;
  outcome: Outcome;
  /** Why, where the rules give a reason. Reported, never scored on its own. */
  reason: null | "cross-thread" | "cancellation" | "empty-order" | "assumed-rate" | "tbc-has-no-times" | "confirmed-order";
}

/**
 * The order the rules predict for one set of blocks.
 *
 * `placeOf` is injected rather than resolved here: which OnSinch place a venue string
 * lands on is the resolver's own question, measured separately, and baking a second
 * answer to it in would make every venue case a test of two matchers at once.
 */
export function predictTeams(blocks: SimBlock[], placeOf: (venue?: string) => number): PredictedTeam[] {
  const sized = blocks.filter((b) => b.size !== undefined && (b.size as number) > 0);
  if (!sized.length) return [];

  // 1. one team per block, defaults applied
  const base = sized.map((b) => {
    const start = b.start || "08:00";
    // The default finish is 18:00, or ten hours — the length of the 08:00-18:00
    // default — whenever 18:00 is not after the start.
    const end = b.end || (start < "18:00" ? "18:00" : plus10(start));
    const stated = !!(b.start && b.end);
    const p = predictProfession(b.prof);
    // A day-rate twin is only reachable on a STATED shift: the 08:00-18:00 default is
    // ten hours, and reading it would put every untimed plant request on a day rate.
    const dayRate = stated && PLANT_FAMILIES.has(p.family) && hoursOf(start, end) >= 8;
    // The hand-labelled answer wins outright where the case carries one.
    const profession_id = b.expect_profession ?? (dayRate ? DAY_TWIN[p.id] ?? p.id : p.id);
    const place = placeOf(b.venue);
    /**
     * The date the engine will SETTLE on, not the one the model reported.
     *
     * A case carrying `expectDate` is a case whose point is that the engine corrects the
     * year — the next-occurrence rule moving a date the model guessed out of a year
     * already gone. Predicting from the raw `date` would score that correction as a
     * disagreement, which is how a rig ends up arguing against the behaviour it exists
     * to protect.
     */
    const day = b.expectDate ?? b.date;
    return {
      key: `${day ?? ""}|${start}|${end}|${place}|${profession_id}`,
      site: `${day ?? ""}|${start}|${end}|${place}`,
      profession_family: p.family + (PLANT_FAMILIES.has(p.family) ? (dayRate ? ":day" : ":hr") : ""),
      profession_id,
      family: p.family,
      size: b.size as number,
      beginning: day ? londonStamp(day, start) : "",
      // A finish at or before the start is tomorrow's finish. Stated as the RULE
      // rather than borrowed from compose, which is the point of an oracle — the
      // two are meant to be able to disagree. They did, for every overnight shift
      // this engine ever composed, and OnSinch refused all of them.
      end: day ? londonStamp(endDay(day, start, end), end) : "",
      tbc: !day,
    };
  });

  // 2. merge: same window, same place, same profession. Size NEVER splits a team.
  const merged = new Map<string, (typeof base)[number]>();
  for (const t of base) {
    const seen = merged.get(t.key);
    if (seen) seen.size += t.size;
    else merged.set(t.key, { ...t });
  }
  const teams = [...merged.values()];

  // 3. carve the chiefs out, crediting any the client named at the same site
  const credit = new Map<string, number>();
  for (const t of teams) if (t.profession_id === CHIEF_ID) credit.set(t.site, (credit.get(t.site) ?? 0) + t.size);
  const carved = new Map<string, number>();
  for (const t of teams) {
    if (t.profession_id === CHIEF_ID) continue;
    const have = credit.get(t.site) ?? 0;
    const want = bandChiefs(t.size);
    const need = want - have;
    if (need <= 0) { credit.set(t.site, have - want); continue; }
    credit.set(t.site, 0);
    t.size -= need;
    carved.set(t.site, (carved.get(t.site) ?? 0) + need);
  }

  const out: Array<PredictedTeam & { site: string }> = teams
    .filter((t) => t.size > 0)
    .map((t) => ({
      key: t.key, site: t.site, profession_family: t.profession_family, profession_id: t.profession_id,
      size: t.size, beginning: t.beginning, end: t.end, tbc: t.tbc,
    }));

  for (const [site, n] of carved) {
    if (n <= 0) continue;
    const existing = out.find((t) => t.profession_id === CHIEF_ID && t.site === site);
    if (existing) { existing.size += n; continue; }
    const anchor = teams.find((t) => t.site === site)!;
    out.push({
      key: `${site}|${CHIEF_ID}`, site, profession_family: "chief", profession_id: CHIEF_ID,
      size: n, beginning: anchor.beginning, end: anchor.end, tbc: anchor.tbc,
    });
  }
  return out.map(({ site, ...t }) => t);
}

export function predict(c: SimCase, placeOf: (venue?: string) => number, which: "new" | "amend"): Prediction {
  const blocks = which === "amend" ? c.amend!.blocks : c.blocks;
  /**
   * A second email that is only an acknowledgement composes NO order. The thread keeps
   * the order it already has; what it does not do is re-derive one from a "thanks".
   */
  const acknowledgement =
    which === "amend" && (c.amend?.classification === "confirmation-only" || c.amend?.classification === "not-a-job");
  const teams = acknowledgement ? [] : predictTeams(blocks, placeOf);
  const requested = blocks.reduce((n, b) => n + (b.size ?? 0), 0);
  const headcount = teams.reduce((n, t) => n + t.size, 0);
  const chiefs = teams.filter((t) => t.profession_id === CHIEF_ID).reduce((n, t) => n + t.size, 0);

  /**
   * In the order the pipeline decides. A twin is checked before a cancellation, so a
   * case that is both reports the twin — and nothing composable outranks everything,
   * because there is no order to hold or write.
   */
  let outcome: Outcome;
  let reason: Prediction["reason"] = null;
  // A message that is not a booking asks for nothing, whether it is the first in the
  // thread or the fifth. It is not "unbookable" — there was never anything to book.
  const notAnEnquiry = c.classification === "not-a-job" || c.classification === "confirmation-only";
  if (acknowledgement || notAnEnquiry) {
    outcome = "no-change";
  } else if (teams.length === 0) {
    outcome = "not-bookable";
    reason = "empty-order";
  } else if (teams.some((t) => !t.beginning || !t.end)) {
    /**
     * A block with no confirmed date composes with empty times, and validateOrder
     * rejects a slot team with no times — correctly, OnSinch would too. So a TBC job
     * is never bookable, whatever compose.ts's "(TBC)" suffix suggests.
     */
    outcome = "not-bookable";
    reason = "tbc-has-no-times";
  } else if (c.twin) {
    outcome = "held";
    reason = "cross-thread";
  } else if (which === "amend" && c.amend?.cancellation) {
    outcome = "held";
    reason = "cancellation";
  /**
   * A CLIENT WITH NO PRICING HISTORY IS NO LONGER A HOLD.
   *
   * This predicted "held / assumed-rate" for every case whose client was not `history`,
   * because an order priced from the standard card rather than the client's own history
   * was staged for a human instead of written.
   *
   * Ben overruled that on 2026-08-27: "there are meant to be as little unnecessary
   * blockers to creating a job as possible, as long as the actual content of the order can
   * be created properly." A rate card is not order content — it decides what the job is
   * INVOICED at, and it is Spartan's own number, not something the client supplies.
   *
   * The order is written and the thread carries `needs_human`, which now puts the "Manual"
   * label on it in the bookings mailbox. So the price still gets a person's eyes; the
   * booking no longer waits for them.
   *
   * The rule is gone rather than inverted — nothing about the client's history predicts
   * the outcome any more, so the case falls through to "written" with everything else.
   */
  } else if (which === "amend" && c.orderConfirmed) {
    outcome = "refused";
    reason = "confirmed-order";
  } else {
    outcome = "written";
  }

  return { empty: teams.length === 0, teams, headcount, requested, chiefs, outcome, reason };
}

// ------------------------------------------------------------------ invariants
export interface Violation { rule: string; detail: string }

/**
 * Properties that must hold whatever the engine did. Each one names a real failure:
 * a wrong headcount is crew missing from a site, an unplaced team is a 400, a missing
 * rate card is OnSinch's silent card 245 on an invoice.
 */
export function checkInvariants(
  c: SimCase,
  state: ConversationState,
  pred: Prediction,
  wire: unknown[],
  clientRequestedChief: boolean
): Violation[] {
  const v: Violation[] = [];
  const push = (rule: string, detail: string) => v.push({ rule, detail });
  const o = state.desired_order;
  const teams: DesiredSlotTeam[] = o?.slot_teams ?? [];

  /**
   * THE DATE THE CLIENT MEANT, not the one the model guessed.
   *
   * Checked here rather than through the oracle's outcome prediction, because the whole
   * point of these cases is that the engine CHANGES a date — and a changed date read as
   * an outcome would look like a disagreement instead of the correction it is.
   *
   * Only cases that set `expectDate` are checked, so this is silent for the rest.
   */
  for (const b of c.blocks) {
    if (!b.expectDate) continue;
    const day = b.expectDate;
    const got = teams.map((t) => String(t.beginning ?? "").slice(0, 10));
    if (!got.length) {
      push("date-reconciled", `expected a block on ${day}, but nothing was composed`);
    } else if (!got.includes(day)) {
      push("date-reconciled", `expected a block on ${day}, composed ${got.join(", ")}`);
    }
  }

  if (o) {
    // I1 — a rate card is never absent or zero. OnSinch assigns card 245 silently.
    if (!Number.isInteger(o.pricelist_category_id) || o.pricelist_category_id <= 0)
      push("rate-card-present", `pricelist_category_id=${o.pricelist_category_id}`);

    // I2 — headcount conservation. The carve-out moves people between teams, it
    // never creates or destroys them. Only checkable when the client named no chief
    // of their own, which is the case that legitimately adds a person.
    if (!clientRequestedChief && !pred.empty && pred.requested !== pred.headcount)
      push("prediction-headcount", `predicted ${pred.headcount} from a request for ${pred.requested}`);
    const actual = teams.reduce((n, t) => n + t.size, 0);
    if (!clientRequestedChief && actual !== pred.requested)
      push("headcount-conserved", `order carries ${actual}, client asked for ${pred.requested}`);

    for (const [i, t] of teams.entries()) {
      // I3 — every team is placed. The top cause of a 400 from OnSinch.
      if (!Number.isInteger(t.place_id) || (t.place_id === 0 && !o.provision_place))
        push("team-placed", `slot_teams[${i}].place_id=${t.place_id} with no provision_place`);
      // I4 — no empty team.
      if (!Number.isInteger(t.size) || t.size < 1) push("team-nonempty", `slot_teams[${i}].size=${t.size}`);
      // I5 — Crew Boss 55 is unreachable by any wording (Q10).
      if (t.profession_id === 55) push("no-crew-boss", `slot_teams[${i}] resolved to 55`);
      // I6 — the name OnSinch would reject.
      if (t.name.length > SLOT_TEAM_NAME_MAX) push("name-within-limit", `slot_teams[${i}].name is ${t.name.length} chars`);
      // I7 — times are both set or both empty, never half a window.
      if (!!t.beginning !== !!t.end) push("window-paired", `slot_teams[${i}] beginning="${t.beginning}" end="${t.end}"`);
      // I8 — a chief is never given a chief.
      if (t.profession_id === CHIEF_ID && bandChiefs(t.size) > 0 && teams.filter((x) => x.profession_id === CHIEF_ID).length > 1)
        push("chief-not-banded", `slot_teams[${i}] is a chief team of ${t.size}`);
    }

    // I9 — the bands, read off the order itself. Every non-chief team must sit below
    // the band it would otherwise trip, because its chiefs were taken out of it.
    for (const [i, t] of teams.entries()) {
      if (t.profession_id === CHIEF_ID) continue;
      const site = `${t.beginning}|${t.end}|${t.place_id}`;
      const chiefsHere = teams
        .filter((x) => x.profession_id === CHIEF_ID && `${x.beginning}|${x.end}|${x.place_id}` === site)
        .reduce((n, x) => n + x.size, 0);
      if (bandChiefs(t.size + chiefsHere) > chiefsHere && !clientRequestedChief)
        push("band-satisfied", `slot_teams[${i}] of ${t.size} at a site with ${chiefsHere} chief(s) — band wants ${bandChiefs(t.size + chiefsHere)}`);
    }

    /**
     * I10 — nothing that OnSinch would reject on shape may be WRITTEN. Composing an
     * invalid body is allowed and is how a TBC job becomes visible on the board;
     * sending one is a 400. So this is checked against what was written, not against
     * what was composed.
     */
    if (state.status === "ordered") {
      const errs = validateOrder(o);
      if (errs.length) push("order-body-valid", errs.join("; "));
    }
  }

  // I11 — nothing reaches OnSinch while the thread is held.
  const held = !!state.pending_order;
  if (held && state.onsinch_order_id !== undefined && !c.amend)
    push("held-means-unwritten", `pending_order set and onsinch_order_id=${state.onsinch_order_id}`);

  /**
   * I12 — an assumed rate card is written, and a human is called about it.
   *
   * This used to assert the opposite: that `rate_card_source === "default"` could never
   * reach OnSinch hands-free. Ben overruled the hold on 2026-08-27 — a rate card is not
   * order content, and blocking a whole booking for a number Spartan sets itself was an
   * unnecessary blocker.
   *
   * The invariant does not disappear with the hold, it moves. The thing that must never
   * happen is an assumed price going out SILENTLY, and that is now what is checked: the
   * order goes, and `needs_human` must be set so the "Manual" label reaches the mailbox.
   * Dropping the check entirely would have left the guess unguarded.
   */
  if (o?.rate_card_source === "default" && state.status === "ordered" && state.needs_human !== true)
    push("assumed-rate-flags", `an assumed rate card was written with needs_human=${state.needs_human}`);

  // I13 — what went on the wire is what the board shows.
  if (wire.length) {
    const last = wire[wire.length - 1] as Array<{ SlotTeam?: Array<{ size: number }> }>;
    const onWire = (last?.[0]?.SlotTeam ?? []).reduce((n, s) => n + s.size, 0);
    const onOrder = teams.reduce((n, t) => n + t.size, 0);
    if (state.status === "ordered" && onWire !== onOrder)
      push("wire-matches-board", `wire carried ${onWire}, the order shows ${onOrder}`);
  }

  return v;
}

/** Did the client name a chief themselves? Such a request legitimately adds a head. */
export function requestedChief(blocks: SimBlock[]): boolean {
  return blocks.some((b) => predictProfession(b.prof).family === "chief");
}

export type { DesiredOrder };
