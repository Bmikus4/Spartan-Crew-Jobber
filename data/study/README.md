# Leg C results — real client mail, engine vs an independent reading

`study/real.ts` writes to `.tmp-data/study/`, which is wiped. The September run's number was
therefore unfindable six weeks later and the study was nearly re-bought. Runs worth comparing
against are copied here. The sample is seeded (`--seed=20260903`), so the same 100 threads
come back exactly and only the model output costs anything.

| run | engine leg's world | accuracy | strict |
| --- | --- | --- | --- |
| `baseline-2026-09-03/` | `/orders` empty, amend stubbed | 82.0% | 71.0% |
| `current-2026-09-16/` | same, current build | 81.0% | 70.0% |
| `seeded-2026-09-16/` | **real standing orders, real amend path** | **78.0%** | 70.0% |

## Why the number went DOWN when the harness got more honest

The engine leg used to answer `/orders` with an empty list and start from an empty store, so
every thread arrived in a world where the tenant had never booked anything. `matchExistingOrder`
had nothing to bind to and the linking step — the one the "wrong less than 1% of the time" bar
is written about — could not be exercised at all.

It now serves the tenant's real orders, filtered to those **created before the thread's first
message**. That cutoff is the integrity of the whole thing: serving today's orders would hand
the engine the order a human raised *in response to this very mail*, and it would "find" it and
score a free link. A genuine standing order — the booking an `update` thread is about — was
raised for some earlier conversation and predates this one.

Outcomes moved a long way:

| | ordered | needs-info |
| --- | --- | --- |
| empty world | 39 | 12 |
| real standing orders | **28** | **23** |

Eleven threads that used to book now hold, for three distinct reasons:

- **5 — the identity rule refusing to guess.** *"2 existing OnSinch orders for this client on
  2026-06-12 and the thread does not say which — not guessing; pick the right one by hand."*
  Designed behaviour, invisible in an empty world, and the first time this harness has ever
  exercised it.
- **5 — linking working.** *"matched existing OnSinch order #N (same date) — will update, not
  create."* Also never reachable before.
- **5 — the amendability hard gate.** *"update NOT applied … must be applied by hand on OnSinch
  order #6520."* Every one is a staff-raised order whose blocks nobody is signed on to, so
  attendance returns no rows and the blocks cannot be paired. This is the API, not the engine.

So 78% is the more truthful figure and 81% was flattered by an empty world. **A hold is still a
miss** under the standing rule that no step may require a human — the automation did not do the
job — but a hold caused by an unpairable order is a hard gate, and Ben's 99% excludes those.

## A harness defect this found, which is the failure mode the leg exists to prevent

`amendOrderInPlace` was stubbed as `async () => ({ declined: true })` — a fixture that hands the
engine a guaranteed failure. It cost nothing while `/orders` answered empty, because the amend
path was unreachable. The moment real orders were seeded it became **six** threads reported as
"update NOT applied" and scored against the engine. Wiring the real function in recovered one of
the six; the other five are the genuine hard gate above.

That is the harness failing and the engine taking the blame — the exact thing this leg was built
to avoid, arriving through the fixture rather than through the answer.

## What is still missing

**The report does not separate hard gates from misses**, which §4 of the handoff requires
explicitly: Ben's 99% excludes hard gates, so they must be their own bucket with a reason rather
than folded into the error rate. Five threads are currently scored as engine errors for an
amendment the API cannot accept. Until that split exists, 78% is a floor and the hard-gate-
excluded figure is unknown rather than higher-by-five.

## The three numbers the system currently has

| question | instrument | reading |
| --- | --- | --- |
| does it read the thread right? | `study/real.ts --report` | **78%** (floor; hard gates not yet excluded) |
| does it bind to the right order? | `study/scoreE2E.ts` | 0 wrong binds of 178 |
| does it repair a bind that died? | `study/sweepDeadBinds.ts` | 22 of 41 live cases |
