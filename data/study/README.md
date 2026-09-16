# Leg C results, kept in the repo rather than in .tmp-data

`study/real.ts` writes to `.tmp-data/study/`, which is wiped. The September run's numbers
were therefore unrecoverable six weeks later and the study was nearly re-run from scratch —
the sample is seeded (`--seed=20260903`) so the 100 threads came back exactly, but the model
output would have cost money a second time for a number that had already been bought.

So a run worth comparing against gets copied here.

| | engine build | real-mail accuracy | strict |
| --- | --- | --- | --- |
| `baseline-2026-09-03/` | pre-Phase-2 | **82.0%** | 71.0% |
| `current-2026-09-16/` | Phases 2-5 live, venue guard, reconciliation | **81.0%** | 70.0% |

One thread apart at n=100, which is noise. Everything shipped between those two dates —
identity matching, the reconciliation loop, amendment custody, the venue disagreement guard,
the four labels — moved this number by nothing, because this leg cannot see any of it.

## WHAT THIS NUMBER IS, AND THE LINE IT STOPS AT

It is accuracy of **reading the thread**: what kind of message is this, is it bookable, how
many blocks, on what dates, in what windows, for how many people. Every one of those is an
AI step and this is the honest measure of them, on real client mail, against an independent
reading that never saw the engine's answer.

It is **not** accuracy of producing the right order, because the engine leg runs against a
fixture whose `/orders` returns an empty list and whose thread store is empty
(`study/real.ts`, the transport in `--engine`). In that world every thread is the first
thread ever seen, so `matchExistingOrder` has nothing to bind to and the linking step —
the one the 1%-wrong bar is written about — is structurally unmeasurable here.

That is why a thread the engine wrongly calls `new-job` shows as `status: ordered` in these
results. It does not follow that production would have raised a duplicate; it follows that
this harness cannot say either way.

**The fix is cheap and is the next thing worth building:** seed the fixture from the real
standing orders for the thread's company (an OnSinch read, no model calls) so the leg
exercises linking too. Then the headline becomes end-to-end in the full sense.

Until then, the picture takes three numbers, not one:

| question | instrument | reading |
| --- | --- | --- |
| does it read the thread right? | `study/real.ts --report` | **81%** |
| does it bind to the right order? | `study/scoreE2E.ts` | 0 wrong binds of 178 |
| does it repair a bind that died? | `study/sweepDeadBinds.ts` | 22 of 41 live cases |
