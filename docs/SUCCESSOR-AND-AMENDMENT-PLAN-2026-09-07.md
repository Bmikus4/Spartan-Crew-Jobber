# Superseded — see AMENDMENT-PLAN-2026-09-13.md

This document is withdrawn. Three of its conclusions came from broken queries and are false:

- "nobody confirms our orders" — a join error. Lifecycle audit rows key on `order.number`,
  create rows key on `order.id`; matching our ids against numbers could only return zero.
  Staff DO confirm engine orders in place and the order id survives.
- "no write can be confirmed by any read" — right conclusion, wrong reasoning, and then
  wrongly overturned. `common_change` is a UI-edit signal the engine never produces, but
  `/attendance?with=Slot,SlotTeam` does read a block's size, profession, venue and name back
  once a seat is staffed.
- `PATCH /orders {happening}` as the route to keeping block ids — `happening` is rejected on
  create and absent from the PATCH accept-list, and filing into Orders to Confirm is decided
  at creation from the crew present, so it could not have worked anyway.

The live plan is `docs/AMENDMENT-PLAN-2026-09-13.md`.
