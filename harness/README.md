# The verification harness

One harness for the rebuild. It proves, with 1-or-0 observations, that every client email
reaches the right final state.

It runs production's own decision code: `decideMessage` in `app/lib/v2/process.ts`, the same
function live intake calls. Fakes stand in at every boundary.

## Commands
| Command | What it does | Cost |
|---|---|---|
| `npx tsx harness/run.ts --mode oracle` | The perfect reader: validates the harness and every step after the model | $0 |
| `npx tsx harness/run.ts --mode mutant` | Control: the model reads every date a day late. Must produce 0 wrong writes | $0 |
| `npx tsx harness/run.ts --mode record --cap 15` | The production model, every call recorded, stops at the cap | model calls |
| `npx tsx harness/run.ts --mode replay` | Rescore from recordings, e.g. after a parser or planner change | $0 |
| `npx tsx harness/run.ts --preflight-selftest` | Proves the preflight aborts on a planted production credential | $0 |
| `npx tsx test/harnessScore.ts` | Each invariant fails when broken; the oracle run is pinned (part of the gate suite) | $0 |

Options: `--n 500`, `--seed 20261010`, `--concurrency 6`, `--model <OpenRouter slug>`.
- **Without `--env-file`:** never run it with one. The preflight refuses any process holding a
  production credential. Only `OPENROUTER_API_KEY` is read from `.env.local`, and only in record mode.

## Layout
- `core/`: project-agnostic.
  - case and observation types
  - record/replay (`recorder.ts`)
  - preflight and network lock
  - Wilson intervals
  - the code-shaped report
- `adapters/spartan/`:
  - `world.ts`: the fake OnSinch
  - `generate.ts`: the seeded case set, with expected outcomes and the oracle reading
  - `score.ts`: the binary observations and invariants
  - `adapter.ts`: runs one case through `decideMessage`
  - `review.ts`: the review file
- `runs/`: results, traces, reports and review files per mode.
- `recordings/`: the recorded model calls.
- `reports/01-discovery.md`: the design, branch map and plan.
- `STATE.md`: where the work stands.
- `DATA_POLICY.md`: what is collected and kept.

## Rules the code enforces
- **One observation is 1 or 0** (Ben). Invariants are reported apart from accuracy and never averaged into it.
- **Isolation:**
  - no production credential may be present;
  - the network is closed to everything but the model provider;
  - each case gets its own fake OnSinch.
- **The model under test is the production model.** The oracle and the mutant replace the model
  only to validate the harness, never to score it.
- **Live trace collection** is wired but off, until `enable live`.
