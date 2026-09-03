# Assumptions

Claims relied upon but **not independently verified**. Each says what would falsify it
and what it would cost to be wrong. Opened at Phase 0, 2026-09-02.

---

## A1 — `metric_events` retention

The table holds 2026-08-24 → today (**counted**, 1,327 rows) although it was created
2026-07-14. I assume `scripts/db-reclaim.mjs` truncated it and that no retention policy
is configured anywhere.

- **Falsified by:** finding a scheduled job, a Neon retention setting, or a different
  cause for the gap.
- **Cost of being wrong:** if something still prunes on a schedule, the Phase 2 decision
  log will be pruned too and the forensic trail rebuilds itself into the same hole.
- **Not verified because:** it needs the deploy/job history, not the code.

## A2 — `order_action_log` has never been rewritten

Phase 0's provenance split (74 matched / 58 created / 36 other) treats
`order_action_log` as a faithful append-only record. It is append-only *in code* but
lives inside a `conversation_state` row that maintenance scripts have rewritten before
(`clear-machine-threads.ts` did exactly that to `status`).

- **Falsified by:** a script that reconstructs or drops log entries.
- **Cost of being wrong:** the whole §3.2 provenance split is unsound and Phase 3 has no
  authority to work from.
- **Not verified because:** it needs a read of every maintenance script's write set.

## A3 — commit `4e73213` was deployed before 2026-08-28T23:02Z

§3.3 is called verified on the basis that companies 822 and 823 were created after the
`TBC` fix landed in the repo. That infers the deploy from the outcome.

- **Falsified by:** the Vercel deployment list showing the fix shipped later, which
  would mean those companies were created some other way.
- **Cost of being wrong:** §3.3 is not fixed and new clients are still failing silently.
- **How to close it:** `vercel ls` / the deployments page against `4e73213`. One minute.

## A4 — production runs one thread at a time

The retry-duplication risk in the system model (§7) is called "not yet observed" partly
because OnSinch's 500s were measured at 17% under concurrency 4 and 0% at concurrency 1,
and n8n is assumed to POST serially.

- **Falsified by:** the n8n workflow's batching/parallelism settings, or two
  `order_created` events for one thread inside a few seconds.
- **Cost of being wrong:** duplicate real bookings already exist and have not been
  looked for.
- **How to close it:** inspect the inbound workflow's execution mode; query
  `metric_events` for same-thread `order_created` pairs.

## A5 — figures inherited from the findings document

Reproduced by Phase 0 and now **counted**, not assumed: 90 / 62 / 30 / 17 / 181 / 47.
The following are still inherited and unverified:

| claim | source | status |
|---|---|---|
| 39 of 47 recorded ids return nothing from `GET /orders?id=` | `verify-times.mjs` output | needs OnSinch reads — Phase 3 |
| 7 future orders booked an hour late, 3 of them part-fixed | `Spartan-Time-Audit-2026-09-02.txt` | needs OnSinch reads — Phase 3/5 |
| 13 of 17 "failed" are Ben's test sends | findings §3.5 | plausible, uncounted |
| 11 threads carry "apply by hand on order #N" in `notes` | findings §3.4 | queryable, not yet counted |
| 23 threads dismissed as Spartan's own outbound | findings §3.7 | 23 own-mail dismissals **counted** (§5.2 of the model, `bookings@` 23 + `info@` 7 = 30 total own-mail) — the 23 figure matches one address, not both |
| conversion 5,835 → 422 → 241 → 167 orders | `funnel.mjs` | not re-run |

## A6 — the corrected BST figure is 4, not 19

The findings document retracts "19 of 21 BST orders repaired by hand" and states the
real figure is 4, from `conversation_state.state.last_ordered_teams`. Phase 0 did not
recompute it.

- **Cost of being wrong:** it changes how many of the 7 wrong-hour orders in §3.1 are
  genuinely untouched.

## A7 — CLOSED. `slotTeamsForOrder`'s docstring is the stale one

`fleet/resume/Spartan-Jobber.md` §2 settles it, measured 2026-08-24 (`16e20ed`, API
reference §12): an order raised through `POST /orders` logs `order_created_via_api` as
**one childless row**, so its blocks are never addressable under any key; an order raised
in the OnSinch UI logs `order_create` with a child row per Job, SlotTeam and Slot. And
there is no service key to change that — `creator` is never null across 2,400 sampled
audit rows and the 800 most recent orders.

Consequence, already folded into the model (§5.4a) and the handover (H2): of §3.1's seven
wrong-hour orders, the four created before 2026-08-28 carry real team ids from the
two-phase-create era and are addressable; the three created on 09-02 are not, and never
will be.

---

## A8 — WITHDRAWN. R numbers recorded by the engine are correct

Phase 0 asserted that at least four recorded R numbers were wrong, inferred from one R
number standing against several order ids in our own database. **Tested and falsified**
2026-09-02 with one read: #15574 holds `R10726` in OnSinch, which is exactly what we
recorded; the other seven ids are absent, and a dead id keeps the number it was read
with. Gaps in the R sequence are expected anyway — the Spartan team raises orders in the
OnSinch UI by hand.

Recorded here rather than deleted because the error was methodological: a pattern in our
own database is evidence about our own database, and asking OnSinch cost one call.

---

## A9 — the lost-create lookup window (5 minutes)

`findLostCreate` accepts an order whose `created` stamp is within 5 minutes of the call.
That is compared against **OnSinch's clock, not ours**, and the skew between a Vercel
lambda and the OnSinch host is not measured.

- **Cost of the window being too narrow:** our own just-created order looks too old, is
  not adopted, and the create is re-posted — a duplicate booking.
- **Cost of it being too wide:** an identical order for the same client raised minutes
  ago is adopted, collapsing two bookings into one — visible on the board, since the
  thread records an id and ops see one order.
- **Chosen deliberately wide**, because the second failure is loud and recoverable and
  the first is silent. An identical composed name for the same company inside 5 minutes
  is very nearly always this same engine, which is the answer we want.
- **How to close it:** compare an order's `created` against the wall clock at the moment
  of a create on TEST 515. One write, needs the escalation in the charter.

---

## A10 — `POST /companies` and `POST /places` 5xx are now unrecovered

Removing the blind POST retry stopped those calls duplicating a client or a venue. It
also means a 5xx on either now surfaces as a failed booking rather than being retried.
No recovery lookup was added, because I did not probe a key for it the way I did for
`/orders`.

- **Assumed:** these 5xx are rare enough that a loud failure is the right trade against
  a duplicate company, which is permanent (`POST /companies` has no delete through this
  API) and is the exact pollution the alias/dedup layer exists to prevent.
- **Unverified:** the actual 5xx rate on those two endpoints. The 17% figure was measured
  on `/orders` only.
- **How to close it:** count 5xx by endpoint. Nothing records that today, which is itself
  a gap.

---

## A11 — the original A7 text, kept for the reasoning

Two sources in the repo contradict each other and Phase 0 believed neither:

- `onsinch.ts:slotTeamsForOrder` docstring: verified live against orders raised by this
  engine (`creator: null`), back to 2023.
- `deps.ts:createOrderWithPlace` comment: "an API create logs a single childless audit
  row, so nested blocks are unreadable under any key (§12)", probed 2026-08-28.

Only one can hold. Which one decides whether §3.1's seven orders can be corrected with
`PATCH /slotTeams` or need a person in the OnSinch UI.

- **How to close it:** one read of `/timelineAudits?data[like]=%Order:15761%` against a
  known engine-raised order. Read-only, one API call.
