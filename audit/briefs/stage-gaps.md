AGENT: stage-gaps   PHASE: 0   MODE: read-only

GOAL: audit/pipeline-trace.md gives failure modes for 9 of its 18 stages and existing logging for 9.
OPERATING §6.2 asks for both, per stage. Fill the gaps: for each stage below, list how it can fail
(each failure: trigger, what the stage then does, what the email or card ends as, whether staff can
see it) and what it logs today (where, what fields, whether anything reads it).
- Failure modes missing: S3 sender filter, S9 record, S10 link, S12 retries and undecided sweep,
  S13 replan, S14 link sweeps, S15 TV projection, S16 verifier and tick, S17 labels.
- Logging missing: S5, S10, S12, S13, S14, S15, S16, S17.
Use pipeline-trace.md's own stage numbers and boundaries (its §2 and the per-stage sections).

INPUTS: audit/pipeline-trace.md; the code it cites (app/lib/v2/, app/lib/feed/, app/lib/mail/,
app/api/bot/sync/route.ts, app/lib/errorReport.ts, app/lib/v2/trace.ts).

OUTPUT: audit/pipeline-trace-addendum.md: agent name, brief hash, UTC timestamp, a summary of at most
one page, then one section per stage with "Failure modes" and "Logging", every claim with file:line.

SCOPE: Read the repo; read-only commands only. You may NOT read .env.local, call any API or the
network, run the app, gate or harness, commit, or write any file but OUTPUT.

BLOCKED: If a behaviour can only be known by running it, say so and move on.

VERIFICATION: The orchestrator will re-open at least 10% of your citations.
