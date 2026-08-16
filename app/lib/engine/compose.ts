// ============================================================================
// compose — turn typed facts + resolved ids + rate card into a full DRAFT
// DesiredOrder. DETERMINISTIC (the LLM already did the reading). Applies
// Spartan's business rules in code:
//   - draft posture: provisional + quote + request_approval
//   - explicit rate card (I1); job summary -> specification; PO -> intern_name
//   - place_id copied onto every slot team; default 08:00-18:00 when missing
//   - profession_id mapping (default Crew=1)
//   - one slot team per distinct request block
//   - CREW-CHIEF rule applied: banded per shift (4+/10+/20+ -> 1/2/3), add-on for
//     general crew and specific roles alike (Ben, 2026-08-03)
// ============================================================================
import { PROFESSION } from "./types";
import { DRAFT_POSTURE, SLOT_TEAM_NAME_MAX } from "./format";
import type { ConversationFacts, DesiredOrder, DesiredSlotTeam } from "./types";

// ---------------------------------------------------------------- crew chief
// Ben's rule, given verbatim 2026-08-03 and settled: bands, not a ratio.
//
//     4 or more crew on a shift -> 1 chief
//    10 or more                 -> 2
//    20 or more                 -> 3
//
// "add-on for both": the chief is ADDED, never substituted, for general crew and
// for specific roles alike. Four carpenters means four carpenters plus a chief,
// five people billed.
//
// This replaced chiefCount = ceil(size / 4) applied per team and only to
// profession CREW, which over-staffed everything above 4 (8 crew -> 2 chiefs,
// 20 -> 5, 40 -> 10) and gave a carpenters-only request no chief at all.
//
// This is a REPLACEMENT tool: these numbers reach a real order and get billed, so
// the rule is stated here and pinned by test/crewChief.ts rather than left to a
// comment asking someone to confirm it.
export const CREW_CHIEF_MODE: "add-on" | "off" = "add-on";
const CREW_CHIEF_PROFESSION_ID = PROFESSION.CREW_CHIEF; // 36

/** Chiefs required for a whole SHIFT of `size` people. */
export function chiefsForShift(size: number): number {
  if (size >= 20) return 3;
  if (size >= 10) return 2;
  if (size >= 4) return 1;
  return 0;
}

/** Map a free-text skill hint to a concrete OnSinch profession id. */
function professionFromHint(hint?: string): number {
  const h = (hint || "").toLowerCase();
  // Before any other test: "crew chief" contains "crew", so a chief asked for by
  // name was being booked as general crew — and then the band added a chief on top
  // of the chief.
  if (h.includes("chief") || h.includes("crew lead") || h.includes("crew leader") || h.includes("crew manager")) return PROFESSION.CREW_CHIEF;
  if (h.includes("cscs")) return PROFESSION.CSCS;                 // 32 (only if REQUIRED)
  if (h.includes("driver") || h.includes("driving")) return PROFESSION.DRIVER; // 9
  if (h.includes("av") || h.includes("audio")) return PROFESSION.AV;           // 16
  if (h.includes("carpenter") || h.includes("chippy")) return PROFESSION.CARPENTER; // 3
  if (h.includes("telehandler")) return 4;      // Telehandler U<9M J2
  if (h.includes("forklift") || h.includes("counterbalance")) return 11; // Counterbalance B1
  if (h.includes("rough") || h.includes("all terrain")) return 17;       // Rough/All Terrain J1
  return PROFESSION.CREW; // 1 — default & overwhelmingly most common
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
}

export interface ComposeResult {
  order: DesiredOrder | null;
  warnings: string[];
}

/** Apply the crew-chief rule to a set of base slot teams, returning the final set. */
function applyCrewChief(teams: DesiredSlotTeam[], warnings: string[]): DesiredSlotTeam[] {
  if (CREW_CHIEF_MODE === "off") return teams;

  // A "shift" is a start and an end. Teams sharing one are summed before the band
  // applies, so 4 carpenters plus 4 crew at the same time is 8 people and ONE
  // chief — banding each team separately would have billed two.
  const shifts = new Map<string, DesiredSlotTeam[]>();
  for (const t of teams) {
    const key = `${t.beginning}|${t.end}`;
    shifts.set(key, [...(shifts.get(key) ?? []), t]);
  }

  const out: DesiredSlotTeam[] = [...teams];
  for (const group of shifts.values()) {
    // Chiefs already asked for count towards the shift but are never given a chief
    // of their own.
    const requestedChiefs = group
      .filter((t) => t.profession_id === CREW_CHIEF_PROFESSION_ID)
      .reduce((n, t) => n + t.size, 0);
    const people = group.reduce((n, t) => n + t.size, 0);
    const needed = chiefsForShift(people) - requestedChiefs;
    if (needed <= 0) continue;

    const anchor = group[0];
    out.push({
      name: "Crew Chief",
      profession_id: CREW_CHIEF_PROFESSION_ID,
      beginning: anchor.beginning,
      end: anchor.end,
      size: needed,
      place_id: anchor.place_id,
    });
    warnings.push(
      `crew-chief rule: ${people} on shift ${String(anchor.beginning).slice(0, 16)} -> +${needed} chief${needed > 1 ? "s" : ""}`
    );
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
    const profession_id = professionFromHint(r.profession_hint);
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
      place_id: inp.place_id, // MANDATORY on every slot team
    };
  });

  const slot_teams = applyCrewChief(base, warnings);

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
