// ============================================================================
// compose — turn typed facts + resolved ids + rate card into a full DRAFT
// DesiredOrder. DETERMINISTIC (the LLM already did the reading). Applies
// Spartan's business rules in code:
//   - draft posture: provisional + quote + request_approval
//   - explicit rate card (I1); job summary -> specification; PO -> intern_name
//   - place_id copied onto every slot team; default 08:00-18:00 when missing
//   - profession_id mapping (default Crew=1)
//   - one slot team per distinct request block
//   - CREW-CHIEF rule applied (add-on, 1 per 4, ceil) — commercial default,
//     flagged for Tracy; flip CREW_CHIEF_MODE if she rules "split".
// ============================================================================
import { PROFESSION } from "./types";
import type { ConversationFacts, DesiredOrder, DesiredSlotTeam } from "./types";

// --- crew-chief policy (COMMERCIAL DECISION — default per the OnSinch panel
// lean; confirm with Tracy before trusting hands-free). "add-on" never
// under-staffs a live site: N crew requested -> N crew + ceil(N/4) chiefs.
export const CREW_CHIEF_MODE: "add-on" | "split" | "off" = "add-on";
const CREW_CHIEF_PROFESSION_ID = PROFESSION.CREW_CHIEF; // 36
const chiefCount = (size: number) => Math.ceil(size / 4); // 1 per 4 (ceil = span-of-control safe)

/** Map a free-text skill hint to a concrete OnSinch profession id. */
function professionFromHint(hint?: string): number {
  const h = (hint || "").toLowerCase();
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
  const out: DesiredSlotTeam[] = [];
  for (const t of teams) {
    const eligible = t.profession_id === PROFESSION.CREW && t.size >= 4;
    if (!eligible) { out.push(t); continue; }
    const chiefs = chiefCount(t.size);
    if (CREW_CHIEF_MODE === "split") {
      const crew = t.size - chiefs;
      if (crew > 0) out.push({ ...t, size: crew });
    } else {
      out.push(t); // add-on: keep the full requested crew
    }
    out.push({
      name: "Crew Chief",
      profession_id: CREW_CHIEF_PROFESSION_ID,
      beginning: t.beginning,
      end: t.end,
      size: chiefs,
      place_id: t.place_id,
    });
    warnings.push(
      `crew-chief rule (${CREW_CHIEF_MODE}, 1/4): ${t.size} crew -> +${chiefs} chief — confirm policy with Tracy`
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
    const start = r.start_time || "08:00";
    const end = r.end_time || "18:00";
    if (!date) warnings.push(`SlotTeam[${i}] has no confirmed date (TBC)`);
    const profession_id = professionFromHint(r.profession_hint);
    const nameBase = r.task ? r.task : "Crew";
    return {
      name: date ? nameBase : `${nameBase} (TBC)`,
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
    provisional: true, // draft posture
    quote: true,       // draft posture
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
