// ============================================================================
// A venue the tenant does not hold yet, created before anything is written against it.
// ----------------------------------------------------------------------------
// THIS EXISTED IN ONE PATH AND WAS NEEDED IN THREE, AND THE GAP DESTROYED A BOOKING.
//
// `createOrderWithPlace` (deps.ts) has always provisioned an unknown venue before
// posting: a composed order carries `place_id: 0` plus `provision_place`, the place is
// created, and the real id is backfilled onto every block. Neither the in-place
// amendment nor the delete-and-repost rebuild did any of that, so on those two paths the
// zero reached the wire and OnSinch answered
// `400 {"place_id":["Fill in correct location"]}`.
//
// Measured in the 50-case model-in-the-loop run, 2026-08-26:
//
//   R001  amendment  createSlotTeam 400 - the change was refused, order intact
//   R045  rebuild    "URGENT: draft order #15494 was DELETED and its replacement
//                     failed to post (createOrder 400 ...)"
//
// The second is the whole reason this file exists. The rebuild deletes first and posts
// second, so a replacement that cannot be built leaves NO booking at all — the failure
// mode every guard in replaceOrder.ts is written to avoid, reached through a field
// nobody had thought of as a precondition.
//
// It is not a rare shape. A venue the tenant does not hold is provisioned on roughly a
// quarter of enquiries, and it became MORE reachable on 2026-08-26 when a client who
// moves the venue stopped being ignored: a re-resolved venue can land on "ambiguous,
// create a new row rather than guess", which is exactly this state, on an amendment.
// ============================================================================
import type { OnsinchClient } from "./onsinch";
import type { DesiredOrder } from "./types";

/**
 * Create the order's pending venue, if it has one, and backfill its id onto every block.
 *
 * Returns the id when it created one, so a caller can report it. Mutates nothing: the
 * blocks are rebuilt, and the caller uses the returned order.
 *
 * IDEMPOTENT ON THE ONLY THING THAT MATTERS. It fires only when a block still lacks a
 * place_id, so a retried amendment that already provisioned does not create a second
 * row — the same condition `createOrderWithPlace` uses, kept identical on purpose.
 */
export async function provisionPlaceIfNeeded(
  client: OnsinchClient,
  desired: DesiredOrder
): Promise<{ desired: DesiredOrder; created?: number }> {
  const needs = desired.provision_place && desired.slot_teams.some((s) => !s.place_id);
  if (!needs) return { desired };

  const place = await client.createPlace({ ...desired.provision_place! });
  return {
    desired: {
      ...desired,
      slot_teams: desired.slot_teams.map((s) => (s.place_id ? s : { ...s, place_id: place.id })),
    },
    created: place.id,
  };
}

/**
 * Would a write of this order be refused for want of a venue?
 *
 * The guard for the destructive path. `replaceOrder` must know BEFORE it deletes
 * anything, because after the delete there is nothing to fall back to — and a rebuild
 * that cannot name a venue is one OnSinch will reject however well-formed the rest is.
 */
export function missingPlace(desired: DesiredOrder): boolean {
  return desired.slot_teams.some((s) => !s.place_id) && !desired.provision_place;
}
