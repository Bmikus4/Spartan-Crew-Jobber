// ============================================================================
// format — build the OnSinch POST /orders body from a structured DesiredOrder.
// This replaces the old two-node dance (LLM emits flat "key: value" text lines
// -> "format job for onsinch API" re-parses them). Here the order is already a
// typed object, so this is a pure, total function. All OnSinch writes are
// arrays even for one item (§2.1 of the API ref), so we wrap in [ ].
// ============================================================================
import type { DesiredOrder } from "./types";

export interface OnsinchOrderBody {
  name: string;
  company_id: number;
  user_id: number;
  request_approval: true;
  Job: { name: string };
  SlotTeam: Array<{
    name: string;
    profession_id: number;
    beginning: string;
    end: string;
    size: number;
    place_id: number;
  }>;
}

/** Validate the invariants that cause the most 400s, before we ever send. */
export function validateOrder(o: DesiredOrder): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(o.company_id)) errs.push("company_id missing/non-int");
  if (!Number.isInteger(o.user_id)) errs.push("user_id missing/non-int");
  if (!o.slot_teams.length) errs.push("no slot teams");
  o.slot_teams.forEach((s, i) => {
    if (!Number.isInteger(s.place_id))
      errs.push(`SlotTeam[${i}].place_id missing (top cause of 400)`);
    if (!Number.isInteger(s.size) || s.size < 1)
      errs.push(`SlotTeam[${i}].size invalid`);
    if (!s.beginning || !s.end) errs.push(`SlotTeam[${i}] missing times`);
  });
  return errs;
}

/** Serialize a DesiredOrder into the array-wrapped OnSinch create body. */
export function buildOrderBody(o: DesiredOrder): OnsinchOrderBody[] {
  return [
    {
      name: o.name,
      company_id: o.company_id,
      user_id: o.user_id,
      request_approval: true,
      Job: { name: o.job_name },
      SlotTeam: o.slot_teams.map((s) => ({
        name: s.name,
        profession_id: s.profession_id,
        beginning: s.beginning,
        end: s.end,
        size: s.size,
        place_id: s.place_id,
      })),
    },
  ];
}
