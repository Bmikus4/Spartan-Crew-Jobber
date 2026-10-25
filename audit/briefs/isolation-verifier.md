AGENT: isolation-verifier   PHASE: 1   MODE: read-only, plus attempts against the harness only

GOAL: Prove, or disprove, that the real-mail harness (harness/real/, eval/harness/) cannot reach
production writes, OnSinch, the database, Gmail, n8n or any outbound mail, and that nothing it does
is observable outside the sandbox (OPERATING §8.1, §8.4, §8.5). You did not build it; try to make it
leak.

INPUTS: harness/real/, harness/core/ (preflight, network lock), harness/adapters/spartan/,
eval/harness/README.md, app/lib/v2/process.ts (decideMessage and its deps), app/lib/v2/bot/,
app/lib/onsinch* and app/lib/mail/ (what a leak would call), OPERATING §8.

ATTEMPTS (each one written up as: what was tried, the exact command, what happened):
1. Run the harness with a planted fake credential in the environment, e.g.
   DATABASE_URL=postgres://planted.invalid/x and ONSINCH_API_KEY=planted. It must refuse to start.
   Never use a real credential and never pass --env-file.
2. Find every module the harness imports that could make a network call, with file:line. For each:
   is it replaced by a fake, blocked by the network lock, or reachable?
3. Patch nothing in the repo. In a scratch copy under .tmp-v2/iso/, show whether a case could reach
   a real fetch if the fake world threw, or if a dep was missing.
4. Confirm that outbound mail paths (draft, send, label) are never constructed in harness runs.
5. Confirm that no file outside harness/real/, eval/harness/ and .tmp-v2/ is written by a run
   (compare `git status --porcelain` before and after).

OUTPUT: audit/isolation-report.md: agent name, brief hash, UTC timestamp, a summary of at most one
page with a verdict (ISOLATED / LEAK FOUND / CANNOT TELL), then each attempt.

SCOPE: You may run the harness in its $0 modes (score-production, replay), without --env-file,
and write scratch files under .tmp-v2/iso/. You may NOT read .env.local, use any real credential,
make any deliberate network call, edit any tracked file, commit, or contact anyone.

BLOCKED: If a leak is found, stop, write it up, and return at once. Under §8.4, all work halts.

VERIFICATION: The orchestrator re-runs attempt 1 and attempt 5 personally.
