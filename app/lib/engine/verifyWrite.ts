// ============================================================================
// verifyWrite - did the create make what the create claimed to make?
// ----------------------------------------------------------------------------
// The engine took a 201 as proof of a booking for its whole life. That is how 99
// orders were written with no crew across five days while every test passed: the
// status line was true and meant nothing.
//
// OnSinch keeps its own record. `order_created_via_api` carries
// created.{Order,Job,SlotTeam,Slot}, written by the vendor rather than by us, and
// comparing it against what we intended is the one external check this
// integration affords.
//
// UNVERIFIABLE IS NOT FAILED. The audit row can lag behind the create. An order
// that exists must never be deleted because a log had not caught up, so a missing
// row is reported as unverified and handed to a person - it is never read as the
// order being absent.
// ============================================================================

export interface CreateVerdict {
  verified: boolean;
  reason?: string;
}

/**
 * Compare OnSinch's record of a create against the blocks we sent.
 *
 * `slots` is not the crew total - a team of 13 records one Slot, not 13 - so the
 * comparison is block count against block count. Measured on live rows: six
 * blocks give SlotTeam 6, Slot 6, workers 24.
 */
export function verifyCreate(
  actual: { teams: number; slots: number } | null,
  expectedBlocks: number
): CreateVerdict {
  if (!actual) {
    return {
      verified: false,
      reason: "could not be verified - OnSinch has no create record for this order yet; the order may well exist",
    };
  }
  if (actual.teams < expectedBlocks) {
    return {
      verified: false,
      reason: actual.teams === 0
        ? `OnSinch recorded no crew on the create - 0 of ${expectedBlocks} blocks; an order created blockless is filed nowhere`
        : `OnSinch recorded ${actual.teams} of ${expectedBlocks} blocks`,
    };
  }
  return { verified: true };
}
