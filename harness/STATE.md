# Harness state

> **History from 26 Oct.** This is the 10-11 record of the generated-mail harness. The plan and its status live in
> ADDENDUM.md. Production's reader since 16 Oct is openai/gpt-6.1-sol (app/lib/v2/interpret/extract.ts,
> SPARTAN_INTERPRET_MODEL); the opus-4.8 named below was the model under test on 10-11. Real mail is replayed by
> harness/real/ (ADDENDUM §4).

Read this first at the start of every work block and after any compaction.

- **Project:** Spartan Crew, adapter `harness/adapters/spartan/`.
- **Prompt:** `C:\Users\thera\Desktop\Fundamental unit of experience\build-verification-harness-prompt.md`
- **Repo revision:** b950a8d plus uncommitted work (worktree `C:\Users\thera\spartan-v2`, branch v2).
- **Phase:** 2 Build DONE and validated. 3 Run: 500 simulated orders on the production model (Ben, 10-11: "finish designing the test harness and validate it. Then you should continue by simulating 500 orders").
- **Model under test (10-11):** `anthropic/claude-opus-4.8`. Production's reader is now openai/gpt-6.1-sol (see the note above).
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

## Complex orders (Ben, 10-11: "500 on each type ... run 1500 more as long as it doesnt cost anything")
- **New sets:** `generate-complex.ts` adds 500 complex creates (9 templates) and 500 complex updates (15 templates, including 3 for thread-to-order links from the TV session's threadOrder.ts).
- **First run, perfect reader:** creates 494/500; updates 260/500, with **40 wrong writes**. "Move Tuesday's shift to Wednesday, 9-5" wrote 9-5 on Tuesday, a LIVE bug.
- **Fixed in the code:**
  - a move to another day lands on the new day (a same-times move is allowed);
  - crew changes across the 3/4 chief line add or cancel the chief;
  - a new shift on a two-venue order goes to the venue named;
  - a weekday picks between candidate months ("Monday the 16th");
  - "The PO for R40012 is 37463" is read;
  - "increase to 5 crew" is read as a total;
  - a crew decrease (`crew_remove`) is supported in grounding and planning. **NOT in the prompt yet**: it needs a paid model run to validate, so the model cannot send it today.
- **Now, all $0:**
  - perfect reader on simple, create and update: 500/500 each, every invariant held;
  - the same on fresh seeds (777001-3): 500/500 each;
  - mutant (dates a day late): 0 wrong writes on all three sets;
  - replay of the 500 recorded opus-4.8 answers: 500/500.
- **Not yet run with the real model:** the complex sets. About $11 for 1000 calls; waiting on Ben.

## Shipped
- 3699642 (S-0155): the harness itself, plus decideMessage, the trace layer and filtered-mail rows. Deployed.
- 92f7256 (S-0157): the complex-order fixes (including the live wrong write on day moves). Deployed 10-11 ~01:25Z; the canary is ok and the next intake run succeeded.
- **Bench 10-11:** a day move through runOp on TEST R11465 (#16516) went from 6 Dec to 7 Dec, same times, verified by read-back and audit; moved back, verified.

## 10-11 later
- **The decrease and day-move lines are built and live:** extract@2c02e41f900b. They were checked with no model call, because Ben said not to use OpenRouter:
  - all 1500 perfect-reader cases pass, and test/v2Ground.ts pins how a decrease is grounded;
  - the 158 answers the new prompt recorded before the 402, scored by `.tmp-v2/ab-prompt.mts`, have 0 wrong writes. On the 148 simple emails answered under both prompts the scores are identical; create 4/4, update 6/6.
  - Most complex cases have no recorded answer under the new prompt. Do not record them through OpenRouter unless Ben asks.
  - Production still reads through OpenRouter. While the account has no credit, every email becomes a "could not read this email" card on the TV.
- **Model-down fix (1bdb46a, deployed):** a failed model call is now a handoff card ("the system could not read this email"), not a silent drop.
- **Dashboard (1bdb46a, deployed):** it counts the rebuild's work from 10-09 (`app/lib/v2/metrics.ts`); its "now" tiles are the TV's own counts.
- **Ben's rule 3:** an ambiguous change (e.g. a new start with no word on the end) gets a DRAFT question to the client, and the order is raised as Needs Follow Up. Not built yet; coordinate with the TV session, which owns Needs Follow Up and followup_drafting.
- **Prediction** (`.tmp-v2/clarify-rate.mts`, 102 real emails re-planned as of their send time):
  - 18 need a question back = **88 per 500** (95% CI 57-131): a missing detail 7, unclear 7, which booking 3, a new start with no end 1 (5 per 500, CI 1-27);
  - the old engine's thread-level "needs-info" was 31 of 950 threads (a floor, system-labelled).

## Open
- **Ben's rule 3:** draft a question and raise the order as Needs Follow Up; the work is split with the TV session (see above).
- **Phase 4:** a review of `reports/02-review.md`, then fixes on approval.

## Temporary artifacts
- `.tmp-v2/*.mts`, `.tmp-v2/peek.ts`: discovery and inspection scripts (gitignored).
- `harness/runs/*`: run outputs.
