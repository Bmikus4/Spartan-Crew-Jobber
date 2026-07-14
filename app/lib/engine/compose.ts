// ============================================================================
// compose — turn typed facts + resolved ids into a DesiredOrder.
// DETERMINISTIC. The LLM already did the reading; this applies Spartan's
// business rules in code (was previously buried in an LLM prompt and unreliable):
//   - request_approval hardcoded true
//   - place_id copied onto every slot team
//   - default 08:00-18:00 when times missing
//   - profession_id mapping (default Crew=1)
//   - one slot team per distinct request block
//   - crew-chief rule flagged for review (>=4 regular crew => needs a chief)
// ============================================================================
import { PROFESSION } from "./types";
import type { ConversationFacts, DesiredOrder, DesiredSlotTeam } from "./types";

function professionFromHint(hint?: string): number {
  const h = (hint || "").toLowerCase();
  if (h.includes("cscs")) return PROFESSION.CSCS;
  if (h.includes("driver") || h.includes("driving")) return PROFESSION.DRIVER;
  if (h.includes("av") || h.includes("audio")) return PROFESSION.AV;
  if (h.includes("carpenter") || h.includes("chippy")) return PROFESSION.CARPENTER;
  return PROFESSION.CREW; // default & overwhelmingly most common
}

function isoDateTime(date: string, time: string): string {
  return `${date}T${time}:00+00:00`;
}

export interface ComposeInput {
  facts: ConversationFacts;
  company_id: number;
  user_id: number;
  place_id: number;
  orderName: string; // short prose name from the reasoner
  jobName: string;   // "[size] at [address] on [date]" style
}

export interface ComposeResult {
  order: DesiredOrder | null;
  warnings: string[];
}

export function composeOrder(inp: ComposeInput): ComposeResult {
  const warnings: string[] = [];
  const blocks = inp.facts.requests.filter((r) => r.size && r.size > 0);
  if (blocks.length === 0) {
    return { order: null, warnings: ["no requested crew blocks with a size"] };
  }

  const slot_teams: DesiredSlotTeam[] = blocks.map((r, i) => {
    const date = r.date; // may be undefined => TBC
    const start = r.start_time || "08:00";
    const end = r.end_time || "18:00";
    if (!date) warnings.push(`SlotTeam[${i}] has no confirmed date (TBC)`);
    const profession_id = professionFromHint(r.profession_hint);
    const nameBase = r.task ? r.task : "Crew";
    const name = date ? nameBase : `${nameBase} (TBC)`;

    // internal crew-chief rule: >=4 regular crew implies one must be a chief.
    // Semantics are genuinely ambiguous in the source prompt, so we FLAG it
    // rather than silently mutate the composition — the data study resolves it.
    if (profession_id === PROFESSION.CREW && (r.size ?? 0) >= 4) {
      warnings.push(
        `SlotTeam[${i}] has ${r.size} crew (>=4): crew-chief rule may apply — confirm chief allocation`
      );
    }

    return {
      name,
      profession_id,
      beginning: date ? isoDateTime(date, start) : "",
      end: date ? isoDateTime(date, end) : "",
      size: r.size as number,
      place_id: inp.place_id, // MANDATORY on every slot team
    };
  });

  const order: DesiredOrder = {
    name: inp.orderName,
    company_id: inp.company_id,
    user_id: inp.user_id,
    request_approval: true,
    job_name: inp.jobName,
    slot_teams,
  };
  return { order, warnings };
}
