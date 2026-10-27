# app/lib/engine: the old engine, paused

**Not the live system.** Under SPARTAN_ENGINE=v2 nothing here decides an email: intake calls
`app/lib/v2/process.ts`, and this engine's own routes (/api/mail-inbound, /api/mail-poll, /api/sweep-ingest,
/api/reconcile, /api/confirm-order) answer 503 (`app/lib/paused.ts` OLD_ENGINE_ROUTES). A booking is matched in
`app/lib/v2/interpret/plan.ts`, not here. Retiring this folder is Prompt 12 (ADDENDUM.md §11, R7): what v2 still
uses moves to `app/lib/onsinch/`, and the rest is deleted.

## What v2 and the live app still import from here (27 Oct)

| engine file | imported by |
|---|---|
| onsinch.ts (the OnSinch client) | v2/process.ts, v2/read.ts, v2/links.ts, v2/bot/run.ts, v2/bot/apiCreate.ts, v2/bot/canary.ts, feed/live.ts, feed/verify.ts, api/bot/sync, api/test-data, deps.ts |
| resolve.ts | v2/process.ts, v2/interpret/plan.ts, v2/interpret/interpret.ts, v2/threadState.ts, feed/v2.ts, feed/project.ts, feed/verify.ts, deps.ts |
| types.ts | feed/live.ts, feed/ported.ts, feed/project.ts, feed/serve.ts, followup/board.ts, followup/clock.ts, help/liveState.ts, and the *Db.ts stores |
| resolver.ts | feed/project.ts |
| reconcile.ts | feed/verify.ts |
| reason.ts | deps.ts (the old engine's reasoner) |
| metrics.ts | v2/metrics.ts, metricsDb.ts |
| pipeline.ts | feed/project.ts, n8nInbound.ts (old branch), routes/confirmOrder.ts, routes/reconcile.ts, api/mail-inbound, api/mail-poll |
| normalize.ts | followup/clock.ts |
| professions.ts | professionsDb.ts |
| retryHeld.ts, store.ts | stateDb.ts, n8nInbound.ts (old branch) |
| intake.ts | n8nInbound.ts (old branch), deps.ts, routes/reconcile.ts, api/mail-inbound, api/mail-poll |

Every other file is reached only through the old engine's own paths (deps.ts, pipeline.ts, routes/reconcile.ts).

## Invariants of this engine (moved unchanged from CLAUDE.md, 26 Oct)

- **`unreconciled` and `unactionable` are different claims.** One is a fact about OnSinch,
  the other a fact about the engine's own record. Collapsing them loses the only signal
  separating "OnSinch refused" from "we never asked".
- **A decline is not a failure, and it is also not a success.** `amendOrderInPlace`
  declining every block is deterministic: never retried on a timer, never logged as an
  amend.
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
