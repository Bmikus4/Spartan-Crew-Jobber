AGENT: diagnostic-11-3   PHASE: 1   MODE: read-only (harness runs at $0)

GOAL: OPERATING §11.3. Put the correct order into the planner's candidates on the dev set and
measure how often the pick or the change is still wrong. This decides whether retrieval
(finding the order) or selection (picking it and the change) is the bottleneck, so it decides
whether any retrieval work is justified.

INPUTS: harness/real/ and eval/harness/README.md (replay mode on dev only); the labels in
eval/harness/labels/; app/lib/v2/interpret/plan.ts (the evidence finder, :190-239; the
already-booked check, :710-740); app/lib/v2/threadOrder.ts and links.ts (thread linkage).

METHOD: For every dev email whose label names an existing order (or new order = NONE), run
replay twice:
- as is;
- with the true order injected: the thread linked to it, or the finder's pool forced to contain
  it (choose the least invasive hook, in a scratch copy under .tmp-v2/diag/, never in app/).
Report, per bucket and in total, with exact intervals: recall@5 as is;
selection_given_correct_candidate; action_accuracy; and what fails when the right order is
present.

OUTPUT: eval/diagnostic-11-3.md: agent name, brief hash, UTC time, a summary of at most one page with
the verdict (retrieval-bound / selection-bound / neither), then the tables.

SCOPE: Read the repo; run the harness's $0 modes on dev only; write scratch under .tmp-v2/diag/.
You may NOT edit tracked files, read .env.local, make network or model calls, touch the test set,
or commit.

BLOCKED: If the harness cannot express injection without editing app/, describe the smallest
hook needed and stop.

VERIFICATION: The orchestrator re-runs 10% of the injected cases.
