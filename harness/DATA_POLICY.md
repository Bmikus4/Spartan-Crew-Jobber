# Harness data policy

## What is collected
One trace per email, from production's `decideMessage` (`app/lib/v2/trace.ts`), with one event per
step:
- `filter`
- `extract`: model, prompt id, tokens, cost, latency, intent
- `ground`: number of problems, notes
- `plan`: decision kind, operation kinds, reasons
- `run`: per operation, its status and reasons
- `final`

Every event carries `trace_id`, `run_mode` (`test` or `live`) and, in test, `case_id`.

## Test mode (on)
- **Simulated cases only.** Made-up people, companies and venues, generated from a seed.
- **No production data is read.** The preflight refuses to start if any production credential is present.
- **Where it is written:** traces, results and reports go to `harness/runs/`. Model calls are recorded in
  `harness/recordings/extract.jsonl`, keyed by model, prompt id and the exact request text.
- **Retention:** recordings are kept, because they are what makes re-scoring free. Runs can be
  deleted at will.

## Live mode (ON since 27 Oct, ADDENDUM R11 / 5.2; `SPARTAN_TRACE=off` stops it)
- **Wiring:** `app/lib/v2/traceLive.ts` writes one `v2_trace` row per step. Intake (`process.ts`
  processMessage) writes every email it decides; the minute re-plan (`replan.ts`) writes only an answer that
  changed. `resume.ts`'s check plan and the harness replay still pass `noTrace`.
- **Personal data:**
  - any email address in an event is replaced by its SHA-256 with a per-deployment salt
    (`SPARTAN_TRACE_SALT`), so one sender's rows join; with no salt set it is `[address]`;
  - email text is never put in a trace;
  - the model's quotes are kept, because they are what a reviewer checks.
- **Retention:** 90 days. `pruneTrace` runs in the minute sync and deletes older rows; the decision itself
  stays in `v2_decisions`.
- **Failure:** a sink that throws, or a row that cannot be written, is dropped and counted (`failures()`).
  It never blocks or changes how an email is handled (test/liveTrace.ts).
