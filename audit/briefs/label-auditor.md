AGENT: label-auditor   PHASE: 0   MODE: read-only

GOAL: OPERATING.md §6.5 on "the 500": hand-verify at least 50 labelled cases, at least 30 of them
misses, and report the label error rate.

INPUTS: audit/briefs/_common.md. The figures 227/500 and 114/500 come from the harness: the simple
set (harness/adapters/spartan/generate.ts, generate(), seed 20261010) and the update set
(generate-complex.ts, generateUpdate(), seed 20261012). A case's label is its `expected`; the
system's answer comes from runCase(c, oracleExtract(c)) in harness/adapters/spartan/adapter.ts.
Rulings that may postdate the labels (verify each yourself): quotes naming shifts are booked
(plan.ts, near the quote_request check, 10-13); the two-week lead rule (plan.ts
CREATE_LEAD_DAYS); never the day alone (plan.ts findOrder comment, 10-15); the crew-chief count
(plan.ts positionsFor).

OUTPUT: eval/label-audit.csv (case_id, set, expected, system_answer, class, reason) and
eval/label-audit.md (summary first).

SCOPE: Run both sets in-process with a scratch script under .tmp-v2/. Sample at least 30 misses
across both sets, spread over templates and branches, and at least 20 hits. Classify each: label
correct / label wrong / genuinely ambiguous / multi-opp / correct answer is NONE (new order) /
correct answer is "not an inquiry". For "label wrong", name the ruling or rule that makes it
wrong (file:line). Report the error rate with its denominator; whether the sets contain NONE and
not-an-inquiry cases at all; and whether the cases are generated or real email (say how you
know). You may NOT change a label or any code.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will re-run 10% of your rows and re-classify them.
