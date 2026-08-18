// ============================================================================
// compose — turn typed facts + resolved ids + rate card into a full DRAFT
// DesiredOrder. DETERMINISTIC (the LLM already did the reading). Applies
// Spartan's business rules in code:
//   - draft posture: provisional + quote + request_approval
//   - explicit rate card (I1); job summary -> specification; PO -> intern_name
//   - place_id copied onto every slot team; default 08:00-18:00 when missing
//   - profession_id mapping (default Crew=1)
//   - one slot team per distinct time window + location + profession; sizes summed
//   - CREW-CHIEF rule applied: banded per TEAM (4+/10+/20+ -> 1/2/3), the chief
//     carved OUT of the team so headcount is unchanged (Ben, 2026-08-18)
// ============================================================================
import { PROFESSION } from "./types";
import { DRAFT_POSTURE, SLOT_TEAM_NAME_MAX } from "./format";
import { resolveProfession, professionNote, type ProfessionRec } from "./professions";
import { PROFESSION_LIST } from "./professionList";
import type { ConversationFacts, DesiredOrder, DesiredSlotTeam } from "./types";

// ---------------------------------------------------------------- crew chief
// Ben's rule, restated 2026-08-18 and settled: bands, not a ratio, and the chief
// is CARVED OUT of the team rather than added to it.
//
//     4 or more in a team -> 1 chief
//    10 or more           -> 2
//    20 or more           -> 3
//
// The client's number is the number that turns up. 6 becomes 5 crew + 1 chief,
// 4 becomes 3 + 1, 20 becomes 17 + 3. This holds for specialists too: 4 carpenters
// is 3 carpenters and a chief, not 5 people (Ben, Q9(a), overruling the proposal
// that the chief always come out of general labour).
//
// The band reads ONE SlotTeam, and a SlotTeam is the unit of work: a new team when
// the time window or the location differs, never when the size does. Two blocks of
// 3 at 14:00 at the same place are one team of 6 — so they are merged BEFORE the
// band runs, and "Call 1 / Call 2" style labels do not split anything.
//
// This replaced per-shift summing, which banded across professions sharing a start
// and end, and before that chiefCount = ceil(size / 4) applied only to profession
// CREW, which over-staffed everything above 4 and gave a carpenters-only request
// no chief at all.
//
// This is a REPLACEMENT tool: these numbers reach a real order and get billed, so
// the rule is stated here and pinned by test/crewChief.ts rather than left to a
// comment asking someone to confirm it.
export const CREW_CHIEF_MODE: "carve-out" | "off" = "carve-out";
const CREW_CHIEF_PROFESSION_ID = PROFESSION.CREW_CHIEF; // 36

/** Chiefs required for a single SlotTeam of `size` people. */
export function chiefsForTeam(size: number): number {
  if (size >= 20) return 3;
  if (size >= 10) return 2;
  if (size >= 4) return 1;
  return 0;
}

/**
 * The unit of work. A team is one window at one place doing one profession —
 * profession is in the key only because OnSinch forces it to be: `profession_id`
 * is a required single integer with no array form and no sibling collection
 * (probed against the live tenant 2026-08-18), so "one of these four is a chief"
 * has no direct representation and the carve-out is the only encoding there is.
 */
function teamKey(t: DesiredSlotTeam): string {
  return `${t.beginning}|${t.end}|${t.place_id}|${t.profession_id}`;
}

/** Window + place alone — the scope a client-requested chief offsets across. */
function siteKey(t: DesiredSlotTeam): string {
  return `${t.beginning}|${t.end}|${t.place_id}`;
}

/** Hours between two HH:MM times, for the day-rate/hourly choice (Q8). */
function shiftHours(start: string, end: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(start);
  const n = /^(\d{1,2}):(\d{2})$/.exec(end);
  if (!m || !n) return undefined;
  const from = Number(m[1]) * 60 + Number(m[2]);
  // A finish before the start is an overnight shift, not a negative one.
  const to = Number(n[1]) * 60 + Number(n[2]);
  return ((to <= from ? to + 24 * 60 : to) - from) / 60;
}

function isoDateTime(date: string, time: string): string {
  return `${date}T${time}:00+00:00`;
}

