AGENT: metric-definer   PHASE: 0   MODE: read-only

GOAL: OPERATING.md §6.4: define [METRIC A] (227/500) and [METRIC B] (114/500) precisely from the
scoring code, and say whether they are the right metrics.

INPUTS: audit/briefs/_common.md; harness/adapters/spartan/score.ts and adapter.ts; harness/run.ts;
app/lib/v2/score.ts; scripts/week-review.mts, scripts/score-vs-ops.mts,
scripts/real-email-scoreboard.mts, scripts/gold/*; public/data/feed.json tickets S-0215 to
S-0217; OPERATING.md §4 and Appendix A.3. A lead to verify, not a fact: 227 and 114 may be the
same end-to-end metric on two different generated sets (simple and update), measured while the
harness's fake world was broken (fixed in commit 83e4972: 227 to 304, 114 to 154).

OUTPUT: eval/metrics.md

SCOPE: You may read code and run the harness in-process ($0, oracle mode). Deliver:
1. Exact definitions of A and B: what is compared to what, how a match is decided, the denominator.
2. Whether B is downstream of A.
3. Whether A and B suit the purpose and loss function in OPERATING.md §4.
4. For each Appendix A.3 metric: whether any existing tool computes it, and what code and data
   would.
5. One line on every other scoring tool in the repo and what it measures.
You may NOT change any scoring code.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will reproduce A's and B's numbers from your definitions.
