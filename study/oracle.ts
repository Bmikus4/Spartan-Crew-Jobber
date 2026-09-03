// ============================================================================
// WHAT A COMPETENT BOOKER WOULD HAVE DONE — worked out from the case, never
// from the engine.
// ----------------------------------------------------------------------------
// Two instruments, and the difference between them is the point.
//
// PREDICTION restates the settled rules — the chief bands and the carve-out,
// the merge key, the 08:00/18:00 defaults, the day-rate twin at eight STATED
// hours, the overnight roll. For these rules the algorithm is the rule, so a
// disagreement means one of the two read Ben's ruling differently. It is a
// consistency check and it is worth exactly what a consistency check is worth.
//
// INVARIANTS are the real evidence. They are properties that must hold whatever
// the implementation does — headcount conservation, every team placed, a rate
// card never absent, Crew Boss never reachable, nothing written while held.
// They cannot be satisfied by copying the implementation because they were not
// derived from it.
//
// The professions and places come from study/gold.ts, which is labelled off the
// tenant's own rows by hand. Nothing here paraphrases the resolver.
// ============================================================================
import { ROLE_BY_KEY, VENUE_BY_KEY, CHIEF_ID } from "./gold";
import type { StudyCase, TruthBlock } from "./cases";

// ---------------------------------------------------------------- time
/**
 * The offset a London wall clock carries, worked out from the IANA zone rather
 * than imported from the engine — a different route to the same answer, which
 * is the whole point of an oracle.
 *
 * A client's time is Europe/London and OnSinch stores a true instant, so the
 * stamp needs +01:00 through British Summer Time and +00:00 outside it.
 */