export interface ComposeInput {
  facts: ConversationFacts;
  company_id: number;
  user_id: number;
  place_id: number;
  pricelist_category_id: number; // rate card (I1)
  orderName: string;
  jobName: string;
  specification?: string; // job summary
  intern_name?: string;   // PO / customer ref
  order_manager_id?: number;
  supervisor_id?: number;
  /**
   * The live profession list, when the caller has it — from the Neon cache, or a
   * fresh GET /professions. Absent, the committed list is used, so the engine still
   * resolves all 43 professions offline rather than the six the old static map knew.
   */
  professions?: ProfessionRec[];
}

export interface ComposeResult {
  order: DesiredOrder | null;
  warnings: string[];
}

/**
 * Merge request blocks into SlotTeams. Same window, same place, same profession is
 * ONE team with the sizes summed — size never splits a team, so "3 crew and 3 crew"
 * at 14:00 at the Guildhall is a team of 6. Differing task text is kept: the first
 * label names the team and the rest ride in its description, because the label is
 * the client's wording and ops read it to recognise the block.
 */
function mergeTeams(teams: DesiredSlotTeam[], warnings: string[]): DesiredSlotTeam[] {
  const byKey = new Map<string, DesiredSlotTeam>();
  const labels = new Map<string, string[]>();
  for (const t of teams) {
    const key = teamKey(t);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...t });
      labels.set(key, [t.description || t.name]);
      continue;
    }
    seen.size += t.size;
    const label = t.description || t.name;
    const list = labels.get(key)!;
    if (!list.includes(label)) list.push(label);
  }
  for (const [key, t] of byKey) {
    const list = labels.get(key)!;
    if (list.length > 1) {
      t.description = list.join(" / ");
      warnings.push(
        `merged ${list.length} blocks into one team of ${t.size} — same time and place (${list.join(" / ")})`
      );
    }
  }
  return [...byKey.values()];
}

/**
 * Apply the crew-chief rule to merged teams: band each team on its own size and
 * take the chiefs OUT of it. Chiefs the client asked for already offset the carve
 * across the window and place, so 3 crew + 1 chief stays 3 + 1 and 10 crew + 1 chief
 * becomes 9 + 1 + the one they named, never 11 people to fill an order for 11.
 */
function applyCrewChief(teams: DesiredSlotTeam[], warnings: string[]): DesiredSlotTeam[] {
  if (CREW_CHIEF_MODE === "off") return teams;

  const requestedChiefs = new Map<string, number>();
  for (const t of teams) {
    if (t.profession_id !== CREW_CHIEF_PROFESSION_ID) continue;
    requestedChiefs.set(siteKey(t), (requestedChiefs.get(siteKey(t)) ?? 0) + t.size);
  }

  const carved = new Map<string, number>();
  for (const t of teams) {
    // A chief is never given a chief of their own.
    if (t.profession_id === CREW_CHIEF_PROFESSION_ID) continue;
    const site = siteKey(t);
    const credit = requestedChiefs.get(site) ?? 0;
    const needed = chiefsForTeam(t.size) - credit;
    if (needed <= 0) {
      // The credit is spent against this team, not re-spent against the next one.
      requestedChiefs.set(site, credit - chiefsForTeam(t.size));
      continue;
    }
    requestedChiefs.set(site, 0);
    const before = t.size;
    t.size -= needed;
    carved.set(site, (carved.get(site) ?? 0) + needed);
    warnings.push(
      `crew-chief rule: team of ${before} -> ${t.size} + ${needed} chief${needed > 1 ? "s" : ""} (headcount unchanged)`
    );
  }

  const out = teams.filter((t) => t.size > 0);
  for (const [site, n] of carved) {
    if (n <= 0) continue;
    const existing = out.find(
      (t) => t.profession_id === CREW_CHIEF_PROFESSION_ID && siteKey(t) === site
    );
    if (existing) {
      existing.size += n;
      continue;
    }
    const anchor = teams.find((t) => siteKey(t) === site)!;
    out.push({
      name: "Crew Chief",
      profession_id: CREW_CHIEF_PROFESSION_ID,
      beginning: anchor.beginning,
      end: anchor.end,
      size: n,
      place_id: anchor.place_id,
    });
  }
  return out;
}

