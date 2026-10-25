AGENT: red-team-B   PHASE: 1   MODE: read-only

GOAL: Break the Phase 1 final claim. You are given the conclusion. Find what is wrong with it:
- an overstated number, or a metric computed on the wrong denominator;
- a fix that would do harm in production;
- a leak;
- a label artefact taken for progress;
- anything the owner would regret approving.

INPUTS: audit/final-state.md (the claim); eval/iterations.md; eval/harness/README.md and its
baseline files; eval/patches/p1-fixes.diff (the proposed change); audit/isolation-report.md;
eval/diagnostic-11-3.md; eval/live-week-reads.md; eval/acceptance-study.md; OPERATING.md §4, §8,
§10, §14.

METHOD: Re-run what you doubt. The harness costs $0:
- npx tsx harness/real/run.ts --mode replay --set dev
- apply the patch only in a scratch worktree under .tmp-v2/rtb/, with git worktree add, never in
  the main checkout.
For each hit, give the claim, why it fails, the evidence (command, file:line or ids), and its
severity (decision-changing / material / minor).

OUTPUT: audit/red-team-B.md: agent name, brief hash, UTC time, a summary of at most one page
listing the hits by severity, then each hit.

SCOPE: Read only, except scratch under .tmp-v2/rtb/ (a scratch worktree is allowed there; remove
it when done). You may NOT read .env.local, make network or model calls, edit tracked files,
commit, push, or contact anyone.

BLOCKED: If a claim cannot be checked from the files, say so as a hit of its own.

VERIFICATION: The orchestrator re-runs every decision-changing hit.
