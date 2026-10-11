# Harness state

Read this first at the start of every work block and after any compaction.

- **Project:** Spartan Crew, adapter `harness/adapters/spartan/`.
- **Prompt:** `C:\Users\thera\Desktop\Fundamental unit of experience\build-verification-harness-prompt.md`
- **Repo revision:** b950a8d plus uncommitted work (worktree `C:\Users\thera\spartan-v2`, branch v2).
- **Phase:** 2 Build DONE and validated. 3 Run: 500 simulated orders on the production model (Ben, 10-11: "finish designing the test harness and validate it. Then you should continue by simulating 500 orders").
- **Model under test:** `anthropic/claude-opus-4.8`, as memory records production's SPARTAN_MODEL. The Vercel value was not decrypted.
- **Spend:** the record run is capped at $15. Measured about $0.011 per call. Actual total: see `runs/record-report.md`.
- **Nothing committed or deployed** for the harness.

## Built
- **Production change (uncommitted):**
  - `decideMessage` in `app/lib/v2/process.ts` is one decision function for live and harness, with injected boundaries;
  - `extractWithMeta` reports model, prompt id, tokens, cost and latency;
  - `app/lib/v2/trace.ts` is the shared trace schema; live is off (`noTrace`);
  - filtered inbound mail now gets a recorded row (finding F-1).
- **Harness:**
  - `harness/core/*`, `harness/adapters/spartan/*`, `harness/run.ts`;
  - docs: `README.md`, `DATA_POLICY.md`;
  - `test/harnessScore.ts`, which goes in the gate suite.

## Validation (all $0)
- **Preflight self-test:** aborts on a planted ONSINCH_API_KEY, passes on a clean environment.
- **Oracle (perfect reader), 500 cases:** 494/500 end to end, every invariant 3000/3000.
  - The 6 misses are one real gap: "The PO for R40012 is 37463" drops the PO.
- **Mutant (every date read a day late):** end to end falls to 254/500, with **0 wrong writes**. Grounding turns each bad date into "a person must act".
- **`test/harnessScore.ts`:** each invariant scores 0 when deliberately broken.

## Run: 500 simulated orders, production model (10-11)
- **Model and cost:** anthropic/claude-opus-4.8, $5.32 in all (first pass $5.21, plus $0.11 for 10 re-recorded after a wording fix). About 3s and $0.011 per email.
- **Gates:** no email lost (500/500); all within five minutes (slowest 8s).
- **End to end:** 494/500 = 98.8% (95% CI 97.4-99.4%). The 6 misses are the P28 PO wording gap, the same 6 as the oracle, so the model added no end-to-end miss of its own.
- **Invariants:** all 3000/3000. No wrong write, isolation held, no double write, no forbidden field.
- **AI node (intent):** 499/500. S0354 read as unclear and safely left for a person.
- **Harness bugs found and fixed:**
  - the weekday template wrote "move Monday's shift to from 1000 to 2pm", which is ambiguous. The model fairly read it as "move the start from 10:00 to 14:00", which counted as a wrong write. Reworded;
  - replay did not pin the model, so every key missed and scored 0/500. Fixed: record and replay share `--model`.
- **Design question raised for Ben:** a change of start time only keeps the old end (S0141 shrank 10h to 6h). Should the end move with it?
- **Review file:** `reports/02-review.md` = `runs/record-review.md`.

## Open
- Read the record-run report; write findings.
- Gate and commit, if Ben asks. The production refactor needs the gate before it can deploy.
- Phase 4: review of `runs/record-review.md`, then fixes on approval.

## Temporary artifacts
- `.tmp-v2/*.mts`, `.tmp-v2/peek.ts`: discovery and inspection scripts (gitignored).
- `harness/runs/*`: run outputs.