export function londonStamp(day: string, clock: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
  const hm = m ? `${m[1].padStart(2, "0")}:${m[2]}` : clock;
  const offsetAt = (ms: number) => {
    const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" })
      .formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const g = /GMT([+-]\d{1,2})?/.exec(name);
    return g?.[1] ? Number(g[1]) * 60 : 0;
  };
  const wall = Date.parse(`${day}T${hm}:00Z`);
  if (!Number.isFinite(wall)) return `${day}T${hm}:00+00:00`;
  const mins = offsetAt(wall - offsetAt(wall) * 60000);
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  return `${day}T${hm}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Hours in a window. An end at or before the start is an overnight. */
export function hoursOf(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const from = sh * 60 + sm, to = eh * 60 + em;
  return ((to <= from ? to + 1440 : to) - from) / 60;
}

/** Ten hours after `start`, wrapping past midnight. */
function plus10(start: string): string {
  const [h, m] = start.split(":").map(Number);
  const t = (h * 60 + m + 600) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** The calendar day a window ENDS on: the next one when it crosses midnight. */
function endDay(date: string, start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (eh * 60 + em > sh * 60 + sm) return date;
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/** Ben, Q9(a): 4 -> 1 chief, 10 -> 2, 20 -> 3. Bands, not a ratio. */
export function bandChiefs(size: number): number {
  if (size >= 20) return 3;
  if (size >= 10) return 2;
  if (size >= 4) return 1;
  return 0;
}

// ---------------------------------------------------------------- prediction
export interface ExpectedTeam {
  size: number;
  profession_id: number;
  /** null where the venue does not exist and a new place must be provisioned. */
  place_id: number | null;
  beginning: string;
  end: string;
}

export type Disposition = "written" | "held" | "not-bookable" | "no-change";

export interface Expectation {
  disposition: Disposition;
  teams: ExpectedTeam[];
  /** Everyone on the order, chiefs included. Must equal what the client asked for. */
  headcount: number;
  requested: number;
  chiefs: number;
  /** Roles the tenant has no row for. Crew is right; silence is not. */
  abstentions: number;
  /** A venue that does not exist in the tenant and must be created. */
  provisions: number;
  reason: string | null;
}

/**
 * The teams a booker would write, from the blocks the client asked for.
 *
 * `resolvePlace` is injected so a run can score against the gold place or
 * against whatever the tenant actually holds; baking a second answer to venue
 * resolution in here would make every venue case a test of two matchers.
 */
export function expectTeams(blocks: TruthBlock[]): ExpectedTeam[] {
  const sized = blocks.filter((b) => b.size > 0);
  if (!sized.length) return [];

  const base = sized.map((b) => {
    const role = ROLE_BY_KEY.get(b.role)!;
    const venue = VENUE_BY_KEY.get(b.venue)!;
    const start = b.start || "08:00";
    // The default finish is 18:00, or ten hours — the length of the 08:00-18:00
    // default — whenever 18:00 is not after the start.
    const end = b.end || (start < "18:00" ? "18:00" : plus10(start));
    const stated = !!(b.start && b.end);
    /**
     * A day-rate twin is only reachable on a STATED shift. The 08:00-18:00
     * default is ten hours, and reading it would put every untimed plant
     * request on a day rate the client never asked for and Spartan cannot
     * invoice.
     */
    const dayRate = stated && role.dayTwin && hoursOf(start, end) >= role.dayTwin.atHours;
    const profession_id = dayRate ? role.dayTwin!.id : role.id;
    const day = b.date;
    return {
      key: `${day ?? ""}|${start}|${end}|${venue.key}|${profession_id}`,
      site: `${day ?? ""}|${start}|${end}|${venue.key}`,
      profession_id,
      place_id: venue.gold,
      size: b.size,
      beginning: day ? londonStamp(day, start) : "",
      // A finish at or before the start is tomorrow's finish. Stated as the
      // RULE rather than borrowed from compose, which is the point of an
      // oracle — the two are meant to be able to disagree. They did, for every
      // overnight shift this engine ever composed, and OnSinch refused all of
      // them.
      end: day ? londonStamp(endDay(day, start, end), end) : "",
    };
  });

  // Merge: same window, same place, same profession. Size NEVER splits a team.
  const merged = new Map<string, (typeof base)[number]>();
  for (const t of base) {
    const seen = merged.get(t.key);
    if (seen) seen.size += t.size;
    else merged.set(t.key, { ...t });
  }
  const teams = [...merged.values()];

  /**
   * Carve the chiefs OUT of the number, crediting any the client named at the
   * same site. A team of four is three and a chief, not four and a chief:
   * the client asked for four people and four people is what turns up.
   */
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

  const out = teams.filter((t) => t.size > 0).map((t) => ({ ...t }));
  for (const [site, n] of carved) {
    if (n <= 0) continue;
    const existing = out.find((t) => t.profession_id === CHIEF_ID && t.site === site);
    if (existing) { existing.size += n; continue; }
    const anchor = teams.find((t) => t.site === site)!;
    out.push({ ...anchor, key: `${site}|${CHIEF_ID}`, profession_id: CHIEF_ID, size: n });
  }
  return out.map((t) => ({
    size: t.size, profession_id: t.profession_id, place_id: t.place_id,
    beginning: t.beginning, end: t.end,
  }));
}

export function expect(c: StudyCase, which: "new" | "amend" = "new"): Expectation {
  const blocks = which === "amend" ? c.amend!.truth.blocks : c.truth.blocks;

  if (c.kind !== "booking") {
    return { disposition: "no-change", teams: [], headcount: 0, requested: 0, chiefs: 0, abstentions: 0, provisions: 0, reason: c.kind };
  }

  const teams = expectTeams(blocks);
  const requested = blocks.reduce((n, b) => n + b.size, 0);
  const headcount = teams.reduce((n, t) => n + t.size, 0);
  const chiefs = teams.filter((t) => t.profession_id === CHIEF_ID).reduce((n, t) => n + t.size, 0);
  const abstentions = blocks.filter((b) => ROLE_BY_KEY.get(b.role)?.abstain).length;
  const provisions = new Set(blocks.filter((b) => VENUE_BY_KEY.get(b.venue)?.gold === null).map((b) => b.venue)).size;

  let disposition: Disposition;
  let reason: string | null = null;
  if (!teams.length) {
    disposition = "not-bookable"; reason = "empty-order";
  } else if (teams.some((t) => !t.beginning || !t.end)) {
    /**
     * A block with no confirmed date composes with empty times, and a slot team
     * with no times is rejected — correctly, OnSinch would too. So a TBC job is
     * never bookable, whatever a "(TBC)" suffix on the name suggests.
     */
    disposition = "not-bookable"; reason = "tbc-has-no-times";
  } else {
    disposition = "written";
  }
  return { disposition, teams, headcount, requested, chiefs, abstentions, provisions, reason };
}

// ---------------------------------------------------------------- invariants
export interface Violation { rule: string; detail: string }

/**
 * Properties that must hold whatever the engine did. Each one names a real
 * failure: a wrong headcount is crew missing from a site, an unplaced team is
 * a 400 from OnSinch, a missing rate card is OnSinch's silent card 245 on an
 * invoice, a slot-team name over 80 characters is the live 400 this tenant has
 * already thrown.
 */
export const SLOT_TEAM_NAME_MAX = 80;

export function invariants(
  order: {
    pricelist_category_id?: number;
    provision_place?: unknown;
    rate_card_source?: string;
    slot_teams?: Array<{ size: number; place_id: number; profession_id: number; name: string; beginning?: string; end?: string }>;
  } | null | undefined,
  state: { status?: string; needs_human?: boolean; pending_order?: unknown; onsinch_order_id?: number },
  exp: Expectation,
  clientNamedAChief: boolean
): Violation[] {
  const v: Violation[] = [];
  const push = (rule: string, detail: string) => v.push({ rule, detail });
  const teams = order?.slot_teams ?? [];

  if (order) {
    // I1 — a rate card is never absent or zero. OnSinch assigns card 245 silently.
    if (!Number.isInteger(order.pricelist_category_id) || (order.pricelist_category_id as number) <= 0)
      push("rate-card-present", `pricelist_category_id=${order.pricelist_category_id}`);

    // I2 — headcount conservation. The carve-out MOVES people between teams; it
    // never creates or destroys them. Only checkable where the client named no
    // chief of their own, which is the case that legitimately adds a head.
    const actual = teams.reduce((n, t) => n + t.size, 0);
    if (!clientNamedAChief && exp.teams.length && actual !== exp.requested)
      push("headcount-conserved", `order carries ${actual}, client asked for ${exp.requested}`);

    for (const [i, t] of teams.entries()) {
      // I3 — every team is placed. The top cause of a 400 from OnSinch.
      if (!Number.isInteger(t.place_id) || (t.place_id === 0 && !order.provision_place))
        push("team-placed", `slot_teams[${i}].place_id=${t.place_id} with no provision_place`);
      // I4 — no empty team.
      if (!Number.isInteger(t.size) || t.size < 1) push("team-nonempty", `slot_teams[${i}].size=${t.size}`);
      // I5 — Crew Boss 55 is unreachable by any wording (Ben, Q10).
      if (t.profession_id === 55) push("no-crew-boss", `slot_teams[${i}] resolved to 55`);
      // I6 — the name OnSinch would reject.
      if ((t.name ?? "").length > SLOT_TEAM_NAME_MAX)
        push("name-within-limit", `slot_teams[${i}].name is ${(t.name ?? "").length} chars`);
      // I7 — times are both set or both empty, never half a window.
      if (!!t.beginning !== !!t.end)
        push("window-paired", `slot_teams[${i}] beginning="${t.beginning}" end="${t.end}"`);
    }

    // I8 — the bands, read off the order itself. Every non-chief team must sit
    // BELOW the band it would otherwise trip, because its chiefs came out of it.
    for (const [i, t] of teams.entries()) {
      if (t.profession_id === CHIEF_ID) continue;
      const site = `${t.beginning}|${t.end}|${t.place_id}`;
      const chiefsHere = teams
        .filter((x) => x.profession_id === CHIEF_ID && `${x.beginning}|${x.end}|${x.place_id}` === site)
        .reduce((n, x) => n + x.size, 0);
      if (bandChiefs(t.size + chiefsHere) > chiefsHere && !clientNamedAChief)
        push("band-satisfied", `slot_teams[${i}] of ${t.size} at a site with ${chiefsHere} chief(s) — band wants ${bandChiefs(t.size + chiefsHere)}`);
    }

    /**
     * I9 — an assumed rate card is written, and a human is called about it.
     *
     * Ben overruled the HOLD on 2026-08-27: a rate card is not order content,
     * and blocking a booking for a number Spartan sets itself was an
     * unnecessary blocker. The invariant does not disappear with the hold, it
     * moves — what must never happen is an assumed price going out SILENTLY.
     */
    if (order.rate_card_source === "default" && state.status === "ordered" && state.needs_human !== true)
      push("assumed-rate-flags", `an assumed rate card was written with needs_human=${state.needs_human}`);
  }

  // I10 — nothing reaches OnSinch while the thread is held.
  if (state.pending_order && state.onsinch_order_id !== undefined)
    push("held-means-unwritten", `pending_order set and onsinch_order_id=${state.onsinch_order_id}`);

  return v;
}

/** Did the client name a chief themselves? Such a request legitimately adds a head. */
export function clientNamedAChief(blocks: TruthBlock[]): boolean {
  return blocks.some((b) => b.role === "chief");
}
