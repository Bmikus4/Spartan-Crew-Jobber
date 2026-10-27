# app/lib/engine: what v2 still uses from the old engine

The old engine is deleted (ADDENDUM Prompt 12, 27 Oct): its pipeline, compiler, deps, reasoner, sweeps, venue
matching and their routes (/api/mail-inbound, /api/sweep-ingest, /api/reconcile, /api/confirm-order) are gone with
their tests, in git history. Nothing here decides an email; a booking is matched in `app/lib/v2/interpret/plan.ts`.
What is left is imported by v2 and the live app, and moves to `app/lib/onsinch/` in Prompt 12's last stage.

| engine file | imported by |
|---|---|
| onsinch.ts (the OnSinch client) | v2/process, v2/read, v2/links, v2/bot/run, v2/bot/apiCreate, v2/bot/canary, feed/live, feed/verify, api/bot/sync, api/test-data |
| resolve.ts | v2/process, v2/interpret/plan, v2/interpret/interpret, v2/threadState, feed/v2, feed/verify |
| types.ts | feed/live, feed/ported, feed/serve, followup/board, followup/clock, help/liveState, routes/settings, jobsDb, settingsDb, ticketsDb |
| reconcile.ts | feed/verify |
| metrics.ts | v2/metrics, metricsDb |
| normalize.ts | followup/clock |
| format.ts | onsinch.ts, reconcile.ts |

## The one invariant that outlived the engine (moved from CLAUDE.md, 26 Oct)

- **Never write `Job.min_beginning` / `max_end`.** The rule stands; the REASON given for it
  no longer does. It was "the window is derived — it is the envelope of the blocks". Measured
  2026-09-29 on reference order #16317: after positions were added by hand on 2026-10-01, the
  job window still read 2026-12-07 08:00..20:00. So the envelope is not recomputed on at least
  some events, and the field can be **stale**. It is a cache, or create-time only, or derived
  from something other than positions — undetermined.
  The consequence is not academic: drift detection compares a desired window against the job's,
  so "window drift" may sometimes be a stale field rather than a real disagreement, and six of
  eight live amendment refusals were window-drift cases. **Treat the window as unreliable
  input, not as truth**, until somebody establishes which events recompute it.
