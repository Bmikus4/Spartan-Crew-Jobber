// ============================================================================
// format — build the OnSinch POST /orders body from a DesiredOrder. Emits the
// FULL verified draft-order shape (provisional + quote + explicit rate card).
// Pure + total. All OnSinch writes are arrays even for one item, so we wrap [].
// Rejected "unknown property" fields (number/status/happening/… on the order;
// rate/price/wage/… on SlotTeam) are simply never emitted.
// ============================================================================
import type { DesiredOrder } from "./types";

export interface OnsinchOrderBody {
  name: string;
  company_id: number;
  user_id: number;
  request_approval: true;
  provisional: boolean;
  quote: boolean;
  specification?: string;
  intern_name?: string;
  order_manager_id?: number;
  Job: {
    name: string;
    pricelist_category_id: number;
    supervisor_id?: number;
  };
  SlotTeam: Array<{
    name: string;
    profession_id: number;
    beginning: string;
    end: string;
    size: number;
    place_id: number;
    description?: string;
  }>;
}

/** Validate the invariants that cause the most 400s / mis-bills, before sending. */
export function validateOrder(o: DesiredOrder): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(o.company_id)) errs.push("company_id missing/non-int");
  if (!Number.isInteger(o.user_id)) errs.push("user_id missing/non-int");
  // I1: a rate card is mandatory — never rely on OnSinch's silent default.
  if (!Number.isInteger(o.pricelist_category_id) || o.pricelist_category_id <= 0)
    errs.push("pricelist_category_id (rate card) missing — I1 violation");
  if (!o.slot_teams.length) errs.push("no slot teams");
  o.slot_teams.forEach((s, i) => {
    // place_id 0 is allowed ONLY when a new venue is being provisioned on write.
    if (!Number.isInteger(s.place_id) || (s.place_id === 0 && !o.provision_place))
      errs.push(`SlotTeam[${i}].place_id missing (top cause of 400)`);
    if (!Number.isInteger(s.size) || s.size < 1) errs.push(`SlotTeam[${i}].size invalid`);
    if (!s.beginning || !s.end) errs.push(`SlotTeam[${i}] missing times`);
  });
  return errs;
}

/** Serialize a DesiredOrder into the array-wrapped OnSinch create body. */
export function buildOrderBody(o: DesiredOrder): OnsinchOrderBody[] {
  const body: OnsinchOrderBody = {
    name: o.name,
    company_id: o.company_id,
    user_id: o.user_id,
    request_approval: true,
    provisional: o.provisional,
    quote: o.quote,
    Job: {
      name: o.job_name,
      pricelist_category_id: o.pricelist_category_id,
    },
    SlotTeam: o.slot_teams.map((s) => ({
      name: s.name,
      profession_id: s.profession_id,
      beginning: s.beginning,
      end: s.end,
      size: s.size,
      place_id: s.place_id,
      ...(s.description ? { description: s.description } : {}),
    })),
  };
  if (o.specification) body.specification = o.specification;
  if (o.intern_name) body.intern_name = o.intern_name;
  if (Number.isInteger(o.order_manager_id)) body.order_manager_id = o.order_manager_id;
  if (Number.isInteger(o.supervisor_id)) body.Job.supervisor_id = o.supervisor_id;
  return [body];
}
