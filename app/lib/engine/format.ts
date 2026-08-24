// ============================================================================
// format — build the OnSinch POST /orders body from a DesiredOrder. Emits the
// FULL verified draft-order shape (provisional + quote + explicit rate card).
// Pure + total. All OnSinch writes are arrays even for one item, so we wrap [].
// Rejected "unknown property" fields (number/status/happening/… on the order;
// rate/price/wage/… on SlotTeam) are simply never emitted.
// ============================================================================
import type { DesiredOrder } from "./types";

/**
 * The posture every order this engine creates is written in.
 *
 * Ben, 2026-08-09: "Jobs will be added to To Confirm instead of Price Quotes."
 * `quote: true` is what filed them under Price Quotes, so it is now false and
 * `provisional` alone carries the draft — the order lands in the queue Spartan
 * actually works from, awaiting confirmation rather than sitting in a pricing
 * list nobody actions.
 *
 * DEFINED ONCE BECAUSE TWO PLACES MUST AGREE. compose.ts writes it, and
 * replaceOrder.ts used to read the same two booleans back to decide whether an
 * order was still the engine's to delete. Those had to be edited together and
 * nothing said so; a posture change alone would have made every replacement
 * refuse. replaceOrder no longer identifies our orders by their flags at all
 * (see the custody note there), which is the deeper fix — but the constant stays
 * single-sourced so the write path cannot drift from what the rest assumes.
 */
export const DRAFT_POSTURE = { provisional: true, quote: false } as const;

/**
 * OnSinch rejects a SlotTeam name over 80 characters, and rejects the WHOLE
 * order with it — `400 {"0":{"SlotTeam":{"0":{"name":["Name is too long,
 * maximum is 80 characters."]}}}}`. There is no truncation server-side.
 *
 * The name is composed from the extracted `task`, which is a description of the
 * work whenever the client wrote one out ("Rig: unloading vans, shunting cases,
 * assist lighting tech putting out lights, hanging mirror balls, working at
 * heights" — 118 chars, live on thread 19ff0292d9c8a86c). So it overflows on
 * exactly the enquiries that describe the job best. It is the only error the
 * engine has ever produced against OnSinch: three failed creates on thread
 * 19fdc18aeb550d3b, 2026-08-07, and nothing else.
 *
 * `orderName` was already capped at 80 (compiler.ts) and the Job name at 100
 * (jobNameFrom); the slot team was the one name nobody capped.
 */
export const SLOT_TEAM_NAME_MAX = 80;

/**
 * Fit a slot team's name inside the limit, keeping the full text as its
 * `description` — the field OnSinch documents for per-team task detail. The
 * overflow is the most specific thing the client said about the work, so it
 * moves rather than being cut off the end of a name.
 *
 * Idempotent, and applied in TWO places on purpose. compose.ts caps as it
 * builds, so what the board shows is what gets sent. This function is applied
 * again at serialisation because a staged order is written from JSON stored
 * before the cap existed and is never re-composed — 21 of them were waiting in
 * `conversation_state` when this was written, one of them over the limit. The
 * choke point every write passes through is the only place that can fix those.
 *
 * An existing description wins: it was set deliberately, and losing it to
 * recover a name tail would be the worse trade.
 */
export function capSlotTeamName<T extends { name?: string; description?: string }>(
  s: T
): T & { description?: string } {
  const name = s.name ?? "";
  if (name.length <= SLOT_TEAM_NAME_MAX) return s;
  return {
    ...s,
    name: name.slice(0, SLOT_TEAM_NAME_MAX).trimEnd(),
    description: s.description?.trim() || name,
  };
}

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
    SlotTeam: o.slot_teams.map(capSlotTeamName).map((s) => ({
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

/** A single slot team, serialised for `POST /slotTeams` on an EXISTING job. */
export interface OnsinchSlotTeamBody {
  job_id: number;
  name: string;
  profession_id: number;
  beginning: string;
  end: string;
  size: number;
  place_id: number;
  description?: string;
}

/**
 * Serialise one desired team as a standalone create against an existing job.
 *
 * The same field set `buildOrderBody` nests, plus `job_id` — deliberately built from
 * the same `capSlotTeamName` so a team added by amendment cannot carry a name that
 * would have been rejected inside a create. The 80-character limit is enforced by
 * OnSinch on both routes and the failure is a 400 for the whole request.
 */
export function buildSlotTeamBody(
  job_id: number,
  team: { name: string; profession_id: number; beginning: string; end: string; size: number; place_id: number; description?: string }
): OnsinchSlotTeamBody {
  const s = capSlotTeamName(team);
  return {
    job_id,
    name: s.name,
    profession_id: s.profession_id,
    beginning: s.beginning,
    end: s.end,
    size: s.size,
    place_id: s.place_id,
    ...(s.description ? { description: s.description } : {}),
  };
}
