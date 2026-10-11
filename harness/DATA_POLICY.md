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

## Live mode (OFF until the operator says `enable live`)
- **Wiring:** production passes `noTrace`, so nothing is written.
- **Personal data, when enabled:**
  - the sender's address is stored as a SHA-256 hash with a per-deployment salt;
  - email text is never put in a trace;
  - the model's quotes are kept, because they are what a reviewer checks.
- **Retention, when enabled:** 90 days, then thinned to the decision and its scores.
- **Failure:** a sink that throws is swallowed and counted (`tracer().failures()`). It never blocks or
  changes how an email is handled.