export function composeOrder(inp: ComposeInput): ComposeResult {
  const warnings: string[] = [];
  const blocks = inp.facts.requests.filter((r) => r.size && r.size > 0);
  if (blocks.length === 0) {
    return { order: null, warnings: ["no requested crew blocks with a size"] };
  }

  const base: DesiredSlotTeam[] = blocks.map((r, i) => {
    const date = r.date; // may be undefined => TBC
    // The default stays — an email that states no time must still produce a block
    // rather than nothing — but a defaulted finish is now SAID rather than hidden.
    // 70 of 101 real threads stated an end time or a duration, and every one that was
    // dropped became a job booked to 18:00 that nobody could tell apart from a job
    // genuinely running to 18:00.
    const start = r.start_time || "08:00";
    const end = r.end_time || "18:00";
    if (!r.start_time) warnings.push(`SlotTeam[${i}] start time not stated — defaulted to 08:00`);
    if (!r.end_time) warnings.push(`SlotTeam[${i}] finish time not stated — defaulted to 18:00`);
    if (!date) warnings.push(`SlotTeam[${i}] has no confirmed date (TBC)`);
    /**
     * Q12: a profession the resolver works out is used on the order immediately and
     * said out loud on the ticket — there is no first-use human gate. The note is
     * what makes that safe: an inferred booking that nobody can see is the thing to
     * avoid, not an inferred booking.
     */
    const prof = resolveProfession(r.profession_hint, inp.professions ?? PROFESSION_LIST, {
      // Only a STATED shift can choose a day rate. The 08:00-18:00 default is ten
      // hours, so reading the default would put every plant request with no times on
      // a day rate — an inference stacked on an inference, and a billing decision
      // made out of an email that said nothing about the hours.
      hours: r.start_time && r.end_time ? shiftHours(start, end) : undefined,
      aliasId: r.profession_id ?? null,
    });
    const profession_id = prof.id;
    const note = professionNote(r.profession_hint, prof);
    if (note) warnings.push(`SlotTeam[${i}] ${note}`);
    const nameBase = r.task ? r.task : "Crew";
    // OnSinch caps the slot team name at 80 and 400s the whole order over it.
    // Capped HERE as well as at serialisation so the staged order the board shows
    // is the one that gets sent, and the truncation is said out loud rather than
    // discovered by comparing a ticket with OnSinch.
    //
    // The suffix keeps its room: "(TBC)" is the marker that this block has no
    // confirmed date, and cutting the string as a whole would drop it off exactly
    // the long names — the same failure jobNameFrom had with the date.
    const suffix = date ? "" : " (TBC)";
    const room = SLOT_TEAM_NAME_MAX - suffix.length;
    const long = nameBase.length > room;
    if (long) warnings.push(`SlotTeam[${i}] name over ${SLOT_TEAM_NAME_MAX} chars — shortened, full text moved to its description`);
    return {
      name: (long ? nameBase.slice(0, room).trimEnd() : nameBase) + suffix,
      ...(long ? { description: nameBase } : {}),
      profession_id,
      beginning: date ? isoDateTime(date, start) : "",
      end: date ? isoDateTime(date, end) : "",
      size: r.size as number,
      place_id: r.place_id ?? inp.place_id, // MANDATORY on every slot team
    };
  });

  const slot_teams = applyCrewChief(mergeTeams(base, warnings), warnings);

  const order: DesiredOrder = {
    name: inp.orderName,
    company_id: inp.company_id,
    user_id: inp.user_id,
    request_approval: true,
    ...DRAFT_POSTURE, // To Confirm, not Price Quotes — see format.ts
    pricelist_category_id: inp.pricelist_category_id,
    job_name: inp.jobName,
    slot_teams,
    ...(inp.specification ? { specification: inp.specification } : {}),
    ...(inp.intern_name ? { intern_name: inp.intern_name } : {}),
    ...(Number.isInteger(inp.order_manager_id) ? { order_manager_id: inp.order_manager_id } : {}),
    ...(Number.isInteger(inp.supervisor_id) ? { supervisor_id: inp.supervisor_id } : {}),
  };
  return { order, warnings };
}
