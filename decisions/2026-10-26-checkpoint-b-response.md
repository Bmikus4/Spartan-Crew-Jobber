# 2026-10-26: the owner's response to Checkpoint B

Owner: Ben, 10-26, in a pasted response to audit/checkpoint-B.md.

**Keep Checkpoint B closed. Do not deploy the full patch, enable writes, change the prompt, or resume the next phase.**

He authorizes a bounded investigation and patch preparation. "Our next priority is correctness on current real mail —
not improving the headline by adding cards or enabling execution."

**Authorized:**

1. **Evidence index and current state.** Exact paths to:
   - the prospective cases, frozen labels and case-level results;
   - the dev sets with their tuning and model provenance;
   - the held patch and its base;
   - the full red-team-B2 responses.

   Confirm HEAD, the deployed revision, the production model and prompt id, and what of the harness work is live. Keep
   verified facts apart from remembered configuration.
2. **Items 1-4, cut and tested separately, not deployed.**
   - Scoring-only changes are kept apart from runtime changes.
   - The UTC fix needs evidence of what OnSinch's zone-less timestamps mean, with date-boundary and DST tests.
   - Return the subset diff, tests, assumptions and a rollback plan.
3. **Execution correctness, before any writes-on proposal.**
   - A case-level breakdown of the 23 assessable writes (8 complete, 6 partial, 9 wrong). For each partial or wrong one:
     requested change, expected result, proposed or written result, failure stage and operational risk.
   - Replay predictions are kept apart from historical production writes and verified read-back.
   - How the 27 write ids relate to the 23.
   - Define "selection-bound" and action_accuracy 7/50, its denominator, and what still failed after injection.
   - Crew-chief errors are not acceptable because they fit an aggregate allowance; explain the consequence and the
     intended business rule.
   - Tiers are recommended only after their failure modes and validation are named.
4. **Items 5-8 held; their evidence separated per component.**
   - For the parser, quote acceptance, domain matching and the display rule: current-mail benefit, regressions,
     unresolved cases and independent testability.
   - The display rule is not approved on old-model gains.
   - Product direction proposed by the owner: genuine outstanding work after a quote acceptance belongs on the TV. Work
     on an existing quote order must not be labelled as creating a new order.
   - Confirm with Paz using concrete examples. Three cases are kept apart: complete an identified existing order;
     find/confirm the order; investigate an acceptance with no existing quote order.
   - No "update" label implying a resolved target when none was found.
   - The inquiry evaluation and the broader quote-work evaluation are kept separate.
5. **Reader diagnostic.**
   - Up to $0.20 total for an isolated re-read of the 11 old-model misses plus a predefined control sample, with the
     verified current production model and prompt.
   - No writes or side effects. Control selection and labels are fixed before the run.
   - Report paired outcomes and cost.
   - It is a diagnostic on known mail, not holdout evidence.
6. **Workflow and safety proposal.**
   - What a TV card represents; acknowledge, approve, complete; what ticking does now and should do; how a completed
     OnSinch change is verified; whether edits, cancels or new positions notify crew. Investigate this without
     contacting live crew.
   - Writes stay off. Model confidence alone is not an execution gate.
   - No display_precision floor yet: separate legitimate non-inquiry work from unnecessary or misleading cards, with
     counts and severity under both task definitions.
7. **Evaluation discipline and the next block.**
   - Continue the current-reader dev-window labelling, excluding the protected pause-window emails.
   - A clean case inspected to design a fix becomes dev or regression evidence for that fix. Untouched mail is reserved
     for the next evaluation.
   - The pause-window store is unchanged: on or after 16:06 UTC on 10-28, store the 40 emails without deciding them.
   - Recommend the next small engineering block from the failure breakdown. Say whether the unfinished
     clarification-draft / Needs Follow Up workflow addresses those failures.
   - Targeted synthetic tests only, no broad campaign.

He said to "Return with the evidence index, isolated patch results, reader diagnostic, failure breakdown, and
recommended next block. Stop there for approval."

**The owner's own words with the paste:** "then once you are fully done begin the next phase".

**How I read the two together.**
- The return above is made first, in full.
- Then I start the recommended next engineering block, in the sandbox only.
- Every prohibition in the paste stays in force: no deploy, writes off, no prompt change, and no paid run beyond the
  $0.20 reader diagnostic.
- Anything in the block that would need one of these stops there and is put to the owner.
